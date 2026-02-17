/**
 * Declaration lowering methods for KirLowerer.
 * Extracted from lowering.ts for modularity.
 */

import type {
  Declaration,
  EnumDecl,
  ExternFunctionDecl,
  FunctionDecl,
  StaticDecl,
  StructDecl,
  UnsafeStructDecl,
} from "../ast/nodes.ts";
import type { MonomorphizedFunction, MonomorphizedStruct } from "../checker/generics.ts";
import type {
  KirExtern,
  KirFunction,
  KirGlobal,
  KirParam,
  KirType,
  KirTypeDecl,
  VarId,
} from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

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
function resetFunctionState(self: KirLowerer): void {
  self.blocks = [];
  self.currentInsts = [];
  self.varCounter = 0;
  self.blockCounter = 0;
  self.varMap = new Map();
  self.currentBlockId = "entry";
  self.loopBreakTarget = null;
  self.loopContinueTarget = null;
  self.scopeStack = [];
  self.movedVars = new Set();
}

/** Finalize function body: pop scope, add terminator, seal last block. */
function finalizeFunctionBody(self: KirLowerer, isThrows: boolean, returnType: KirType): void {
  // Emit destroy for function-scope variables before implicit return
  if (!self.isBlockTerminated()) {
    self.popScopeWithDestroy();
  } else {
    self.scopeStack.pop(); // discard without emitting (already returned)
  }

  // Ensure the last block has a terminator
  if (isThrows) {
    if (!self.isBlockTerminated()) {
      const zeroTag = self.emitConstInt(0);
      self.setTerminator({ kind: "ret", value: zeroTag });
    }
  } else {
    self.ensureTerminator(returnType);
  }

  // Seal last block
  self.sealCurrentBlock();
}

/** Add __out and __err pointer params for throws functions. */
function addThrowsParams(self: KirLowerer, params: KirParam[], originalReturnType: KirType): void {
  const outParamId: VarId = `%__out`;
  const errParamId: VarId = `%__err`;
  self.varMap.set("__out", outParamId);
  self.varMap.set("__err", errParamId);
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
  resetFunctionState(this);

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
    addThrowsParams(this, params, originalReturnType);
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

  finalizeFunctionBody(this, isThrows, returnType);

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

export function lowerMethod(
  this: KirLowerer,
  decl: FunctionDecl,
  mangledName: string,
  _structName: string
): KirFunction {
  resetFunctionState(this);

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

  finalizeFunctionBody(this, false, returnType);

  return {
    name: mangledName,
    params,
    returnType,
    blocks: this.blocks,
    localCount: this.varCounter,
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

export function lowerMonomorphizedFunction(
  this: KirLowerer,
  monoFunc: MonomorphizedFunction
): KirFunction {
  // biome-ignore lint/style/noNonNullAssertion: monomorphized functions always have a declaration set before lowering
  const decl = monoFunc.declaration!;
  const concreteType = monoFunc.concrete;

  resetFunctionState(this);

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
    addThrowsParams(this, params, originalReturnType);
  }

  // For throws functions, the actual return type is i32 (tag)
  const returnType = isThrows
    ? { kind: "int" as const, bits: 32 as const, signed: true }
    : originalReturnType;

  // Lower body
  this.lowerBlock(decl.body);

  finalizeFunctionBody(this, isThrows, returnType);

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

export function lowerEnumDecl(this: KirLowerer, decl: EnumDecl): KirTypeDecl {
  const variants = decl.variants.map((v) => ({
    name: v.name,
    fields: v.fields.map((f) => ({
      name: f.name,
      type: this.lowerTypeNode(f.typeAnnotation),
    })),
    value: v.value?.kind === "IntLiteral" ? v.value.value : null,
  }));

  return {
    name: decl.name,
    type: { kind: "enum", name: decl.name, variants },
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
