/**
 * Type conversion and sizeof helpers — operate on LoweringCtx.
 * Extracted from lowering.ts for modularity.
 */

import type { Expression, FunctionDecl, TypeNode } from "../ast/nodes";
import type { FunctionType, Type } from "../checker/types";
import type { KirType } from "./kir-types";
import type { LoweringCtx } from "./lowering-ctx";
import { lowerEnumDecl } from "./lowering-enum-decl";

/** Extract the base name from a TypeNode — for NullableType / RefType / RawPtrType returns "ptr". */
function typeNodeName(node: TypeNode): string {
  if (node.kind === "NullableType") return "ptr";
  if (node.kind === "RefType") return "ptr";
  if (node.kind === "RawPtrType") return "ptr";
  return node.name;
}

export function getExprKirType(ctx: LoweringCtx, expr: Expression): KirType {
  // Prefer per-instantiation type map (for monomorphized function bodies)
  const bodyType = ctx.currentBodyTypeMap?.get(expr);
  if (bodyType) {
    return lowerCheckerType(ctx, bodyType);
  }
  const checkerType = ctx.checkResult.types.typeMap.get(expr);
  if (checkerType) {
    return lowerCheckerType(ctx, checkerType);
  }
  // Default fallback
  return { kind: "int", bits: 32, signed: true };
}

export function lowerCheckerType(ctx: LoweringCtx, t: Type): KirType {
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
      return { kind: "ptr", pointee: lowerCheckerType(ctx, t.pointee) };
    case "struct":
      return {
        kind: "struct",
        name: t.name,
        fields: Array.from(t.fields.entries()).map(([name, fieldType]) => ({
          name,
          type: lowerCheckerType(ctx, fieldType),
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
            type: lowerCheckerType(ctx, f.type),
          })),
          value: v.value,
        })),
      };
    case "array":
      return { kind: "array", element: lowerCheckerType(ctx, t.element), length: t.length ?? 0 };
    case "function":
      return {
        kind: "function",
        params: t.params.map((p) => lowerCheckerType(ctx, p.type)),
        returnType: lowerCheckerType(ctx, t.returnType),
      };
    case "null":
      return { kind: "ptr", pointee: { kind: "void" } };
    case "c_char":
      return { kind: "int", bits: 8, signed: true };
    case "range":
      return {
        kind: "struct",
        name: "Range",
        fields: [
          { name: "start", type: lowerCheckerType(ctx, t.element) },
          { name: "end", type: lowerCheckerType(ctx, t.element) },
        ],
      };
    default:
      return { kind: "int", bits: 32, signed: true };
  }
}

export function lowerTypeNode(ctx: LoweringCtx, typeNode: TypeNode): KirType {
  // NullableType (T?) → ptr<T>
  if (typeNode.kind === "NullableType") {
    return { kind: "ptr", pointee: lowerTypeNode(ctx, typeNode.inner) };
  }
  // RefType (`ref T` / `readonly ref T`) and RawPtrType (`*T`) both lower
  // to a plain pointer in IR — the source distinction is enforced by the
  // checker, not by the IR.
  if (typeNode.kind === "RefType" || typeNode.kind === "RawPtrType") {
    return { kind: "ptr", pointee: lowerTypeNode(ctx, typeNode.pointee) };
  }
  // GenericType with known built-ins
  if (typeNode.kind === "GenericType") {
    const arg0 = typeNode.typeArgs[0];
    if (typeNode.name === "ptr") {
      return { kind: "ptr", pointee: arg0 ? lowerTypeNode(ctx, arg0) : { kind: "void" } };
    }
    if (typeNode.name === "slice") {
      return {
        kind: "struct",
        name: "slice",
        fields: [
          {
            name: "ptr",
            type: { kind: "ptr", pointee: arg0 ? lowerTypeNode(ctx, arg0) : { kind: "void" } },
          },
          { name: "len", type: { kind: "int", bits: 64, signed: false } },
        ],
      };
    }
    if (typeNode.name === "inline" || typeNode.name === "array" || typeNode.name === "dynarray") {
      const arg1 = typeNode.typeArgs[1];
      const length = arg1?.kind === "NamedType" ? Number.parseInt(arg1.name, 10) || 0 : 0;
      return {
        kind: "array",
        element: arg0 ? lowerTypeNode(ctx, arg0) : { kind: "int", bits: 32, signed: true },
        length,
      };
    }
  }
  const name =
    typeNode.kind === "NamedType"
      ? typeNode.name
      : typeNode.kind === "GenericType"
        ? typeNode.name
        : "ptr";
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
      for (const decl of ctx.program.declarations) {
        if (decl.kind === "EnumDecl" && decl.name === name) {
          return lowerEnumDecl(ctx, decl).type;
        }
      }
      return { kind: "struct", name, fields: [] };
    }
  }
}

export function resolveParamType(ctx: LoweringCtx, decl: FunctionDecl, paramName: string): KirType {
  const param = decl.params.find((p) => p.name === paramName);
  if (param) {
    return lowerTypeNode(ctx, param.typeAnnotation);
  }
  return { kind: "int", bits: 32, signed: true };
}

export function resolveParamCheckerType(
  ctx: LoweringCtx,
  decl: FunctionDecl,
  paramName: string
): Type | undefined {
  const param = decl.params.find((p) => p.name === paramName);
  if (param) {
    return nameToCheckerType(ctx, typeNodeName(param.typeAnnotation)) as Type;
  }
  return undefined;
}

export function getFunctionReturnType(ctx: LoweringCtx, decl: FunctionDecl): Type {
  // Try to get from the checker's type map
  // The function decl itself isn't in typeMap, but we can derive from return type annotation
  if (decl.returnType) {
    if (decl.returnType.kind === "NullableType") {
      return {
        kind: "ptr",
        pointee: getFunctionReturnType(ctx, { ...decl, returnType: decl.returnType.inner }),
      };
    }
    if (decl.returnType.kind === "RefType" || decl.returnType.kind === "RawPtrType") {
      return {
        kind: "ptr",
        pointee: getFunctionReturnType(ctx, { ...decl, returnType: decl.returnType.pointee }),
      };
    }
    if (decl.returnType.kind === "GenericType" && decl.returnType.name === "ptr") {
      const inner = decl.returnType.typeArgs[0];
      const pointee = inner
        ? getFunctionReturnType(ctx, { ...decl, returnType: inner })
        : ({ kind: "void" } as const);
      return { kind: "ptr", pointee };
    }
    const name = typeNodeName(decl.returnType);
    const checkerType = nameToCheckerType(ctx, name);
    // If nameToCheckerType didn't recognize it (returns void for user-defined type names),
    // check if it's an enum or struct declaration
    if (checkerType.kind === "void" && name !== "void") {
      for (const d of ctx.program.declarations) {
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

export function nameToCheckerType(_ctx: LoweringCtx, name: string): Type {
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
export function resolveSizeofArg(ctx: LoweringCtx, arg: Expression): number {
  if (arg.kind === "Identifier") {
    return sizeofTypeName(ctx, arg.name);
  }
  // For non-identifier args, use the checker type
  const checkerType = ctx.checkResult.types.typeMap.get(arg);
  if (checkerType) {
    return sizeofCheckerType(ctx, checkerType);
  }
  return 0;
}

/** Get size from a type name string. */
export function sizeofTypeName(ctx: LoweringCtx, name: string): number {
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
      for (const decl of ctx.program.declarations) {
        if (
          (decl.kind === "StructDecl" || decl.kind === "UnsafeStructDecl") &&
          decl.name === name
        ) {
          let size = 0;
          for (const field of decl.fields) {
            size += sizeofTypeName(ctx, typeNodeName(field.typeAnnotation));
          }
          return size;
        }
      }
      return 0;
    }
  }
}

/** Get size from a checker Type. */
export function sizeofCheckerType(ctx: LoweringCtx, t: Type): number {
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
        size += sizeofCheckerType(ctx, fieldType);
      }
      return size;
    }
    default:
      return 8;
  }
}

/** Build a mangled function name from a FunctionDecl (for overloaded definitions). */
export function mangleFunctionName(ctx: LoweringCtx, baseName: string, decl: FunctionDecl): string {
  const paramSuffixes = decl.params.map((p) => typeNameSuffix(ctx, typeNodeName(p.typeAnnotation)));
  return `${baseName}_${paramSuffixes.join("_")}`;
}

/** Build a mangled function name from a resolved FunctionType (for overloaded calls). */
export function mangleFunctionNameFromType(
  ctx: LoweringCtx,
  baseName: string,
  funcType: FunctionType
): string {
  const paramSuffixes = funcType.params.map((p) => checkerTypeSuffix(ctx, p.type));
  return `${baseName}_${paramSuffixes.join("_")}`;
}

/** Convert a type annotation name to a short suffix for mangling. */
export function typeNameSuffix(_ctx: LoweringCtx, name: string): string {
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
export function checkerTypeSuffix(ctx: LoweringCtx, t: Type): string {
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
      return `ptr_${checkerTypeSuffix(ctx, t.pointee)}`;
    case "struct":
      return t.name;
    case "enum":
      return t.name;
    default:
      return t.kind;
  }
}
