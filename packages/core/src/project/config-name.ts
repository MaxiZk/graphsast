/**
 * `tsconfig.json`, `tsconfig.app.json`, `jsconfig.json`.
 *
 * Vive aparte de `tsconfig.ts` a propósito: la página web lo importa para
 * separar los configs subidos, y `tsconfig.ts` arrastra ts-morph (~6 MB), que
 * solo debe cargarse en el worker.
 */
export function isProjectConfigName(name: string): boolean {
  return /^(?:tsconfig(?:\.[\w-]+)?|jsconfig)\.json$/.test(name);
}
