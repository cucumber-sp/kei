import type { BaseNode } from "./base";
import type { Declaration } from "./declarations";

/** Top-level program node — the root of every parsed module. */
export interface Program extends BaseNode {
  kind: "Program";
  declarations: Declaration[];
}
