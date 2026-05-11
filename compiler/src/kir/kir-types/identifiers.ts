// ─── Identifiers ─────────────────────────────────────────────────────────────

/** SSA variable identifier, e.g. `"%0"`, `"%x.1"`. */
export type VarId = string;

/** Basic block label, e.g. `"entry"`, `"if.then"`, `"loop.header"`. */
export type BlockId = string;

/**
 * Identifier of a lexical scope frame, used by the Lifecycle marker
 * instructions to pair an entry with its matching exit. Issued by KIR
 * lowering, consumed by the Lifecycle rewrite pass; meaningless after the
 * pass has run (all markers carrying it are dropped).
 *
 * See `docs/design/lifecycle-module.md` §3.
 */
export type ScopeId = number;
