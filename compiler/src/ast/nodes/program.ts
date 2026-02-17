import type { BaseNode } from "./base.ts";
import type { Declaration } from "./declarations.ts";

/** Top-level program node — the root of every parsed module. */
export interface Program extends BaseNode {
  kind: "Program";
  declarations: Declaration[];
}
