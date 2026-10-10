import { execSync } from "child_process";

export function comprimirCarpeta(ruta) {
  return execSync("tar -czf reporte.tgz " + ruta);
}

export function verificarHost(host) {
  return execSync("ping -c 1 " + host);
}
