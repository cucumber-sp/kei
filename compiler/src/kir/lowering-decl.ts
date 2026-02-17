/**
 * Declaration lowering methods for KirLowerer.
 * Handles the main declaration dispatch, function declarations,
 * extern functions, and static declarations.
 *
 * Struct/method/lifecycle lowering: lowering-struct.ts
 * Enum declaration lowering: lowering-enum-decl.ts
 */

import type {
  Declaration,
  ExternFunctionDecl,
  FunctionDecl,
  StaticDecl,
} from "../ast/nodes.ts";
import type { MonomorphizedFunction } from "../checker/generics.ts";
import type {
  KirExtern,
  KirFunction,
  KirGlobal,
  KirParam,
  KirType,
  VarId,
} from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";
import { lowerAutoDestroy, lowerAutoOncopy } from "./lowering-struct.ts";

// ─── Declarations ────────────────────────────────────────────────────────

export function lowerDeclaration(this: KirLowerer, decl: Declaration): void {
  switch (decl.kind) {
    case "FunctionDecl":
      // Skip generic function templates — they are instantiated via monomorphization
      if (decl.genericParams.length > 0) break;
      this.functions.push(this.lowerFunction(decl));
      break;
    case "ExternFunctionDecl":
      this.externs.push(this.lowerExternFunction(decl));
      break;
    case "StructDecl":
    case "UnsafeStructDecl":
      // Skip generic struct templates — they are instantiated via monomorphization
      if (decl.genericParams.length > 0) break;
      this.typeDecls.push(this.lowerStructDecl(decl));
      // Lower methods as top-level functions with mangled names
      for (const method of decl.methods) {
        const structPrefix = this.modulePrefix ? `${this.modulePrefix}_${decl.name}` : decl.name;
        const mangledName = `${structPrefix}_${method.name}`;
        this.functions.push(this.lowerMethod(method, mangledName, decl.name));
      }
      // Generate auto __destroy if the checker flagged this struct
      if (this.checkResult.autoDestroyStructs.has(decl.name)) {
        const structType = this.checkResult.autoDestroyStructs.get(decl.name)!;
        const structPrefix = this.modulePrefix ? `${this.modulePrefix}_${decl.name}` : decl.name;
        this.functions.push(lowerAutoDestroy(this, decl.name, structType, structPrefix));
      }
      // Generate auto __oncopy if the checker flagged this struct
      if (this.checkResult.autoOncopyStructs.has(decl.name)) {
        const structType = this.checkResult.autoOncopyStructs.get(decl.name)!;
        const structPrefix = this.modulePrefix ? `${this.modulePrefix}_${decl.name}` : decl.name;
        this.functions.push(lowerAutoOncopy(this, decl.name, structType, structPrefix));
      }
      break;
    case "EnumDecl":
      this.typeDecls.push(this.lowerEnumDecl(decl));
      break;
    case "StaticDecl":
      this.globals.push(this.lowerStaticDecl(decl));
      break;
    case "TypeAlias":
    case "ImportDecl":
      // No KIR output needed
      break;
  }
}

/** Reset per-function state to prepare for lowering a new function body. */
export function resetFunctionState(this: KirLowerer): void {
  this.blocks = [];
  this.currentInsts = [];
  this.varCounter = 0;
  this.blockCounter = 0;
  this.varMap = new Map();
  this.currentBlockId = "entry";
  this.loopBreakTarget = null;
  this.loopContinueTarget = null;
  this.scopeStack = [];
  this.movedVars = new Set();
}

/** Finalize function body: pop scope, add terminator, seal last block. */
export function finalizeFunctionBody(this: KirLowerer, isThrows: boolean, returnType: KirType): void {
  // Emit destroy for function-scope variables before implicit return
  if (!this.isBlockTerminated()) {
    this.popScopeWithDestroy();
  } else {
    this.scopeStack.pop(); // discard without emitting (already returned)
  }

  // Ensure the last block has a terminator
  if (isThrows) {
    if (!this.isBlockTerminated()) {
      const zeroTag = this.emitConstInt(0);
      this.setTerminator({ kind: "ret", value: zeroTag });
    }
  } else {
    this.ensureTerminator(returnType);
  }

  // Seal last block
  this.sealCurrentBlock();
}

/** Add __out and __err pointer params for throws functions. */
export function addThrowsParams(this: KirLowerer, params: KirParam[], originalReturnType: KirType): void {
  const outParamId: VarId = `%__out`;
  const errParamId: VarId = `%__err`;
  this.varMap.set("__out", outParamId);
  this.varMap.set("__err", errParamId);
  params.push({
    name: "__out",
    type: {
      kind: "ptr",
      pointee:
        originalReturnType.kind === "void"
          ? { kind: "int", bits: 8, signed: false }
          : originalReturnType,
    },
  });
  params.push({ name: "__err", type: { kind: "ptr", pointee: { kind: "void" } } });
}

export function lowerFunction(this: KirLowerer, decl: FunctionDecl): KirFunction {
  this.resetFunctionState();

  // Detect throws function
  const isThrows = decl.throwsTypes.length > 0;
  const throwsKirTypes = isThrows ? decl.throwsTypes.map((t) => this.lowerTypeNode(t)) : [];

  const originalReturnType = this.lowerCheckerType(this.getFunctionReturnType(decl));

  // Set current function throws state
  this.currentFunctionThrowsTypes = throwsKirTypes;
  this.currentFunctionOrigReturnType = originalReturnType;

  // Push function-level scope
  this.pushScope();

  const params: KirParam[] = decl.params.map((p) => {
    const type = this.resolveParamType(decl, p.name);
    const varId: VarId = `%${p.name}`;
    this.varMap.set(p.name, varId);
    return { name: p.name, type };
  });

  // For throws functions: add __out and __err pointer params
  if (isThrows) {
    this.addThrowsParams(params, originalReturnType);
  }

  // Track params with lifecycle hooks for destroy on function exit
  for (const p of decl.params) {
    const checkerType = this.resolveParamCheckerType(decl, p.name);
    this.trackScopeVarByType(p.name, `%${p.name}`, checkerType);
  }

  // For throws functions, the actual return type is i32 (tag)
  const returnType = isThrows
    ? { kind: "int" as const, bits: 32 as const, signed: true }
    : originalReturnType;

  // Lower body
  this.lowerBlock(decl.body);

  this.finalizeFunctionBody(isThrows, returnType);

  // Clear throws state
  this.currentFunctionThrowsTypes = [];
  this.currentFunctionOrigReturnType = { kind: "void" };

  // Use mangled name for overloaded functions, and apply module prefix
  let funcName: string;
  if (this.overloadedNames.has(decl.name)) {
    const baseName = this.modulePrefix ? `${this.modulePrefix}_${decl.name}` : decl.name;
    funcName = this.mangleFunctionName(baseName, decl);
  } else if (this.modulePrefix && decl.name !== "main") {
    funcName = `${this.modulePrefix}_${decl.name}`;
  } else {
    funcName = decl.name;
  }

  return {
    name: funcName,
    params,
    returnType,
    blocks: this.blocks,
    localCount: this.varCounter,
    throwsTypes: isThrows ? throwsKirTypes : undefined,
  };
}

export function lowerExternFunction(this: KirLowerer, decl: ExternFunctionDecl): KirExtern {
  const params: KirParam[] = decl.params.map((p) => ({
    name: p.name,
    type: this.lowerTypeNode(p.typeAnnotation),
  }));

  const returnType = decl.returnType
    ? this.lowerTypeNode(decl.returnType)
    : ({ kind: "void" } as KirType);

  return { name: decl.name, params, returnType };
}

export function lowerMonomorphizedFunction(
  this: KirLowerer,
  monoFunc: MonomorphizedFunction
): KirFunction {
  // biome-ignore lint/style/noNonNullAssertion: monomorphized functions always have a declaration set before lowering
  const decl = monoFunc.declaration!;
  const concreteType = monoFunc.concrete;

  this.resetFunctionState();

  // Detect throws function
  const isThrows = concreteType.throwsTypes.length > 0;
  const throwsKirTypes = isThrows
    ? concreteType.throwsTypes.map((t) => this.lowerCheckerType(t))
    : [];

  const originalReturnType = this.lowerCheckerType(concreteType.returnType);

  // Set current function throws state
  this.currentFunctionThrowsTypes = throwsKirTypes;
  this.currentFunctionOrigReturnType = originalReturnType;

  // Push function-level scope
  this.pushScope();

  const params: KirParam[] = [];
  for (let i = 0; i < decl.params.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index i is bounded by decl.params.length
    const p = decl.params[i]!;
    const type = this.lowerCheckerType(concreteType.params[i]?.type);
    const varId: VarId = `%${p.name}`;
    this.varMap.set(p.name, varId);
    params.push({ name: p.name, type });
  }

  // For throws functions: add __out and __err pointer params
  if (isThrows) {
    this.addThrowsParams(params, originalReturnType);
  }

  // For throws functions, the actual return type is i32 (tag)
  const returnType = isThrows
    ? { kind: "int" as const, bits: 32 as const, signed: true }
    : originalReturnType;

  // Set per-instantiation type map override for correct type resolution
  if (monoFunc.bodyTypeMap) {
    this.currentBodyTypeMap = monoFunc.bodyTypeMap;
  }
  if (monoFunc.bodyGenericResolutions) {
    this.currentBodyGenericResolutions = monoFunc.bodyGenericResolutions;
  }

  // Lower body
  this.lowerBlock(decl.body);

  // Clear per-instantiation overrides
  this.currentBodyTypeMap = null;
  this.currentBodyGenericResolutions = null;

  this.finalizeFunctionBody(isThrows, returnType);

  // Clear throws state
  this.currentFunctionThrowsTypes = [];
  this.currentFunctionOrigReturnType = { kind: "void" };

  // Apply module prefix if needed
  let funcName = monoFunc.mangledName;
  if (this.modulePrefix) {
    funcName = `${this.modulePrefix}_${funcName}`;
  }

  return {
    name: funcName,
    params,
    returnType,
    blocks: this.blocks,
    localCount: this.varCounter,
    throwsTypes: isThrows ? throwsKirTypes : undefined,
  };
}

export function lowerStaticDecl(this: KirLowerer, decl: StaticDecl): KirGlobal {
  const type = decl.typeAnnotation
    ? this.lowerTypeNode(decl.typeAnnotation)
    : this.getExprKirType(decl.initializer);

  return {
    name: decl.name,
    type,
    initializer: null,
  };
}
