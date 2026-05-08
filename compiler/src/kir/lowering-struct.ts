/**
 * Struct declaration lowering — operates on LoweringCtx.
 * Handles struct declarations, methods, monomorphized structs, and auto lifecycle hooks.
 * Extracted from lowering-decl.ts for modularity.
 */

import type { FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes";
import type { MonomorphizedStruct } from "../checker/generics";
import type { StructType } from "../checker/types";
import type {
  KirBlock,
  KirFunction,
  KirInst,
  KirParam,
  KirType,
  KirTypeDecl,
  VarId,
} from "./kir-types";
import type { LoweringCtx } from "./lowering-ctx";
import { finalizeFunctionBody, resetFunctionState } from "./lowering-decl";
import { mangledLifecycleStructName, pushScope } from "./lowering-scope";
import { lowerBlock } from "./lowering-stmt";
import {
  getFunctionReturnType,
  lowerCheckerType,
  lowerTypeNode,
  resolveParamType,
} from "./lowering-types";

export function lowerStructDecl(
  ctx: LoweringCtx,
  decl: StructDecl | UnsafeStructDecl
): KirTypeDecl {
  const fields = decl.fields.map((f) => ({
    name: f.name,
    type: lowerTypeNode(ctx, f.typeAnnotation),
  }));

  return {
    name: decl.name,
    type: { kind: "struct", name: decl.name, fields },
  };
}

export function lowerMonomorphizedStruct(
  ctx: LoweringCtx,
  mangledName: string,
  monoStruct: MonomorphizedStruct
): KirTypeDecl {
  const concrete = monoStruct.concrete;
  const fields = Array.from(concrete.fields.entries()).map(([name, fieldType]) => ({
    name,
    type: lowerCheckerType(ctx, fieldType),
  }));
  return {
    name: mangledName,
    type: { kind: "struct", name: mangledName, fields },
  };
}

export function lowerMethod(
  ctx: LoweringCtx,
  decl: FunctionDecl,
  mangledName: string,
  _structName: string
): KirFunction {
  resetFunctionState(ctx);

  // Push function-level scope
  pushScope(ctx);

  const params: KirParam[] = decl.params.map((p) => {
    const type = resolveParamType(ctx, decl, p.name);
    // The self parameter is passed as a pointer to the struct — except
    // when the user already declared it as `ref T` or `*T` (which already
    // lowers to ptr at this layer). Same for any param of struct type.
    const alreadyPointer = type.kind === "ptr";
    const paramType: KirType =
      !alreadyPointer && (p.name === "self" || type.kind === "struct")
        ? { kind: "ptr", pointee: type }
        : type;
    const varId: VarId = `%${p.name}`;
    ctx.varMap.set(p.name, varId);
    return { name: p.name, type: paramType };
  });

  const returnType = lowerCheckerType(ctx, getFunctionReturnType(ctx, decl));

  // Set current function return type so lowerReturnStmt can add struct loads
  ctx.currentFunctionOrigReturnType = returnType;

  // Lower body
  lowerBlock(ctx, decl.body);

  finalizeFunctionBody(ctx, false, returnType);

  return {
    name: mangledName,
    params,
    returnType,
    blocks: ctx.blocks,
    localCount: ctx.varCounter,
  };
}

/**
 * Synthesize a __destroy KIR function for a struct with auto-generated destroy.
 * Emits field_ptr + call_extern_void("kei_string_destroy") for string fields,
 * and field_ptr + destroy for struct fields that have __destroy.
 */
export function lowerAutoDestroy(
  _ctx: LoweringCtx,
  structName: string,
  structType: StructType,
  structPrefix: string
): KirFunction {
  const mangledName = `${structPrefix}___destroy`;
  const structKirType: KirType = { kind: "struct", name: structName, fields: [] };
  const selfType: KirType = { kind: "ptr", pointee: structKirType };

  // Build instructions for the entry block
  const insts: KirInst[] = [];
  let varCounter = 0;
  const freshVar = (): VarId => `%_v${varCounter++}` as VarId;

  const selfVar: VarId = "%self" as VarId;

  for (const [fieldName, fieldType] of structType.fields) {
    if (fieldType.kind === "string") {
      // Emit: fieldPtr = &self->fieldName; kei_string_destroy(fieldPtr);
      const fieldPtr = freshVar();
      const kirStringType: KirType = { kind: "string" };
      insts.push({
        kind: "field_ptr",
        dest: fieldPtr,
        base: selfVar,
        field: fieldName,
        type: kirStringType,
      });
      insts.push({ kind: "call_extern_void", func: "kei_string_destroy", args: [fieldPtr] });
    } else if (fieldType.kind === "struct" && fieldType.methods.has("__destroy")) {
      // Emit: fieldPtr = &self->fieldName; destroy fieldPtr (pointer to nested struct)
      const fieldPtr = freshVar();
      const kirFieldType: KirType = { kind: "struct", name: fieldType.name, fields: [] };
      insts.push({
        kind: "field_ptr",
        dest: fieldPtr,
        base: selfVar,
        field: fieldName,
        type: kirFieldType,
      });
      insts.push({
        kind: "destroy",
        value: fieldPtr,
        structName: mangledLifecycleStructName(fieldType),
      });
    }
  }

  const entryBlock: KirBlock = {
    id: "entry",
    phis: [],
    instructions: insts,
    terminator: { kind: "ret_void" },
  };

  return {
    name: mangledName,
    params: [{ name: "self", type: selfType }],
    returnType: { kind: "void" },
    blocks: [entryBlock],
    localCount: varCounter,
  };
}

/**
 * Synthesize an __oncopy KIR function for a struct with auto-generated oncopy.
 *
 * Takes self by pointer, increments refcounts for string fields via
 * `kei_string_copy`, recursively calls nested struct __oncopy hooks, and
 * returns void. The mutations are observed by the caller through the
 * pointer — no return-value copy is needed (the canonical ref-T-self
 * lifecycle ABI; see `docs/design/ref-redesign.md` §3.1).
 */
export function lowerAutoOncopy(
  _ctx: LoweringCtx,
  structName: string,
  structType: StructType,
  structPrefix: string
): KirFunction {
  const mangledName = `${structPrefix}___oncopy`;
  const structKirType: KirType = { kind: "struct", name: structName, fields: [] };
  const selfType: KirType = { kind: "ptr", pointee: structKirType };

  const insts: KirInst[] = [];
  let varCounter = 0;
  const freshVar = (): VarId => `%_v${varCounter++}` as VarId;

  const selfVar: VarId = "%self" as VarId;

  for (const [fieldName, fieldType] of structType.fields) {
    if (fieldType.kind === "string") {
      // fieldPtr = &self->fieldName; val = *fieldPtr; copied = kei_string_copy(val); *fieldPtr = copied;
      const fieldPtr = freshVar();
      const kirStringType: KirType = { kind: "string" };
      insts.push({
        kind: "field_ptr",
        dest: fieldPtr,
        base: selfVar,
        field: fieldName,
        type: kirStringType,
      });
      const loaded = freshVar();
      insts.push({ kind: "load", dest: loaded, ptr: fieldPtr, type: kirStringType });
      const copied = freshVar();
      insts.push({
        kind: "call_extern",
        dest: copied,
        func: "kei_string_copy",
        args: [loaded],
        type: kirStringType,
      });
      insts.push({ kind: "store", ptr: fieldPtr, value: copied });
    } else if (fieldType.kind === "struct" && fieldType.methods.has("__oncopy")) {
      // fieldPtr = &self->fieldName; val = *fieldPtr; oncopy val; *fieldPtr = val;
      //
      // The C emit for `oncopy val` becomes `X___oncopy(&val)` (void
      // return), which mutates `val` in place via the pointer. The
      // surrounding load/store pair propagates the mutation back to
      // the field slot.
      const fieldPtr = freshVar();
      const kirFieldType: KirType = { kind: "struct", name: fieldType.name, fields: [] };
      insts.push({
        kind: "field_ptr",
        dest: fieldPtr,
        base: selfVar,
        field: fieldName,
        type: kirFieldType,
      });
      const loaded = freshVar();
      insts.push({ kind: "load", dest: loaded, ptr: fieldPtr, type: kirFieldType });
      insts.push({
        kind: "oncopy",
        value: loaded,
        structName: mangledLifecycleStructName(fieldType),
      });
      insts.push({ kind: "store", ptr: fieldPtr, value: loaded });
    }
  }

  const entryBlock: KirBlock = {
    id: "entry",
    phis: [],
    instructions: insts,
    terminator: { kind: "ret_void" },
  };

  return {
    name: mangledName,
    params: [{ name: "self", type: selfType }],
    returnType: { kind: "void" },
    blocks: [entryBlock],
    localCount: varCounter,
  };
}
