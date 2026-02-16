/**
 * Operator precedence and associativity for Pratt parsing.
 */

import { TokenKind } from "../lexer/token.ts";

/** Precedence levels — higher number = tighter binding */
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
  Postfix = 13, // . .* [] () ++ --
}

export enum Associativity {
  Left = "Left",
  Right = "Right",
}

interface OperatorInfo {
  precedence: Precedence;
  associativity: Associativity;
}

const BINARY_OPERATORS: ReadonlyMap<TokenKind, OperatorInfo> = new Map([
  // Assignment (right-associative)
  [TokenKind.Equal, { precedence: Precedence.Assignment, associativity: Associativity.Right }],
  [TokenKind.PlusEqual, { precedence: Precedence.Assignment, associativity: Associativity.Right }],
  [TokenKind.MinusEqual, { precedence: Precedence.Assignment, associativity: Associativity.Right }],
  [TokenKind.StarEqual, { precedence: Precedence.Assignment, associativity: Associativity.Right }],
  [TokenKind.SlashEqual, { precedence: Precedence.Assignment, associativity: Associativity.Right }],
  [
    TokenKind.PercentEqual,
    { precedence: Precedence.Assignment, associativity: Associativity.Right },
  ],
  [TokenKind.AmpEqual, { precedence: Precedence.Assignment, associativity: Associativity.Right }],
  [TokenKind.PipeEqual, { precedence: Precedence.Assignment, associativity: Associativity.Right }],
  [TokenKind.CaretEqual, { precedence: Precedence.Assignment, associativity: Associativity.Right }],
  [
    TokenKind.LessLessEqual,
    { precedence: Precedence.Assignment, associativity: Associativity.Right },
  ],
  [
    TokenKind.GreaterGreaterEqual,
    { precedence: Precedence.Assignment, associativity: Associativity.Right },
  ],

  // Logical
  [TokenKind.PipePipe, { precedence: Precedence.LogicalOr, associativity: Associativity.Left }],
  [TokenKind.AmpAmp, { precedence: Precedence.LogicalAnd, associativity: Associativity.Left }],

  // Bitwise
  [TokenKind.Pipe, { precedence: Precedence.BitwiseOr, associativity: Associativity.Left }],
  [TokenKind.Caret, { precedence: Precedence.BitwiseXor, associativity: Associativity.Left }],
  [TokenKind.Amp, { precedence: Precedence.BitwiseAnd, associativity: Associativity.Left }],

  // Equality
  [TokenKind.EqualEqual, { precedence: Precedence.Equality, associativity: Associativity.Left }],
  [TokenKind.BangEqual, { precedence: Precedence.Equality, associativity: Associativity.Left }],

  // Relational
  [TokenKind.Less, { precedence: Precedence.Relational, associativity: Associativity.Left }],
  [TokenKind.LessEqual, { precedence: Precedence.Relational, associativity: Associativity.Left }],
  [TokenKind.Greater, { precedence: Precedence.Relational, associativity: Associativity.Left }],
  [
    TokenKind.GreaterEqual,
    { precedence: Precedence.Relational, associativity: Associativity.Left },
  ],

  // Shift
  [TokenKind.LessLess, { precedence: Precedence.Shift, associativity: Associativity.Left }],
  [TokenKind.GreaterGreater, { precedence: Precedence.Shift, associativity: Associativity.Left }],

  // Additive
  [TokenKind.Plus, { precedence: Precedence.Additive, associativity: Associativity.Left }],
  [TokenKind.Minus, { precedence: Precedence.Additive, associativity: Associativity.Left }],

  // Multiplicative
  [TokenKind.Star, { precedence: Precedence.Multiplicative, associativity: Associativity.Left }],
  [TokenKind.Slash, { precedence: Precedence.Multiplicative, associativity: Associativity.Left }],
  [TokenKind.Percent, { precedence: Precedence.Multiplicative, associativity: Associativity.Left }],
]);

const ASSIGNMENT_OPERATORS: ReadonlySet<TokenKind> = new Set([
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
]);

export function getBinaryPrecedence(kind: TokenKind): Precedence {
  return BINARY_OPERATORS.get(kind)?.precedence ?? Precedence.None;
}

export function getBinaryAssociativity(kind: TokenKind): Associativity {
  return BINARY_OPERATORS.get(kind)?.associativity ?? Associativity.Left;
}

export function isAssignmentOperator(kind: TokenKind): boolean {
  return ASSIGNMENT_OPERATORS.has(kind);
}
