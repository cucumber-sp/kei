/**
 * C type mapping, name sanitization, and string literal helpers.
 */

import type { KirType, VarId } from "../kir/kir-types.ts";

// ─── Integer range constants ────────────────────────────────────────────────

export const I32_MIN = -2147483648;
export const I32_MAX = 2147483647;

// ─── Type mapping ───────────────────────────────────────────────────────────

export function emitCType(t: KirType): string {
  switch (t.kind) {
    case "int":
      return t.signed ? `int${t.bits}_t` : `uint${t.bits}_t`;
    case "float":
      return t.bits === 32 ? "float" : "double";
    case "bool":
      return "bool";
    case "void":
      return "void";
    case "string":
      return "kei_string";
    case "ptr":
      return `${emitCType(t.pointee)}*`;
    case "struct":
      return `struct ${sanitizeName(t.name)}`;
    case "enum":
      return `enum ${sanitizeName(t.name)}`;
    case "array":
      return `${emitCType(t.element)}`;
    case "function":
      return "void*";
  }
}

export function emitCTypeForDecl(t: KirType, varName: string): string {
  if (t.kind === "array") {
    return `${emitCType(t.element)} ${varName}[${t.length}]`;
  }
  if (t.kind === "struct" && t.name.startsWith("__err_union_")) {
    const members = t.fields.map(f => `${emitCType(f.type)} ${sanitizeName(f.name)};`).join(" ");
    return `union { ${members} } ${varName}`;
  }
  return `${emitCType(t)} ${varName}`;
}

// ─── Name helpers ───────────────────────────────────────────────────────────

/** Sanitize a name for use as a C identifier. */
export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Convert a VarId like "%0" or "%x.1" to a C variable name. */
export function varName(v: VarId): string {
  if (v === "undef") return "0 /* undef */";
  const stripped = v.startsWith("%") ? v.slice(1) : v;
  return `_v${sanitizeName(stripped)}`;
}

// ─── C string escaping ─────────────────────────────────────────────────────

export function cStringLiteral(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      case '\0': out += '\\0'; break;
      default:
        if (code < 0x20 || code > 0x7e) {
          out += '\\' + code.toString(8).padStart(3, '0');
        } else {
          out += ch;
        }
    }
  }
  out += '"';
  return out;
}
