/**
 * Emission of type declarations, extern declarations, globals, and function prototypes.
 */

import type {
  KirTypeDecl,
  KirExtern,
  KirGlobal,
  KirFunction,
} from "../kir/kir-types.ts";
import { emitCType, emitCTypeForDecl, sanitizeName, varName } from "./c-emitter-types.ts";

// ─── Type declarations ──────────────────────────────────────────────────────

export function emitTypeDecl(td: KirTypeDecl): string {
  if (td.type.kind === "struct") {
    const fields = td.type.fields
      .map((f) => `    ${emitCTypeForDecl(f.type, sanitizeName(f.name))};`)
      .join("\n");
    return `struct ${sanitizeName(td.name)} {\n${fields}\n};`;
  }
  if (td.type.kind === "enum") {
    const variants = td.type.variants
      .map((v) => {
        const name = `${sanitizeName(td.name)}_${sanitizeName(v.name)}`;
        if (v.value !== null) return `    ${name} = ${v.value}`;
        return `    ${name}`;
      })
      .join(",\n");
    return `enum ${sanitizeName(td.name)} {\n${variants}\n};`;
  }
  return `/* unknown type ${td.name} */`;
}

// ─── Extern declarations ────────────────────────────────────────────────────

export function emitExtern(ext: KirExtern): string {
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
