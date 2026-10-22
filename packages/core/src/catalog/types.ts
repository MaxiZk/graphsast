/**
 * Un sink con restricciones. El string suelto (`"db.query"`) equivale a
 * `{ "callee": "db.query" }`: cualquier argumento y el receptor cuentan.
 */
export interface SinkSpec {
  /**
   * Patrón del callee. `x` coincide con `x(...)` y con `algo.x(...)`;
   * `.x` solo con la forma miembro; `a.b` con `a.b(...)` y con `algo.a.b(...)`.
   * Un patrón `modulo.f` coincide también si `f` viene de importar `modulo`
   * con otro nombre (`const cp = require("child_process"); cp.exec(...)`).
   */
  callee: string;
  /**
   * Posiciones de los argumentos peligrosos (desde 0). Sin esto, todos y el
   * receptor. `db.query(sql, [id])` es `[0]`: los valores ligados por
   * parámetro son la forma segura de escribir la consulta.
   */
  args?: number[];
  /** Solo la llamada suelta `x(...)`, no `algo.x(...)` (`exec` vs `regex.exec`). */
  bare?: boolean;
  /** Expresión regular sobre el texto del receptor (`User` en `User.find`). */
  receiver?: string;
  /**
   * Expresión regular sobre el texto del primer argumento, o sobre el
   * inicializador de la variable que se pasa: si coincide, la llamada no es
   * el sink. `res.send({ ok: true })` responde JSON, no HTML.
   */
  unlessFirstArg?: string;
  /**
   * El sink vale solo si coincide alguna de estas expresiones regulares:
   * `receiverInit` sobre el inicializador de la variable receptora
   * (`new Finance(req.body)` en `finance.save()`), `firstArg` sobre el texto
   * del primer argumento y `code` sobre el texto de la llamada entera
   * (`shell: true` en las opciones de `spawn`).
   */
  onlyIf?: { receiverInit?: string; firstArg?: string; code?: string };
}

export interface CweCatalogEntry {
  cwe: number;
  name: string;
  /** Qué es esa debilidad, en una frase, para mostrar junto a la familia. */
  description?: string;
  /** Un ataque concreto contra el ejemplo típico de la familia, para explicar un hallazgo. */
  attack?: string;
  /** Cómo se corrige, con la forma segura de la API cuando la hay. */
  fix?: string;
  sources: string[];
  sinks: (string | SinkSpec)[];
  sanitizers: string[];
  /**
   * Largo máximo (en aristas) de un camino hasta un sink de esta familia.
   * Sin esto, 15. `--max-depth` lo reemplaza para todas las familias.
   */
  maxDepth?: number;
  /**
   * Solo cuentan los caminos que empiezan en una entrada del catálogo
   * (`req.query`, `@Body()`…), también con `--sources params`. Para familias
   * donde leer un parámetro es lo normal fuera de un servidor: que un script
   * lea el archivo cuya ruta recibe no es Path Traversal; que lo haga con la
   * ruta de un request, sí.
   */
  requireCatalogSource?: boolean;
  /**
   * Como `unlessFirstArg` de un sink, para todos los sinks de la familia:
   * `findOne({ where: ... })` es Sequelize, una consulta SQL con parámetros,
   * y no una consulta de MongoDB.
   */
  unlessFirstArg?: string;
}

export interface CatalogManifest {
  version: number;
  entries: string[];
}

export interface CatalogBundle {
  dir: string;
  entries: CweCatalogEntry[];
}

export interface CatalogLabels {
  [ruleId: string]: string;
}
