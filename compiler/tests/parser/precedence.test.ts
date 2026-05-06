import { describe, expect, test } from "bun:test";
import { TokenKind } from "../../src/lexer/token";
import {
  Associativity,
  getBinaryAssociativity,
  getBinaryOperator,
  getBinaryPrecedence,
  isAssignmentOperator,
  nextMinPrecedence,
  Precedence,
} from "../../src/parser/precedence";

const ASSIGNMENT_KINDS = [
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
] as const;

const NON_ASSIGNMENT_BINARY_BY_LEVEL: ReadonlyArray<
  readonly [Precedence, ReadonlyArray<TokenKind>]
> = [
  [Precedence.LogicalOr, [TokenKind.PipePipe]],
  [Precedence.LogicalAnd, [TokenKind.AmpAmp]],
  [Precedence.BitwiseOr, [TokenKind.Pipe]],
  [Precedence.BitwiseXor, [TokenKind.Caret]],
  [Precedence.BitwiseAnd, [TokenKind.Amp]],
  [Precedence.Equality, [TokenKind.EqualEqual, TokenKind.BangEqual]],
  [
    Precedence.Relational,
    [TokenKind.Less, TokenKind.LessEqual, TokenKind.Greater, TokenKind.GreaterEqual],
  ],
  [Precedence.Shift, [TokenKind.LessLess, TokenKind.GreaterGreater]],
  [Precedence.Additive, [TokenKind.Plus, TokenKind.Minus]],
  [Precedence.Multiplicative, [TokenKind.Star, TokenKind.Slash, TokenKind.Percent]],
];

const ALL_BINARY_KINDS: ReadonlyArray<TokenKind> = [
  ...ASSIGNMENT_KINDS,
  ...NON_ASSIGNMENT_BINARY_BY_LEVEL.flatMap(([, kinds]) => kinds),
];

const NON_BINARY_KINDS: ReadonlyArray<TokenKind> = [
  TokenKind.Eof,
  TokenKind.Error,
  TokenKind.IntLiteral,
  TokenKind.FloatLiteral,
  TokenKind.StringLiteral,
  TokenKind.Identifier,
  TokenKind.LeftBrace,
  TokenKind.RightBrace,
  TokenKind.LeftParen,
  TokenKind.RightParen,
  TokenKind.LeftBracket,
  TokenKind.RightBracket,
  TokenKind.Semicolon,
  TokenKind.Colon,
  TokenKind.Comma,
  TokenKind.Question,
  TokenKind.Bang,
  TokenKind.Tilde,
  TokenKind.Arrow,
  TokenKind.FatArrow,
  TokenKind.Dot,
  TokenKind.DotDot,
  TokenKind.DotDotEqual,
  TokenKind.Fn,
  TokenKind.Let,
  TokenKind.If,
  TokenKind.Return,
  TokenKind.True,
  TokenKind.False,
];

describe("Parser — Precedence", () => {
  describe("Precedence enum", () => {
    test("levels are strictly ordered", () => {
      const ordered = [
        Precedence.None,
        Precedence.Assignment,
        Precedence.LogicalOr,
        Precedence.LogicalAnd,
        Precedence.BitwiseOr,
        Precedence.BitwiseXor,
        Precedence.BitwiseAnd,
        Precedence.Equality,
        Precedence.Relational,
        Precedence.Shift,
        Precedence.Additive,
        Precedence.Multiplicative,
        Precedence.Unary,
        Precedence.Postfix,
      ];
      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i]! > ordered[i - 1]!).toBe(true);
      }
    });
  });

  describe("getBinaryOperator", () => {
    test("returns undefined for non-binary tokens", () => {
      for (const kind of NON_BINARY_KINDS) {
        expect(getBinaryOperator(kind)).toBeUndefined();
      }
    });

    test("returns precedence + associativity for every binary operator", () => {
      for (const kind of ALL_BINARY_KINDS) {
        const info = getBinaryOperator(kind);
        expect(info).toBeDefined();
        expect(info?.precedence).toBeGreaterThan(Precedence.None);
        expect(
          info?.associativity === Associativity.Left || info?.associativity === Associativity.Right
        ).toBe(true);
      }
    });

    test("agrees with the legacy precedence/associativity getters", () => {
      for (const kind of ALL_BINARY_KINDS) {
        const info = getBinaryOperator(kind);
        expect(info?.precedence).toBe(getBinaryPrecedence(kind));
        expect(info?.associativity).toBe(getBinaryAssociativity(kind));
      }
    });
  });

  describe("getBinaryPrecedence", () => {
    test("returns Precedence.None for non-binary tokens", () => {
      for (const kind of NON_BINARY_KINDS) {
        expect(getBinaryPrecedence(kind)).toBe(Precedence.None);
      }
    });

    test("places assignment operators at Precedence.Assignment", () => {
      for (const kind of ASSIGNMENT_KINDS) {
        expect(getBinaryPrecedence(kind)).toBe(Precedence.Assignment);
      }
    });

    test("places each non-assignment operator at the expected level", () => {
      for (const [level, kinds] of NON_ASSIGNMENT_BINARY_BY_LEVEL) {
        for (const kind of kinds) {
          expect(getBinaryPrecedence(kind)).toBe(level);
        }
      }
    });

    test("respects standard arithmetic ordering (* binds tighter than +)", () => {
      expect(getBinaryPrecedence(TokenKind.Star)).toBeGreaterThan(
        getBinaryPrecedence(TokenKind.Plus)
      );
      expect(getBinaryPrecedence(TokenKind.Plus)).toBeGreaterThan(
        getBinaryPrecedence(TokenKind.LessLess)
      );
      expect(getBinaryPrecedence(TokenKind.AmpAmp)).toBeGreaterThan(
        getBinaryPrecedence(TokenKind.PipePipe)
      );
    });
  });

  describe("getBinaryAssociativity", () => {
    test("assignment operators are right-associative", () => {
      for (const kind of ASSIGNMENT_KINDS) {
        expect(getBinaryAssociativity(kind)).toBe(Associativity.Right);
      }
    });

    test("every non-assignment binary operator is left-associative", () => {
      for (const [, kinds] of NON_ASSIGNMENT_BINARY_BY_LEVEL) {
        for (const kind of kinds) {
          expect(getBinaryAssociativity(kind)).toBe(Associativity.Left);
        }
      }
    });

    test("defaults to Associativity.Left for non-binary tokens", () => {
      for (const kind of NON_BINARY_KINDS) {
        expect(getBinaryAssociativity(kind)).toBe(Associativity.Left);
      }
    });
  });

  describe("isAssignmentOperator", () => {
    test("matches every assignment operator", () => {
      for (const kind of ASSIGNMENT_KINDS) {
        expect(isAssignmentOperator(kind)).toBe(true);
      }
    });

    test("rejects every non-assignment binary operator", () => {
      for (const [, kinds] of NON_ASSIGNMENT_BINARY_BY_LEVEL) {
        for (const kind of kinds) {
          expect(isAssignmentOperator(kind)).toBe(false);
        }
      }
    });

    test("rejects non-binary tokens", () => {
      for (const kind of NON_BINARY_KINDS) {
        expect(isAssignmentOperator(kind)).toBe(false);
      }
    });
  });

  describe("nextMinPrecedence", () => {
    test("left-associative re-enters at the same precedence", () => {
      expect(nextMinPrecedence(Precedence.Additive, Associativity.Left)).toBe(Precedence.Additive);
      expect(nextMinPrecedence(Precedence.Multiplicative, Associativity.Left)).toBe(
        Precedence.Multiplicative
      );
    });

    test("right-associative re-enters one level lower", () => {
      expect(nextMinPrecedence(Precedence.Assignment, Associativity.Right)).toBe(
        (Precedence.Assignment - 1) as Precedence
      );
      expect(nextMinPrecedence(Precedence.Additive, Associativity.Right)).toBe(
        (Precedence.Additive - 1) as Precedence
      );
    });
  });
});
