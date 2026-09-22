#!/usr/bin/env node
import { statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scanPaths } from "../scan/scan.js";
import { assertReadableTarget, ScanInputError } from "../scan/files.js";
import { reportToText } from "../scan/reporters/text.js";
import { reportToSarif, type SarifFamily } from "../scan/reporters/sarif.js";
import { getCatalogBundle } from "../taint/rules.js";
import { EXIT, exitCodeFor, parseCweFamily } from "./exit-code.js";
import { VERSION } from "../version.js";
import {
  API_HOST,
  DEFAULT_API_PORT,
  MAX_BODY_BYTES,
  resolveLocalNeo4j,
  startApiServer,
} from "../server/server.js";
import {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  type ScanOptions,
} from "../scan/types.js";


const USAGE = `GraphSAST v${VERSION} — análisis estático de flujo de datos

USO
  graphsast scan <ruta...> [opciones]
  graphsast serve [--port <n>] [--root <carpeta>]

  Cada ruta puede ser un archivo o una carpeta; las carpetas se recorren
  en forma recursiva respetando los .gitignore del proyecto.

OPCIONES
  --format <text|json|sarif>  Formato de salida (default: text)
                              text: legible, agrupado por archivo
                              json: el resultado completo
                              sarif: SARIF 2.1.0 (GitHub Code Scanning); las
                              rutas quedan relativas al directorio actual
  --output, --out <archivo>   Escribir la salida a un archivo
  --ext <.ts,.js>             Extensiones a analizar
                              (default: ${DEFAULT_EXTENSIONS.join(",")})
  --exclude <patrón>          Excluir rutas (sintaxis .gitignore, relativa a
                              la carpeta escaneada). Repetible o separado por comas
  --ignore <a,b>              Nombres de carpeta a excluir
                              (default: ${DEFAULT_IGNORE.join(",")})
                              Siempre excluidas: ${ALWAYS_IGNORE.join(",")}
  --cwe <89,79>               Reportar solo estos CWE
  --max-depth <n>             Profundidad máxima del camino (default: 15)
  --max-file-bytes <n>        Omitir archivos más grandes (default: 1000000)
  --fail-on <cwe-89,cwe-78>   Solo estas familias CWE provocan el código 1
                              (el reporte las muestra todas igual)
  --no-path                   En texto, mostrar solo source y sink
  --verbose                   En texto, un bloque por hallazgo con la línea
                              y el código de cada paso
  --color                     Forzar color ANSI
  --exit-zero                 Salir con 0 aunque haya hallazgos
                              (los errores siguen dando 2)
  -q, --quiet                 Solo la salida del reporte
  -h, --help                  Esta ayuda
  -v, --version               Versión

CÓDIGOS DE SALIDA
  0  análisis completo, sin hallazgos (o con --exit-zero)
  1  análisis completo, con hallazgos (de las familias de --fail-on, si se indica)
  2  error: uso incorrecto, ruta inexistente o ilegible, catálogo CWE ausente,
     ningún archivo analizable, o algún archivo que no se pudo analizar

SERVE (API local)
  Levanta la API HTTP que consume la interfaz de visualización. Escucha
  únicamente en ${API_HOST}; no hay opción para cambiarlo.
  --port <n>                  Puerto (default: ${DEFAULT_API_PORT})
  --root <carpeta>            Única carpeta que se puede analizar por ruta
                              (default: el directorio actual)
  Endpoints: GET /api/health, GET /api/catalog, POST /api/analyze
  (cuerpo JSON {"code": "..."} o {"path": "..."}, hasta ${MAX_BODY_BYTES} bytes)

EJEMPLOS
  graphsast scan ./src
  graphsast scan src/controllers/finance.ts
  graphsast scan . --exclude "**/*.test.ts" --exclude fixtures/
  graphsast scan ./src --format sarif --out graphsast.sarif
  graphsast scan app.js --cwe 89 --format json
  graphsast scan ./src --fail-on cwe-89,cwe-78
  graphsast serve --port 5174
`;

interface Cli {
  paths: string[];
  format: "text" | "json" | "sarif";
  out?: string;
  color: boolean;
  showPath: boolean;
  verbose: boolean;
  exitZero: boolean;
  failOn: number[];
  quiet: boolean;
  scan: ScanOptions;
}

class UsageError extends Error {}

function nextValue(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new UsageError(`La opción ${flag} requiere un valor.`);
  }
  return value;
}

function splitList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    paths: [],
    format: "text",
    color: process.stdout.isTTY === true && !process.env.NO_COLOR,
    showPath: true,
    verbose: false,
    exitZero: false,
    failOn: [],
    quiet: false,
    scan: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--format": {
        const v = nextValue(argv, i++, arg);
        if (v !== "text" && v !== "json" && v !== "sarif") {
          throw new UsageError(`Formato desconocido: ${v} (text|json|sarif)`);
        }
        cli.format = v;
        break;
      }
      case "--out":
      case "--output":
        cli.out = nextValue(argv, i++, arg);
        break;
      case "--exclude":
        cli.scan.exclude = [
          ...(cli.scan.exclude ?? []),
          ...splitList(nextValue(argv, i++, arg)),
        ];
        break;
      case "--ext":
        cli.scan.extensions = splitList(nextValue(argv, i++, arg)).map((e) =>
          e.startsWith(".") ? e : `.${e}`,
        );
        break;
      case "--ignore":
        cli.scan.ignore = splitList(nextValue(argv, i++, arg));
        break;
      case "--cwe":
        cli.scan.cwe = splitList(nextValue(argv, i++, arg)).map((n) => {
          const parsed = Number(n);
          if (!Number.isFinite(parsed)) throw new UsageError(`CWE inválido: ${n}`);
          return parsed;
        });
        break;
      case "--fail-on":
        for (const raw of splitList(nextValue(argv, i++, arg))) {
          const cwe = parseCweFamily(raw);
          if (cwe === null) {
            throw new UsageError(`Familia CWE inválida: ${raw} (formato: cwe-89)`);
          }
          cli.failOn.push(cwe);
        }
        break;
      case "--max-depth": {
        const n = Number(nextValue(argv, i++, arg));
        if (!Number.isInteger(n) || n < 1) {
          throw new UsageError("--max-depth debe ser un entero positivo.");
        }
        cli.scan.maxDepth = n;
        break;
      }
      case "--max-file-bytes": {
        const n = Number(nextValue(argv, i++, arg));
        if (!Number.isInteger(n) || n < 1) {
          throw new UsageError("--max-file-bytes debe ser un entero positivo.");
        }
        cli.scan.maxFileBytes = n;
        break;
      }
      case "--no-path":
        cli.showPath = false;
        break;
      case "--verbose":
        cli.verbose = true;
        break;
      case "--color":
        cli.color = true;
        break;
      case "--no-color":
        cli.color = false;
        break;
      case "--exit-zero":
        cli.exitZero = true;
        break;
      case "-q":
      case "--quiet":
        cli.quiet = true;
        break;
      default:
        if (arg.startsWith("-")) throw new UsageError(`Opción desconocida: ${arg}`);
        cli.paths.push(arg);
    }
  }

  if (cli.paths.length === 0) {
    throw new UsageError("Falta indicar al menos una ruta a analizar.");
  }
  return cli;
}

function render(
  cli: Cli,
  result: ReturnType<typeof scanPaths>,
  families: SarifFamily[],
): string {
  if (cli.format === "json") return JSON.stringify(result, null, 2);
  if (cli.format === "sarif") {
    return reportToSarif(result, { toolVersion: VERSION, families });
  }
  return reportToText(result, {
    color: cli.color && !cli.out,
    showPath: cli.showPath,
    verbose: cli.verbose,
  });
}

/** `graphsast serve`: devuelve un código si termina, o null si queda escuchando. */
async function serve(argv: string[]): Promise<number | null> {
  let port = DEFAULT_API_PORT;
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        return EXIT.CLEAN;
      case "--port": {
        const n = Number(nextValue(argv, i++, arg));
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          throw new UsageError("--port debe ser un entero entre 1 y 65535.");
        }
        port = n;
        break;
      }
      case "--root":
        root = nextValue(argv, i++, arg);
        break;
      default:
        throw new UsageError(`Opción desconocida para serve: ${arg}`);
    }
  }

  assertReadableTarget(root);
  if (!statSync(root).isDirectory()) {
    throw new ScanInputError(`--root debe ser una carpeta: ${root}`);
  }
  root = path.resolve(root);

  const catalog = getCatalogBundle();
  if (catalog.entries.length === 0) {
    process.stderr.write(`Error: no se encontró el catálogo CWE en ${catalog.dir}\n`);
    return EXIT.ERROR;
  }

  const neo4j = await resolveLocalNeo4j();
  if (neo4j.warning) process.stderr.write(`Aviso: ${neo4j.warning}\n`);

  try {
    await startApiServer({ port, root, driver: neo4j.driver });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    process.stderr.write(
      code === "EADDRINUSE"
        ? `Error: el puerto ${port} ya está en uso.\n`
        : `Error: no se pudo levantar la API: ${(err as Error).message}\n`,
    );
    await neo4j.driver?.close();
    return EXIT.ERROR;
  }

  process.stdout.write(
    `GraphSAST API v${VERSION} escuchando en http://${API_HOST}:${port}\n`
    + `  raíz permitida: ${root}\n`
    + `  motor: ${neo4j.driver ? "neo4j (local)" : "memoria"}\n`
    + `  Ctrl+C para detener.\n`,
  );
  return null;
}

function main(argv: string[]): number {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const command = argv[0];
  const rest = command === "scan" ? argv.slice(1) : argv;
  if (command !== undefined && command.startsWith("-") === false && command !== "scan") {
    // Sin subcomando explícito: tratar todo como rutas.
  }

  const cli = parseArgs(rest);

  // Sin catálogo no hay sinks, y todo escaneo daría «Sin hallazgos».
  const catalog = getCatalogBundle();
  if (catalog.entries.length === 0) {
    process.stderr.write(`Error: no se encontró el catálogo CWE en ${catalog.dir}\n`);
    return EXIT.ERROR;
  }
  const active = catalog.entries.map((e) => e.cwe);
  const unknown = cli.failOn.filter((cwe) => !active.includes(cwe));
  if (unknown.length > 0) {
    throw new UsageError(
      `--fail-on: familia(s) no activa(s): ${unknown.map((c) => `cwe-${c}`).join(", ")}`
      + ` (activas: ${active.map((c) => `cwe-${c}`).join(", ")})`,
    );
  }

  for (const target of cli.paths) assertReadableTarget(target);
  const result = scanPaths(cli.paths, cli.scan);
  const output = render(cli, result, catalog.entries);

  if (cli.out) {
    writeFileSync(cli.out, `${output}\n`, "utf8");
    if (!cli.quiet) {
      process.stderr.write(
        `Reporte ${cli.format} escrito en ${cli.out} `
        + `(${result.totals.findings} hallazgo(s)).\n`,
      );
    }
  } else {
    process.stdout.write(`${output}\n`);
  }

  if (result.totals.files === 0) {
    process.stderr.write(
      `Error: no se encontraron archivos analizables en: ${cli.paths.join(", ")}\n`,
    );
  } else if (result.totals.errors > 0 && (cli.out || cli.format !== "text")) {
    // En texto a stdout el reporte ya los lista.
    process.stderr.write(
      `Error: ${result.totals.errors} archivo(s) no pudieron analizarse; `
      + `el análisis está incompleto.\n`,
    );
  }

  return exitCodeFor(result, { exitZero: cli.exitZero, failOn: cli.failOn });
}

function fail(err: unknown): void {
  if (err instanceof ScanInputError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 2;
  } else if (err instanceof UsageError) {
    process.stderr.write(`Error: ${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    process.stderr.write(
      `Error inesperado: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 2;
  }
}

const argv = process.argv.slice(2);
if (argv[0] === "serve") {
  serve(argv.slice(1)).then((code) => {
    if (code !== null) process.exitCode = code;
  }, fail);
} else {
  try {
    process.exitCode = main(argv);
  } catch (err) {
    fail(err);
  }
}
