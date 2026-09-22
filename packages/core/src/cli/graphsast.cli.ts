#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { scanPaths } from "../scan/scan.js";
import { assertReadableTarget, ScanInputError } from "../scan/files.js";
import { reportToText } from "../scan/reporters/text.js";
import { reportToSarif } from "../scan/reporters/sarif.js";
import {
  ALWAYS_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  type ScanOptions,
} from "../scan/types.js";

const VERSION = "0.1.0";

const USAGE = `GraphSAST v${VERSION} — análisis estático de flujo de datos

USO
  graphsast scan <ruta...> [opciones]

  Cada ruta puede ser un archivo o una carpeta; las carpetas se recorren
  en forma recursiva respetando los .gitignore del proyecto.

OPCIONES
  --format <text|json|sarif>  Formato de salida (default: text)
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
  --no-path                   En texto, mostrar solo source y sink
  --color                     Forzar color ANSI
  --exit-zero                 Salir con 0 aunque haya hallazgos
  -q, --quiet                 Solo la salida del reporte
  -h, --help                  Esta ayuda
  -v, --version               Versión

CÓDIGOS DE SALIDA
  0  sin hallazgos (o --exit-zero)
  1  se encontraron hallazgos
  2  error de uso o de ejecución (p. ej., ruta inexistente o ilegible)

EJEMPLOS
  graphsast scan ./src
  graphsast scan src/controllers/finance.ts
  graphsast scan . --exclude "**/*.test.ts" --exclude fixtures/
  graphsast scan ./src --format sarif --out graphsast.sarif
  graphsast scan app.js --cwe 89 --format json
`;

interface Cli {
  paths: string[];
  format: "text" | "json" | "sarif";
  out?: string;
  color: boolean;
  showPath: boolean;
  exitZero: boolean;
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
    exitZero: false,
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

function render(cli: Cli, result: ReturnType<typeof scanPaths>): string {
  if (cli.format === "json") return JSON.stringify(result, null, 2);
  if (cli.format === "sarif") return reportToSarif(result, { toolVersion: VERSION });
  return reportToText(result, { color: cli.color && !cli.out, showPath: cli.showPath });
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
  for (const target of cli.paths) assertReadableTarget(target);
  const result = scanPaths(cli.paths, cli.scan);
  const output = render(cli, result);

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

  if (cli.exitZero) return 0;
  if (result.totals.errors > 0 && result.totals.files === result.totals.errors) return 2;
  return result.totals.findings > 0 ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
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
