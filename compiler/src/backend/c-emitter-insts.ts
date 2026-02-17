/**
 * Instruction and terminator emission for the C backend.
 */

import type { BinOp, KirInst, KirTerminator, KirType, VarId } from "../kir/kir-types.ts";
import {
  cStringLiteral,
  emitCType,
  I32_MAX,
  I32_MIN,
  sanitizeName,
  varName,
} from "./c-emitter-types.ts";

// ─── Instruction emission ───────────────────────────────────────────────────

export function emitInst(inst: KirInst): string {
  switch (inst.kind) {
    case "stack_alloc":
      if (inst.type.kind === "array") {
        return `${varName(inst.dest)} = ${varName(inst.dest)}_alloc;`;
      }
      return `${varName(inst.dest)} = &${varName(inst.dest)}_alloc;`;
    case "load":
      return `${varName(inst.dest)} = *${varName(inst.ptr)};`;
    case "store":
      return `*${varName(inst.ptr)} = ${varName(inst.value)};`;
    case "field_ptr":
      return `${varName(inst.dest)} = &${varName(inst.base)}->${sanitizeName(inst.field)};`;
    case "index_ptr":
      return `${varName(inst.dest)} = &${varName(inst.base)}[${varName(inst.index)}];`;
    case "bin_op":
      return emitBinOp(inst.dest, inst.op, inst.lhs, inst.rhs, inst.type, inst.operandType);
    case "neg":
      return `${varName(inst.dest)} = -${varName(inst.operand)};`;
    case "not":
      return `${varName(inst.dest)} = !${varName(inst.operand)};`;
    case "bit_not":
      return `${varName(inst.dest)} = ~${varName(inst.operand)};`;
    case "const_int": {
      const val = inst.value;
      const cType = emitCType(inst.type);
      if (inst.type.signed && val >= I32_MIN && val <= I32_MAX) {
        return `${varName(inst.dest)} = ${val};`;
      }
      const suffix = inst.type.signed ? "LL" : "ULL";
      return `${varName(inst.dest)} = (${cType})${val}${suffix};`;
    }
    case "const_float":
      return `${varName(inst.dest)} = ${inst.value};`;
    case "const_bool":
      return `${varName(inst.dest)} = ${inst.value ? "true" : "false"};`;
    case "const_string":
      return `${varName(inst.dest)} = kei_string_literal(${cStringLiteral(inst.value)});`;
    case "const_null":
      return `${varName(inst.dest)} = NULL;`;
    case "call":
      return `${varName(inst.dest)} = ${emitCallTarget(inst.func)}(${inst.args.map(varName).join(", ")});`;
    case "call_void":
      return `${emitCallTarget(inst.func)}(${inst.args.map(varName).join(", ")});`;
    case "call_extern":
      return `${varName(inst.dest)} = ${sanitizeName(inst.func)}(${inst.args.map(varName).join(", ")});`;
    case "call_extern_void":
      return `${sanitizeName(inst.func)}(${inst.args.map(varName).join(", ")});`;
    case "cast":
      return `${varName(inst.dest)} = (${emitCType(inst.targetType)})${varName(inst.value)};`;
    case "sizeof":
      return `${varName(inst.dest)} = sizeof(${emitCType(inst.type)});`;
    case "bounds_check":
      return `kei_bounds_check((int64_t)${varName(inst.index)}, (int64_t)${varName(inst.length)});`;
    case "overflow_check":
      return `/* overflow_check ${inst.op} ${varName(inst.lhs)} ${varName(inst.rhs)} */`;
    case "null_check":
      return `kei_null_check(${varName(inst.ptr)});`;
    case "assert_check":
      return `kei_assert(${varName(inst.cond)}, ${cStringLiteral(inst.message)});`;
    case "require_check":
      return `kei_require(${varName(inst.cond)}, ${cStringLiteral(inst.message)});`;
    case "destroy":
      return `${sanitizeName(inst.structName)}___destroy(${varName(inst.value)});`;
    case "oncopy":
      return `${varName(inst.value)} = ${sanitizeName(inst.structName)}___oncopy(${varName(inst.value)});`;
    case "move":
      return `${varName(inst.dest)} = ${varName(inst.source)};`;
    case "call_throws": {
      const allArgs = [...inst.args.map(varName), varName(inst.outPtr), varName(inst.errPtr)];
      return `${varName(inst.dest)} = ${emitCallTarget(inst.func)}(${allArgs.join(", ")});`;
    }
  }
}

function emitCallTarget(func: string): string {
  return sanitizeName(func);
}

function emitBinOp(
  dest: VarId,
  op: BinOp,
  lhs: VarId,
  rhs: VarId,
  type: KirType,
  operandType?: KirType
): string {
  const d = varName(dest);
  const l = varName(lhs);
  const r = varName(rhs);

  if (op === "add" && type.kind === "string") {
    return `${d} = kei_string_concat(${l}, ${r});`;
  }

  const opType = operandType ?? type;
  if (opType.kind === "string") {
    if (op === "eq") return `${d} = kei_string_eq(${l}, ${r});`;
    if (op === "neq") return `${d} = !kei_string_eq(${l}, ${r});`;
  }

  return `${d} = ${l} ${binOpToC(op)} ${r};`;
}

const BIN_OP_MAP: Record<BinOp, string> = {
  add: "+",
  sub: "-",
  mul: "*",
  div: "/",
  mod: "%",
  eq: "==",
  neq: "!=",
  lt: "<",
  gt: ">",
  lte: "<=",
  gte: ">=",
  and: "&&",
  or: "||",
  bit_and: "&",
  bit_or: "|",
  bit_xor: "^",
  shl: "<<",
  shr: ">>",
};

function binOpToC(op: BinOp): string {
  return BIN_OP_MAP[op];
}

// ─── Terminator emission ────────────────────────────────────────────────────

export function emitTerminator(term: KirTerminator): string {
  switch (term.kind) {
    case "ret":
      return `return ${varName(term.value)};`;
    case "ret_void":
      return "return;";
    case "jump":
      return `goto ${sanitizeName(term.target)};`;
    case "br":
      return `if (${varName(term.cond)}) goto ${sanitizeName(term.thenBlock)}; else goto ${sanitizeName(term.elseBlock)};`;
    case "switch": {
      const lines: string[] = [];
      for (let i = 0; i < term.cases.length; i++) {
        const c = term.cases[i];
        const prefix = i === 0 ? "if" : "else if";
        lines.push(
          `${prefix} (${varName(term.value)} == ${varName(c.value)}) goto ${sanitizeName(c.target)};`
        );
      }
      lines.push(`else goto ${sanitizeName(term.defaultBlock)};`);
      return lines.join("\n    ");
    }
    case "unreachable":
      return `__builtin_unreachable();`;
  }
}
