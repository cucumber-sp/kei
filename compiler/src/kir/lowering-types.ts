/**
 * Type conversion and sizeof methods for KirLowerer.
 * Extracted from lowering.ts for modularity.
 */

import type { Expression, FunctionDecl } from "../ast/nodes.ts";
import type { FunctionType, Type } from "../checker/types";
import type { KirType } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

export function getExprKirType(this: KirLowerer, expr: Expression): KirType {
  // Prefer per-instantiation type map (for monomorphized function bodies)
  const bodyType = this.currentBodyTypeMap?.get(expr);
  if (bodyType) {
    return this.lowerCheckerType(bodyType);
  }
  const checkerType = this.checkResult.typeMap.get(expr);
  if (checkerType) {
    return this.lowerCheckerType(checkerType);
  }
  // Default fallback
  return { kind: "int", bits: 32, signed: true };
}

export function lowerCheckerType(this: KirLowerer, t: Type): KirType {
  switch (t.kind) {
    case "int":
      return { kind: "int", bits: t.bits, signed: t.signed };
    case "float":
      return { kind: "float", bits: t.bits };
    case "bool":
      return { kind: "bool" };
    case "void":
      return { kind: "void" };
    case "string":
      return { kind: "string" };
    case "ptr":
      return { kind: "ptr", pointee: this.lowerCheckerType(t.pointee) };
    case "struct":
      return {
        kind: "struct",
        name: t.name,
        fields: Array.from(t.fields.entries()).map(([name, fieldType]) => ({
          name,
          type: this.lowerCheckerType(fieldType),
        })),
      };
    case "enum":
      return {
        kind: "enum",
        name: t.name,
        variants: t.variants.map((v) => ({
          name: v.name,
          fields: v.fields.map((f) => ({
            name: f.name,
            type: this.lowerCheckerType(f.type),
          })),
          value: v.value,
        })),
      };
    case "array":
      return { kind: "array", element: this.lowerCheckerType(t.element), length: t.length ?? 0 };
    case "function":
      return {
        kind: "function",
        params: t.params.map((p) => this.lowerCheckerType(p.type)),
        returnType: this.lowerCheckerType(t.returnType),
      };
    case "null":
      return { kind: "ptr", pointee: { kind: "void" } };
    case "c_char":
      return { kind: "int", bits: 8, signed: true };
    case "slice":
      return {
        kind: "struct",
        name: "slice",
        fields: [
          { name: "ptr", type: { kind: "ptr", pointee: this.lowerCheckerType(t.element) } },
          { name: "len", type: { kind: "int", bits: 64, signed: false } },
        ],
      };
    case "range":
      return {
        kind: "struct",
        name: "Range",
        fields: [
          { name: "start", type: this.lowerCheckerType(t.element) },
          { name: "end", type: this.lowerCheckerType(t.element) },
        ],
      };
    default:
      return { kind: "int", bits: 32, signed: true };
  }
}

export function lowerTypeNode(this: KirLowerer, typeNode: { kind: string; name: string }): KirType {
  const name = typeNode.name;
  switch (name) {
    case "int":
    case "i32":
      return { kind: "int", bits: 32, signed: true };
    case "i8":
      return { kind: "int", bits: 8, signed: true };
    case "i16":
      return { kind: "int", bits: 16, signed: true };
    case "i64":
    case "isize":
      return { kind: "int", bits: 64, signed: true };
    case "u8":
      return { kind: "int", bits: 8, signed: false };
    case "u16":
      return { kind: "int", bits: 16, signed: false };
    case "u32":
      return { kind: "int", bits: 32, signed: false };
    case "u64":
    case "usize":
      return { kind: "int", bits: 64, signed: false };
    case "f32":
      return { kind: "float", bits: 32 };
    case "f64":
    case "float":
    case "double":
      return { kind: "float", bits: 64 };
    case "bool":
      return { kind: "bool" };
    case "void":
      return { kind: "void" };
    case "string":
      return { kind: "string" };
    default: {
      // Check if the name refers to an enum declaration
      for (const decl of this.program.declarations) {
        if (decl.kind === "EnumDecl" && decl.name === name) {
          return this.lowerEnumDecl(decl).type;
        }
      }
      return { kind: "struct", name, fields: [] };
    }
  }
}

export function resolveParamType(this: KirLowerer, decl: FunctionDecl, paramName: string): KirType {
  const param = decl.params.find((p) => p.name === paramName);
  if (param) {
    return this.lowerTypeNode(param.typeAnnotation);
  }
  return { kind: "int", bits: 32, signed: true };
}

export function resolveParamCheckerType(
  this: KirLowerer,
  decl: FunctionDecl,
  paramName: string
): Type | undefined {
  const param = decl.params.find((p) => p.name === paramName);
  if (param) {
    return this.nameToCheckerType(param.typeAnnotation.name) as Type;
  }
  return undefined;
}

export function getFunctionReturnType(this: KirLowerer, decl: FunctionDecl): Type {
  // Try to get from the checker's type map
  // The function decl itself isn't in typeMap, but we can derive from return type annotation
  if (decl.returnType) {
    const name = decl.returnType.name;
    const checkerType = this.nameToCheckerType(name);
    // If nameToCheckerType didn't recognize it (returns void for user-defined type names),
    // check if it's an enum or struct declaration
    if (checkerType.kind === "void" && name !== "void") {
      for (const d of this.program.declarations) {
        if (d.kind === "EnumDecl" && d.name === name) {
          return {
            kind: "enum" as const,
            name,
            baseType: null,
            variants: d.variants.map((v, i) => ({
              name: v.name,
              fields: [],
              value: v.value?.kind === "IntLiteral" ? v.value.value : i,
            })),
          };
        }
      }
      return {
        kind: "struct" as const,
        name,
        fields: new Map(),
        methods: new Map(),
        isUnsafe: false,
        genericParams: [],
      };
    }
    return checkerType;
  }
  return { kind: "void" as const };
}

export function nameToCheckerType(this: KirLowerer, name: string): Type {
  switch (name) {
    case "int":
    case "i32":
      return { kind: "int" as const, bits: 32 as const, signed: true };
    case "i8":
      return { kind: "int" as const, bits: 8 as const, signed: true };
    case "i16":
      return { kind: "int" as const, bits: 16 as const, signed: true };
    case "i64":
      return { kind: "int" as const, bits: 64 as const, signed: true };
    case "u8":
      return { kind: "int" as const, bits: 8 as const, signed: false };
    case "u16":
      return { kind: "int" as const, bits: 16 as const, signed: false };
    case "u32":
      return { kind: "int" as const, bits: 32 as const, signed: false };
    case "u64":
      return { kind: "int" as const, bits: 64 as const, signed: false };
    case "f32":
      return { kind: "float" as const, bits: 32 as const };
    case "f64":
    case "float":
      return { kind: "float" as const, bits: 64 as const };
    case "bool":
      return { kind: "bool" as const };
    case "string":
      return { kind: "string" as const };
    case "void":
      return { kind: "void" as const };
    default:
      return { kind: "void" as const };
  }
}

/** Resolve the byte size of a sizeof argument at compile time. */
export function resolveSizeofArg(this: KirLowerer, arg: Expression): number {
  if (arg.kind === "Identifier") {
    return this.sizeofTypeName(arg.name);
  }
  // For non-identifier args, use the checker type
  const checkerType = this.checkResult.typeMap.get(arg);
  if (checkerType) {
    return this.sizeofCheckerType(checkerType);
  }
  return 0;
}

/** Get size from a type name string. */
export function sizeofTypeName(this: KirLowerer, name: string): number {
  switch (name) {
    case "i8":
    case "u8":
    case "bool":
      return 1;
    case "i16":
    case "u16":
      return 2;
    case "i32":
    case "u32":
    case "int":
    case "f32":
    case "float":
      return 4;
    case "i64":
    case "u64":
    case "f64":
    case "double":
    case "usize":
    case "isize":
      return 8;
    case "string":
      return 32; // kei_string struct: data(8) + len(8) + cap(8) + ref(8)
    default: {
      // Look up struct in program declarations
      for (const decl of this.program.declarations) {
        if (
          (decl.kind === "StructDecl" || decl.kind === "UnsafeStructDecl") &&
          decl.name === name
        ) {
          let size = 0;
          for (const field of decl.fields) {
            size += this.sizeofTypeName(field.typeAnnotation.name);
          }
          return size;
        }
      }
      return 0;
    }
  }
}

/** Get size from a checker Type. */
export function sizeofCheckerType(this: KirLowerer, t: Type): number {
  switch (t.kind) {
    case "bool":
      return 1;
    case "int":
      return t.bits / 8;
    case "float":
      return t.bits / 8;
    case "string":
      return 32; // kei_string struct: data(8) + len(8) + cap(8) + ref(8)
    case "ptr":
      return 8;
    case "struct": {
      let size = 0;
      for (const [, fieldType] of t.fields) {
        size += this.sizeofCheckerType(fieldType);
      }
      return size;
    }
    default:
      return 8;
  }
}

/** Build a mangled function name from a FunctionDecl (for overloaded definitions). */
export function mangleFunctionName(this: KirLowerer, baseName: string, decl: FunctionDecl): string {
  const paramSuffixes = decl.params.map((p) => this.typeNameSuffix(p.typeAnnotation.name));
  return `${baseName}_${paramSuffixes.join("_")}`;
}

/** Build a mangled function name from a resolved FunctionType (for overloaded calls). */
export function mangleFunctionNameFromType(
  this: KirLowerer,
  baseName: string,
  funcType: FunctionType
): string {
  const paramSuffixes = funcType.params.map((p) => this.checkerTypeSuffix(p.type));
  return `${baseName}_${paramSuffixes.join("_")}`;
}

/** Convert a type annotation name to a short suffix for mangling. */
export function typeNameSuffix(this: KirLowerer, name: string): string {
  switch (name) {
    case "int":
    case "i32":
      return "i32";
    case "i8":
      return "i8";
    case "i16":
      return "i16";
    case "i64":
    case "long":
      return "i64";
    case "u8":
    case "byte":
      return "u8";
    case "u16":
      return "u16";
    case "u32":
      return "u32";
    case "u64":
      return "u64";
    case "isize":
      return "isize";
    case "usize":
      return "usize";
    case "f32":
    case "float":
      return "f32";
    case "f64":
    case "double":
      return "f64";
    case "bool":
      return "bool";
    case "string":
      return "string";
    case "void":
      return "void";
    default:
      return name;
  }
}

/** Convert a checker Type to a short suffix for mangling. */
export function checkerTypeSuffix(this: KirLowerer, t: Type): string {
  switch (t.kind) {
    case "int":
      return `${t.signed ? "i" : "u"}${t.bits}`;
    case "float":
      return `f${t.bits}`;
    case "bool":
      return "bool";
    case "string":
      return "string";
    case "void":
      return "void";
    case "ptr":
      return `ptr_${this.checkerTypeSuffix(t.pointee)}`;
    case "struct":
      return t.name;
    case "enum":
      return t.name;
    default:
      return t.kind;
  }
}
