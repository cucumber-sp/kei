import type { KirType, KirStructType, KirEnumType } from "./types";
import type { KirFunction, KirParam } from "./function";
import type { KirInst } from "./instructions";

// ─── Module ──────────────────────────────────────────────────────────────────

/** Top-level KIR module — the unit of compilation. */
export interface KirModule {
  name: string;
  globals: KirGlobal[];
  functions: KirFunction[];
  types: KirTypeDecl[];
  externs: KirExtern[];
}

/** Module-level global variable with optional initializer instructions. */
export interface KirGlobal {
  name: string;
  type: KirType;
  /** Instructions that compute the initial value, or null for zero-init. */
  initializer: KirInst[] | null;
}

/** Named type declaration (struct or enum) at module scope. */
export interface KirTypeDecl {
  name: string;
  type: KirStructType | KirEnumType;
}

/** External (FFI) function declaration — no body. */
export interface KirExtern {
  name: string;
  params: KirParam[];
  returnType: KirType;
}
