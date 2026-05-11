/**
 * Lifecycle module — Synthesise sub-concern.
 *
 * Pure transformation: given a struct and its {@link LifecycleDecision},
 * produce the `__destroy` / `__oncopy` `KirFunction` bodies that auto-
 * generated lifecycle hooks lower to.
 *
 * The function-iteration order invariant — spec §6.9 reverse-declaration
 * order for `__destroy` — lives here, not in the decision shape.  Callers
 * cannot accidentally produce wrong-order destroys: they pass a
 * `LifecycleDecision` carrying just the field *names*; this module
 * resolves the field types against the struct (so monomorphization-time
 * concrete types are used) and walks them in the correct direction.
 *
 * No KIR-lowering state is touched: synthesise has no `LoweringCtx`
 * dependency, owns its own `varCounter` and emits self-contained
 * `KirFunction`s with a fresh entry block.  This is what makes the
 * function table-testable without a checker driver — see
 * `tests/lifecycle/synthesise.test.ts`.
 *
 * See `docs/design/lifecycle-module.md` §2 ("Synthesise") and §7 PR 2.
 */

import type { StructType, Type } from "../checker/types";
import { TypeKind } from "../checker/types";
import type { KirBlock, KirFunction, KirInst, KirType, VarId } from "../kir/kir-types";
import type { LifecycleDecision, ManagedFieldRef } from "./types";

/**
 * Build the mangled name used for a struct's auto-generated `__destroy` /
 * `__oncopy` C functions.  Mirrors {@link mangledLifecycleStructName} in
 * `kir/lowering-scope.ts` — kept private to this module to avoid an
 * `import` from `kir/` (Lifecycle has no other dependencies on KIR
 * lowering, and that's the point of the migration).
 */
function mangledStructPrefix(struct: StructType): string {
  return struct.modulePrefix ? `${struct.modulePrefix}_${struct.name}` : struct.name;
}

/**
 * Produce the auto-generated `__destroy` / `__oncopy` KIR functions for
 * a struct, given its {@link LifecycleDecision}.  Returns an empty array
 * if neither arm is present in the decision.
 *
 * Field iteration order:
 *   - `__destroy` walks fields in **reverse declaration order** (spec
 *     §6.9): a later-declared field that holds a reference into an
 *     earlier-declared one is torn down first.
 *   - `__oncopy` walks fields in declaration order — the copy hook does
 *     not have an analogous ordering constraint.
 *
 * Field types are looked up off `struct.fields` rather than carried on
 * the decision: monomorphization may produce concrete types after
 * Decide ran, so the decision only carries names and synthesise
 * re-resolves at emit time.
 */
export function synthesise(struct: StructType, decision: LifecycleDecision): KirFunction[] {
  const out: KirFunction[] = [];
  const structPrefix = mangledStructPrefix(struct);

  if (decision.destroy) {
    out.push(synthesiseDestroy(struct, structPrefix, decision.destroy.fields));
  }
  if (decision.oncopy) {
    out.push(synthesiseOncopy(struct, structPrefix, decision.oncopy.fields));
  }

  return out;
}

/** Build the `__destroy` KIR function. */
function synthesiseDestroy(
  struct: StructType,
  structPrefix: string,
  fields: readonly ManagedFieldRef[]
): KirFunction {
  const mangledName = `${structPrefix}___destroy`;
  const structKirType: KirType = { kind: "struct", name: struct.name, fields: [] };
  const selfType: KirType = { kind: "ptr", pointee: structKirType };

  const insts: KirInst[] = [];
  let varCounter = 0;
  const freshVar = (): VarId => `%_v${varCounter++}` as VarId;
  const selfVar: VarId = "%self" as VarId;

  // Spec §6.9: reverse declaration order so a later-declared field that
  // borrows into an earlier-declared one is torn down first.  The
  // decision carries fields in declaration order; we reverse here.
  for (const field of [...fields].reverse()) {
    const fieldType = struct.fields.get(field.name);
    if (!fieldType) continue;
    emitDestroyField(insts, freshVar, selfVar, field.name, fieldType);
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

/** Build the `__oncopy` KIR function. */
function synthesiseOncopy(
  struct: StructType,
  structPrefix: string,
  fields: readonly ManagedFieldRef[]
): KirFunction {
  const mangledName = `${structPrefix}___oncopy`;
  const structKirType: KirType = { kind: "struct", name: struct.name, fields: [] };
  const selfType: KirType = { kind: "ptr", pointee: structKirType };

  const insts: KirInst[] = [];
  let varCounter = 0;
  const freshVar = (): VarId => `%_v${varCounter++}` as VarId;
  const selfVar: VarId = "%self" as VarId;

  for (const field of fields) {
    const fieldType = struct.fields.get(field.name);
    if (!fieldType) continue;
    emitOncopyField(insts, freshVar, selfVar, field.name, fieldType);
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
 * Emit the destroy sequence for a single field.  String fields call
 * `kei_string_destroy`; nested managed structs recurse via the nested
 * struct's own `__destroy`.
 */
function emitDestroyField(
  insts: KirInst[],
  freshVar: () => VarId,
  selfVar: VarId,
  fieldName: string,
  fieldType: Type
): void {
  if (fieldType.kind === TypeKind.String) {
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
    return;
  }
  if (
    fieldType.kind === TypeKind.Struct &&
    (fieldType.methods.has("__destroy") || fieldType.autoDestroy === true)
  ) {
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
      structName: mangledStructPrefix(fieldType),
    });
  }
}

/**
 * Emit the oncopy sequence for a single field.  String fields use
 * `kei_string_copy` (refcount bump for COW strings); nested managed
 * structs recurse via the nested struct's own `__oncopy`.
 */
function emitOncopyField(
  insts: KirInst[],
  freshVar: () => VarId,
  selfVar: VarId,
  fieldName: string,
  fieldType: Type
): void {
  if (fieldType.kind === TypeKind.String) {
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
    return;
  }
  if (
    fieldType.kind === TypeKind.Struct &&
    (fieldType.methods.has("__oncopy") || fieldType.autoOncopy === true)
  ) {
    // The C emit for `oncopy val` becomes `X___oncopy(&val)` (void
    // return), which mutates `val` in place via the pointer.  The
    // surrounding load/store pair propagates the mutation back to the
    // field slot.
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
      structName: mangledStructPrefix(fieldType),
    });
    insts.push({ kind: "store", ptr: fieldPtr, value: loaded });
  }
}
