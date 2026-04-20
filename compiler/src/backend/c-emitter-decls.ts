/**
 * Emission of type declarations, extern declarations, globals, and function prototypes.
 */

import type { KirExtern, KirFunction, KirGlobal, KirTypeDecl } from "../kir/kir-types";
import { emitCType, emitCTypeForDecl, sanitizeName, varName } from "./c-emitter-types";

// ─── Type declarations ──────────────────────────────────────────────────────

export function emitTypeDecl(td: KirTypeDecl): string {
  if (td.type.kind === "struct") {
    const fields = td.type.fields
      .map((f) => `    ${emitCTypeForDecl(f.type, sanitizeName(f.name))};`)
      .join("\n");
    return `struct ${sanitizeName(td.name)} {\n${fields}\n};`;
  }
  if (td.type.kind === "enum") {
    const sName = sanitizeName(td.name);
    const hasDataVariants = td.type.variants.some((v) => v.fields.length > 0);

    if (hasDataVariants) {
      // Tagged union: struct with tag + union of variant payloads
      const unionMembers = td.type.variants
        .filter((v) => v.fields.length > 0)
        .map((v) => {
          const fields = v.fields
            .map((f) => `${emitCTypeForDecl(f.type, sanitizeName(f.name))};`)
            .join(" ");
          return `        struct { ${fields} } ${sanitizeName(v.name)};`;
        })
        .join("\n");

      const tagConstants = td.type.variants
        .map((v, i) => {
          const val = v.value !== null ? v.value : i;
          return `    ${sName}_${sanitizeName(v.name)} = ${val}`;
        })
        .join(",\n");

      return [
        "typedef struct {",
        "    int32_t tag;",
        "    union {",
        unionMembers,
        "    } data;",
        `} ${sName};`,
        "",
        `enum ${sName}_Tag {`,
        tagConstants,
        "};",
      ].join("\n");
    }

    // Simple enum: no variant has fields
    const variants = td.type.variants
      .map((v) => {
        const name = `${sName}_${sanitizeName(v.name)}`;
        if (v.value !== null) return `    ${name} = ${v.value}`;
        return `    ${name}`;
      })
      .join(",\n");
    return `enum ${sName} {\n${variants}\n};`;
  }
  return `/* unknown type ${td.name} */`;
}

// ─── Extern declarations ────────────────────────────────────────────────────

// Names already declared by the libc headers the runtime #includes;
// re-declaring with Kei-typed signatures produces conflicting-type errors.
const LIBC_NAMES: ReadonlySet<string> = new Set([
  "malloc",
  "calloc",
  "realloc",
  "free",
  "memcpy",
  "memmove",
  "memset",
  "memcmp",
  "strlen",
  "strcmp",
  "strcpy",
  "strncpy",
  "strcat",
  "strncat",
  "strchr",
  "strstr",
  "putchar",
  "getchar",
  "puts",
  "printf",
  "fprintf",
  "sprintf",
  "snprintf",
  "scanf",
  "exit",
  "abort",
  "atoi",
  "atol",
  "atof",
]);

export function emitExtern(ext: KirExtern): string {
  if (LIBC_NAMES.has(ext.name)) return `/* extern ${ext.name}: provided by libc */`;
  const params = ext.params.map((p) => emitCType(p.type)).join(", ");
  return `extern ${emitCType(ext.returnType)} ${sanitizeName(ext.name)}(${params || "void"});`;
}

// ─── Globals ────────────────────────────────────────────────────────────────

export function emitGlobal(g: KirGlobal): string {
  return `${emitCTypeForDecl(g.type, sanitizeName(g.name))};`;
}

// ─── Function prototypes ────────────────────────────────────────────────────

export function emitFunctionPrototype(fn: KirFunction): string {
  const name = fn.name === "main" ? "main" : sanitizeName(fn.name);
  const retType = fn.name === "main" ? "int" : emitCType(fn.returnType);
  const params =
    fn.params.length === 0
      ? "void"
      : fn.params.map((p) => `${emitCType(p.type)} ${varName(p.name)}`).join(", ");
  return `${retType} ${name}(${params})`;
}
