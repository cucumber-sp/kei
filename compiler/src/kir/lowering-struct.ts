/**
 * Struct declaration lowering methods for KirLowerer.
 * Handles struct declarations, methods, monomorphized structs, and auto lifecycle hooks.
 * Extracted from lowering-decl.ts for modularity.
 */

import type { FunctionDecl, StructDecl, UnsafeStructDecl } from "../ast/nodes.ts";
import type { MonomorphizedStruct } from "../checker/generics.ts";
import type { StructType } from "../checker/types";
import type {
  KirBlock,
  KirFunction,
  KirInst,
  KirParam,
  KirType,
  KirTypeDecl,
  VarId,
} from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

export function lowerStructDecl(
  this: KirLowerer,
  decl: StructDecl | UnsafeStructDecl
): KirTypeDecl {
  const fields = decl.fields.map((f) => ({
    name: f.name,
    type: this.lowerTypeNode(f.typeAnnotation),
  }));

  return {
    name: decl.name,
    type: { kind: "struct", name: decl.name, fields },
  };
}

export function lowerMonomorphizedStruct(
  this: KirLowerer,
  mangledName: string,
  monoStruct: MonomorphizedStruct
): KirTypeDecl {
  const concrete = monoStruct.concrete;
  const fields = Array.from(concrete.fields.entries()).map(([name, fieldType]) => ({
    name,
    type: this.lowerCheckerType(fieldType),
  }));
  return {
    name: mangledName,
    type: { kind: "struct", name: mangledName, fields },
  };
}

export function lowerMethod(
  this: KirLowerer,
  decl: FunctionDecl,
  mangledName: string,
  _structName: string
): KirFunction {
  this.resetFunctionState();

  // Push function-level scope
  this.pushScope();

  const params: KirParam[] = decl.params.map((p) => {
    const type = this.resolveParamType(decl, p.name);
    // The self parameter is passed as a pointer to the struct
    const paramType: KirType =
      p.name === "self" || type.kind === "struct" ? { kind: "ptr", pointee: type } : type;
    const varId: VarId = `%${p.name}`;
    this.varMap.set(p.name, varId);
    return { name: p.name, type: paramType };
  });

  const returnType = this.lowerCheckerType(this.getFunctionReturnType(decl));

  // Set current function return type so lowerReturnStmt can add struct loads
  this.currentFunctionOrigReturnType = returnType;

  // Lower body
  this.lowerBlock(decl.body);

  this.finalizeFunctionBody(false, returnType);

  return {
    name: mangledName,
    params,
    returnType,
    blocks: this.blocks,
    localCount: this.varCounter,
  };
}

/**
 * Synthesize a __destroy KIR function for a struct with auto-generated destroy.
 * Emits field_ptr + call_extern_void("kei_string_destroy") for string fields,
 * and field_ptr + destroy for struct fields that have __destroy.
 */
export function lowerAutoDestroy(
  lowerer: KirLowerer,
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
      insts.push({ kind: "destroy", value: fieldPtr, structName: fieldType.name });
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
 * Takes self by pointer, increments refcounts for string fields via kei_string_copy,
 * calls nested __oncopy for struct fields, then loads and returns the modified struct.
 */
export function lowerAutoOncopy(
  lowerer: KirLowerer,
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
      insts.push({ kind: "oncopy", value: loaded, structName: fieldType.name });
      insts.push({ kind: "store", ptr: fieldPtr, value: loaded });
    }
  }

  // Load the modified struct and return it
  const result = freshVar();
  insts.push({ kind: "load", dest: result, ptr: selfVar, type: structKirType });

  const entryBlock: KirBlock = {
    id: "entry",
    phis: [],
    instructions: insts,
    terminator: { kind: "ret", value: result },
  };

  return {
    name: mangledName,
    params: [{ name: "self", type: selfType }],
    returnType: structKirType,
    blocks: [entryBlock],
    localCount: varCounter,
  };
}
