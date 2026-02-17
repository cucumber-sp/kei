/**
 * Function body emission and variable declaration collection.
 */

import type { KirFunction, KirInst, KirType, VarId } from "../kir/kir-types.ts";
import { emitFunctionPrototype } from "./c-emitter-decls.ts";
import { emitInst, emitTerminator } from "./c-emitter-insts.ts";
import { emitCTypeForDecl, sanitizeName, varName } from "./c-emitter-types.ts";

// ─── Function emission ──────────────────────────────────────────────────────

export function emitFunction(fn: KirFunction): string {
  const out: string[] = [];
  out.push(emitFunctionPrototype(fn) + " {");

  const varDecls = collectVarDecls(fn);
  for (const [name, type] of varDecls) {
    out.push(`    ${emitCTypeForDecl(type, name)};`);
  }
  if (varDecls.size > 0) out.push("");

  for (let i = 0; i < fn.blocks.length; i++) {
    const block = fn.blocks[i];
    if (i > 0) {
      out.push(`${sanitizeName(block.id)}:`);
    } else {
      out.push(`${sanitizeName(block.id)}: ;`);
    }

    for (const inst of block.instructions) {
      const line = emitInst(inst);
      if (line) out.push(`    ${line}`);
    }

    const term = emitTerminator(block.terminator);
    if (term) out.push(`    ${term}`);
  }

  out.push("}");
  return out.join("\n");
}

// ─── Variable collection ────────────────────────────────────────────────────

function collectVarDecls(fn: KirFunction): Map<string, KirType> {
  const decls = new Map<string, KirType>();
  const paramNames = new Set(fn.params.map((p) => varName(p.name)));

  // Track errPtr → error types mapping from call_throws for proper sizing
  const errPtrErrorTypes = new Map<string, KirType[]>();
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "call_throws") {
        errPtrErrorTypes.set(varName(inst.errPtr), inst.errorTypes);
      }
    }
  }

  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "stack_alloc") {
        const allocName = `${varName(inst.dest)}_alloc`;
        const vn = varName(inst.dest);
        const errorTypes = errPtrErrorTypes.get(vn);
        if (errorTypes && errorTypes.length > 0) {
          decls.set(allocName, {
            kind: "struct",
            name: `__err_union_${allocName}`,
            fields: errorTypes.map((t, i) => ({ name: `e${i}`, type: t })),
          });
        } else {
          decls.set(allocName, inst.type);
        }
      }
      const dest = getInstDest(inst);
      const type = getInstType(inst);
      if (dest && type && !paramNames.has(varName(dest))) {
        if (inst.kind === "stack_alloc" && errPtrErrorTypes.has(varName(inst.dest))) {
          decls.set(varName(inst.dest), { kind: "ptr", pointee: { kind: "void" } });
        } else {
          decls.set(varName(dest), type);
        }
      }
    }
  }

  return decls;
}

function getInstDest(inst: KirInst): VarId | null {
  switch (inst.kind) {
    case "stack_alloc":
    case "load":
    case "field_ptr":
    case "index_ptr":
    case "bin_op":
    case "neg":
    case "not":
    case "bit_not":
    case "const_int":
    case "const_float":
    case "const_bool":
    case "const_string":
    case "const_null":
    case "call":
    case "call_extern":
    case "cast":
    case "sizeof":
    case "move":
    case "call_throws":
      return inst.dest;
    default:
      return null;
  }
}

function getInstType(inst: KirInst): KirType | null {
  switch (inst.kind) {
    case "stack_alloc":
      return { kind: "ptr", pointee: inst.type };
    case "load":
    case "bin_op":
    case "neg":
    case "bit_not":
    case "const_int":
    case "const_float":
    case "const_null":
    case "call":
    case "call_extern":
    case "move":
      return inst.type;
    case "field_ptr":
    case "index_ptr":
      return { kind: "ptr", pointee: inst.type };
    case "not":
    case "const_bool":
      return { kind: "bool" };
    case "const_string":
      return { kind: "string" };
    case "cast":
      return inst.targetType;
    case "sizeof":
      return { kind: "int", bits: 64, signed: false };
    case "call_throws":
      return { kind: "int", bits: 32, signed: true };
    default:
      return null;
  }
}
