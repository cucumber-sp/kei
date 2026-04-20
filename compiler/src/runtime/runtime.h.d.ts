// Bun text import: `import x from "./runtime.h" with { type: "text" }`
// resolves to the file's contents as a string. tsc needs this ambient
// declaration to type-check the import.
declare const runtimeHeaderSource: string;
export default runtimeHeaderSource;
