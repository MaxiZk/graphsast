import { Project, type SourceFile } from "ts-morph";

/**
 * Convierte texto fuente en un SourceFile de ts-morph en un FS en memoria.
 * Única responsabilidad: parsing. No conoce la IR.
 */
export function loadSource(code: string, file = "input.ts"): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true },
  });
  return project.createSourceFile(file, code, { overwrite: true });
}
