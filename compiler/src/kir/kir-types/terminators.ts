import type { VarId, BlockId } from "./identifiers";

// ─── Terminators ─────────────────────────────────────────────────────────────

/** Union of all block terminators — exactly one per basic block. */
export type KirTerminator =
  | KirRet
  | KirRetVoid
  | KirJump
  | KirBranch
  | KirSwitch
  | KirUnreachable;

/** Return a value from the function. */
export interface KirRet {
  kind: "ret";
  value: VarId;
}

/** Return void from the function. */
export interface KirRetVoid {
  kind: "ret_void";
}

/** Unconditional jump to a target block. */
export interface KirJump {
  kind: "jump";
  target: BlockId;
}

/** Conditional branch — jumps to `thenBlock` if `cond` is true, else `elseBlock`. */
export interface KirBranch {
  kind: "br";
  cond: VarId;
  thenBlock: BlockId;
  elseBlock: BlockId;
}

/** Multi-way switch on an integer value with a default fallthrough. */
export interface KirSwitch {
  kind: "switch";
  value: VarId;
  cases: { value: VarId; target: BlockId }[];
  defaultBlock: BlockId;
}

/** Marks unreachable code (e.g. after a guaranteed return/panic). */
export interface KirUnreachable {
  kind: "unreachable";
}
