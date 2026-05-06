/**
 * Operator precedence and associativity for Pratt parsing.
 *
 * The single source of truth is {@link OPERATOR_LEVELS}: one row per
 * precedence level, listing every token kind that binds at that level. The
 * lookup maps below are derived from it so the table cannot drift out of sync
 * with itself.
 */

import { TokenKind } from "../lexer/token";

/** Precedence levels — higher number = tighter binding. */
export enum Precedence {
  None = 0,
  Assignment = 1, // = += -= etc.
  LogicalOr = 2, // ||
  LogicalAnd = 3, // &&
  BitwiseOr = 4, // |
  BitwiseXor = 5, // ^
  BitwiseAnd = 6, // &
  Equality = 7, // == !=
  Relational = 8, // < <= > >=
  Shift = 9, // << >>
  Additive = 10, // + -
  Multiplicative = 11, // * / %
  Unary = 12, // ! ~ - &
  Postfix = 13, // . -> [] () ++ --
}

export enum Associativity {
  Left = "Left",
  Right = "Right",
}

export interface BinaryOperatorInfo {
  precedence: Precedence;
  associativity: Associativity;
}

/**
 * Source-of-truth table: every token kind that participates in binary-operator
 * Pratt parsing, grouped by precedence level. Order between levels does not
 * matter for correctness; we list them low → high to mirror the enum.
 */
const OPERATOR_LEVELS: ReadonlyArray<readonly [Precedence, Associativity, ...TokenKind[]]> = [
  [
    Precedence.Assignment,
    Associativity.Right,
    TokenKind.Equal,
    TokenKind.PlusEqual,
    TokenKind.MinusEqual,
    TokenKind.StarEqual,
    TokenKind.SlashEqual,
    TokenKind.PercentEqual,
    TokenKind.AmpEqual,
    TokenKind.PipeEqual,
    TokenKind.CaretEqual,
    TokenKind.LessLessEqual,
    TokenKind.GreaterGreaterEqual,
  ],
  [Precedence.LogicalOr, Associativity.Left, TokenKind.PipePipe],
  [Precedence.LogicalAnd, Associativity.Left, TokenKind.AmpAmp],
  [Precedence.BitwiseOr, Associativity.Left, TokenKind.Pipe],
  [Precedence.BitwiseXor, Associativity.Left, TokenKind.Caret],
  [Precedence.BitwiseAnd, Associativity.Left, TokenKind.Amp],
  [Precedence.Equality, Associativity.Left, TokenKind.EqualEqual, TokenKind.BangEqual],
  [
    Precedence.Relational,
    Associativity.Left,
    TokenKind.Less,
    TokenKind.LessEqual,
    TokenKind.Greater,
    TokenKind.GreaterEqual,
  ],
  [Precedence.Shift, Associativity.Left, TokenKind.LessLess, TokenKind.GreaterGreater],
  [Precedence.Additive, Associativity.Left, TokenKind.Plus, TokenKind.Minus],
  [
    Precedence.Multiplicative,
    Associativity.Left,
    TokenKind.Star,
    TokenKind.Slash,
    TokenKind.Percent,
  ],
];

const BINARY_OPERATORS: ReadonlyMap<TokenKind, BinaryOperatorInfo> = (() => {
  const map = new Map<TokenKind, BinaryOperatorInfo>();
  for (const [precedence, associativity, ...kinds] of OPERATOR_LEVELS) {
    const info: BinaryOperatorInfo = { precedence, associativity };
    for (const kind of kinds) map.set(kind, info);
  }
  return map;
})();

const ASSIGNMENT_OPERATORS: ReadonlySet<TokenKind> = new Set(
  Array.from(BINARY_OPERATORS.entries())
    .filter(([, info]) => info.precedence === Precedence.Assignment)
    .map(([kind]) => kind)
);

/**
 * Look up binary-operator metadata for a token. Returns `undefined` for
 * tokens that aren't binary operators (e.g. literals, keywords, punctuation).
 *
 * Prefer this over the separate `getBinaryPrecedence` / `getBinaryAssociativity`
 * pair when you need both — it avoids a redundant map lookup.
 */
export function getBinaryOperator(kind: TokenKind): BinaryOperatorInfo | undefined {
  return BINARY_OPERATORS.get(kind);
}

export function getBinaryPrecedence(kind: TokenKind): Precedence {
  return BINARY_OPERATORS.get(kind)?.precedence ?? Precedence.None;
}

export function getBinaryAssociativity(kind: TokenKind): Associativity {
  return BINARY_OPERATORS.get(kind)?.associativity ?? Associativity.Left;
}

export function isAssignmentOperator(kind: TokenKind): boolean {
  return ASSIGNMENT_OPERATORS.has(kind);
}

/**
 * Minimum precedence to pass to a recursive parse call after consuming an
 * operator at level `prec` with the given associativity.
 *
 * For left-associative operators we re-enter at `prec` so a same-precedence
 * operator stops the recursion (`a + b + c` → `(a + b) + c`). For
 * right-associative operators we re-enter at `prec - 1` so a same-precedence
 * operator continues recursing (`a = b = c` → `a = (b = c)`).
 */
export function nextMinPrecedence(prec: Precedence, assoc: Associativity): Precedence {
  return assoc === Associativity.Right ? ((prec - 1) as Precedence) : prec;
}
