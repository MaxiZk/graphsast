import { loadNodeLanguages } from "./lang/node.js";

// Las pruebas analizan Python, Java, PHP y Go de forma sincrónica: las
// gramáticas tienen que estar cargadas antes.
await loadNodeLanguages();
