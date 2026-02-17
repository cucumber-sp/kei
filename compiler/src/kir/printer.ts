/**
 * KIR text format printer — human-readable debug output.
 * Matches the format shown in spec/12-kir.md.
 */

import type {
  KirBlock,
  KirExtern,
  KirFunction,
  KirGlobal,
  KirInst,
  KirModule,
  KirPhi,
  KirTerminator,
  KirType,
  KirTypeDecl,
} from "./kir-types.ts";

export function printKir(module: KirModule): string {
  const lines: string[] = [];

  lines.push(`module ${module.name}`);

  // Type declarations
  for (const td of module.types) {
    lines.push("");
    lines.push(printTypeDecl(td));
  }

  // Extern declarations
  for (const ext of module.externs) {
    lines.push("");
    lines.push(printExtern(ext));
  }

  // Globals
  for (const g of module.globals) {
    lines.push("");
    lines.push(printGlobal(g));
  }

  // Functions
  for (const fn of module.functions) {
    lines.push("");
    lines.push(printFunction(fn));
  }

  return `${lines.join("\n")}\n`;
}

function printTypeDecl(td: KirTypeDecl): string {
  if (td.type.kind === "struct") {
    const fields = td.type.fields.map((f) => `  ${f.name}: ${printType(f.type)}`).join("\n");
    return `type ${td.name} = struct {\n${fields}\n}`;
  }
  if (td.type.kind === "enum") {
    const variants = td.type.variants
      .map((v) => {
        if (v.value !== null) return `  ${v.name} = ${v.value}`;
        if (v.fields.length > 0) {
          const fields = v.fields.map((f) => `${f.name}: ${printType(f.type)}`).join(", ");
          return `  ${v.name} { ${fields} }`;
        }
        return `  ${v.name}`;
      })
      .join("\n");
    return `type ${td.name} = enum {\n${variants}\n}`;
  }
  return `type ${td.name} = <unknown>`;
}

function printExtern(ext: KirExtern): string {
  const params = ext.params.map((p) => `${p.name}: ${printType(p.type)}`).join(", ");
  return `extern fn ${ext.name}(${params}): ${printType(ext.returnType)}`;
}

function printGlobal(g: KirGlobal): string {
  return `global ${g.name}: ${printType(g.type)}`;
}

function printFunction(fn: KirFunction): string {
  const params = fn.params.map((p) => `${p.name}: ${printType(p.type)}`).join(", ");
  const lines: string[] = [];
  lines.push(`fn ${fn.name}(${params}): ${printType(fn.returnType)} {`);

  for (const block of fn.blocks) {
    lines.push(printBlock(block));
  }

  lines.push("}");
  return lines.join("\n");
}

function printBlock(block: KirBlock): string {
  const lines: string[] = [];
  lines.push(`${block.id}:`);

  for (const phi of block.phis) {
    lines.push(`  ${printPhi(phi)}`);
  }

  for (const inst of block.instructions) {
    lines.push(`  ${printInst(inst)}`);
  }

  lines.push(`  ${printTerminator(block.terminator)}`);

  return lines.join("\n");
}

function printPhi(phi: KirPhi): string {
  const incoming = phi.incoming.map((e) => `${e.value} from ${e.from}`).join(", ");
  return `${phi.dest} = \u03C6 [${incoming}]`;
}

function printInst(inst: KirInst): string {
  switch (inst.kind) {
    case "stack_alloc":
      return `${inst.dest} = stack_alloc ${printType(inst.type)}`;
    case "load":
      return `${inst.dest} = load ${inst.ptr}`;
    case "store":
      return `store ${inst.ptr}, ${inst.value}`;
    case "field_ptr":
      return `${inst.dest} = field_ptr ${inst.base}, "${inst.field}"`;
    case "index_ptr":
      return `${inst.dest} = index_ptr ${inst.base}, ${inst.index}`;
    case "bin_op":
      return `${inst.dest} = ${inst.op} ${inst.lhs}, ${inst.rhs}`;
    case "neg":
      return `${inst.dest} = neg ${inst.operand}`;
    case "not":
      return `${inst.dest} = not ${inst.operand}`;
    case "bit_not":
      return `${inst.dest} = bit_not ${inst.operand}`;
    case "const_int":
      return `${inst.dest} = const_int ${printType(inst.type)} ${inst.value}`;
    case "const_float":
      return `${inst.dest} = const_float ${printType(inst.type)} ${inst.value}`;
    case "const_bool":
      return `${inst.dest} = const_bool ${inst.value}`;
    case "const_string":
      return `${inst.dest} = const_string "${inst.value}"`;
    case "const_null":
      return `${inst.dest} = const_null ${printType(inst.type)}`;
    case "call":
      return `${inst.dest} = call ${inst.func}(${inst.args.join(", ")})`;
    case "call_void":
      return `call_void ${inst.func}(${inst.args.join(", ")})`;
    case "call_extern":
      return `${inst.dest} = call_extern ${inst.func}(${inst.args.join(", ")})`;
    case "call_extern_void":
      return `call_extern_void ${inst.func}(${inst.args.join(", ")})`;
    case "call_throws":
      return `${inst.dest} = call_throws ${inst.func}(${inst.args.join(", ")}) out=${inst.outPtr} err=${inst.errPtr}`;
    case "cast":
      return `${inst.dest} = cast ${inst.value}, ${printType(inst.targetType)}`;
    case "sizeof":
      return `${inst.dest} = sizeof ${printType(inst.type)}`;
    case "bounds_check":
      return `bounds_check ${inst.index}, ${inst.length}`;
    case "overflow_check":
      return `overflow_check ${inst.op}, ${inst.lhs}, ${inst.rhs}`;
    case "null_check":
      return `null_check ${inst.ptr}`;
    case "assert_check":
      return `assert_check ${inst.cond}, "${inst.message}"`;
    case "require_check":
      return `require_check ${inst.cond}, "${inst.message}"`;
    case "destroy":
      return `destroy ${inst.value}`;
    case "oncopy":
      return `oncopy ${inst.value}`;
    case "move":
      return `${inst.dest} = move ${inst.source}`;
  }
}

function printTerminator(term: KirTerminator): string {
  switch (term.kind) {
    case "ret":
      return `ret ${term.value}`;
    case "ret_void":
      return "ret_void";
    case "jump":
      return `jump ${term.target}`;
    case "br":
      return `br ${term.cond}, ${term.thenBlock}, ${term.elseBlock}`;
    case "switch": {
      const cases = term.cases.map((c) => `${c.value} → ${c.target}`).join(", ");
      return `switch ${term.value}, [${cases}], default: ${term.defaultBlock}`;
    }
    case "unreachable":
      return "unreachable";
  }
}

export function printType(t: KirType): string {
  switch (t.kind) {
    case "int": {
      const prefix = t.signed ? "i" : "u";
      return `${prefix}${t.bits}`;
    }
    case "float":
      return `f${t.bits}`;
    case "bool":
      return "bool";
    case "void":
      return "void";
    case "string":
      return "string";
    case "ptr":
      return `ptr<${printType(t.pointee)}>`;
    case "struct":
      return t.name;
    case "enum":
      return t.name;
    case "array":
      return `array<${printType(t.element)}, ${t.length}>`;
    case "function": {
      const params = t.params.map(printType).join(", ");
      return `fn(${params}): ${printType(t.returnType)}`;
    }
  }
}
