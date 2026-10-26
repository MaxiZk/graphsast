// Copia los pares del conjunto `demo` con su nombre real, listos para
// analizarlos en la web o con la CLI: <carpeta>/malo y <carpeta>/bueno.
//
//   npm run demo -- ./demo-graphsast
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const destino = path.resolve(process.argv[2] ?? "demo-graphsast");
const { pares } = JSON.parse(readFileSync(path.join(dir, "pares.json"), "utf8"));

for (const par of pares.filter((p) => p.conjunto === "demo")) {
  const origen = path.join(dir, "demo", par.nombre);
  for (const [tipo, carpeta] of [["vulnerable", "malo"], ["seguro", "bueno"]]) {
    const archivo = readdirSync(origen).find((f) => f.startsWith(`${tipo}.`) && f.endsWith(".txt"));
    mkdirSync(path.join(destino, carpeta), { recursive: true });
    copyFileSync(path.join(origen, archivo), path.join(destino, carpeta, par.archivo));
  }
}
console.log(`Pares de demostración en ${destino}/malo y ${destino}/bueno`);
