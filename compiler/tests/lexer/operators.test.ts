import { describe, expect, test } from "bun:test";
import { Lexer, TokenKind } from "../../src/lexer/index.ts";
import { SourceFile } from "../../src/utils/source.ts";

function tokenize(input: string) {
  const source = new SourceFile("test.kei", input);
  const lexer = new Lexer(source);
  return lexer.tokenize();
}

const OPERATOR_TESTS: [string, TokenKind][] = [
  ["+", TokenKind.Plus],
  ["-", TokenKind.Minus],
  ["*", TokenKind.Star],
  ["/", TokenKind.Slash],
  ["%", TokenKind.Percent],
  ["++", TokenKind.PlusPlus],
  ["--", TokenKind.MinusMinus],
  ["==", TokenKind.EqualEqual],
  ["!=", TokenKind.BangEqual],
  ["<", TokenKind.Less],
  ["<=", TokenKind.LessEqual],
  [">", TokenKind.Greater],
  [">=", TokenKind.GreaterEqual],
  ["&&", TokenKind.AmpAmp],
  ["||", TokenKind.PipePipe],
  ["!", TokenKind.Bang],
  ["&", TokenKind.Amp],
  ["|", TokenKind.Pipe],
  ["^", TokenKind.Caret],
  ["~", TokenKind.Tilde],
  ["<<", TokenKind.LessLess],
  [">>", TokenKind.GreaterGreater],
  ["=", TokenKind.Equal],
  ["+=", TokenKind.PlusEqual],
  ["-=", TokenKind.MinusEqual],
  ["*=", TokenKind.StarEqual],
  ["/=", TokenKind.SlashEqual],
  ["%=", TokenKind.PercentEqual],
  ["&=", TokenKind.AmpEqual],
  ["|=", TokenKind.PipeEqual],
  ["^=", TokenKind.CaretEqual],
  ["<<=", TokenKind.LessLessEqual],
  [">>=", TokenKind.GreaterGreaterEqual],
  [".", TokenKind.Dot],
  ["->", TokenKind.Arrow],
  ["=>", TokenKind.FatArrow],
  ["{", TokenKind.LeftBrace],
  ["}", TokenKind.RightBrace],
  ["(", TokenKind.LeftParen],
  [")", TokenKind.RightParen],
  ["[", TokenKind.LeftBracket],
  ["]", TokenKind.RightBracket],
  [";", TokenKind.Semicolon],
  [":", TokenKind.Colon],
  [",", TokenKind.Comma],
];

describe("operators and punctuation", () => {
  for (const [op, expectedKind] of OPERATOR_TESTS) {
    test(`operator '${op}'`, () => {
      const tokens = tokenize(op);
      expect(tokens[0]?.kind).toBe(expectedKind);
      expect(tokens[0]?.lexeme).toBe(op);
    });
  }

  test("compound operators in sequence", () => {
    const tokens = tokenize("a <<= b >>= c");
    expect(tokens[1]?.kind).toBe(TokenKind.LessLessEqual);
    expect(tokens[3]?.kind).toBe(TokenKind.GreaterGreaterEqual);
  });
});
