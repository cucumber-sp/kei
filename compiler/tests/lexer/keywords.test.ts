import { describe, expect, test } from "bun:test";
import { Lexer, TokenKind } from "../../src/lexer/index.ts";
import { SourceFile } from "../../src/utils/source.ts";

function tokenize(input: string) {
  const source = new SourceFile("test.kei", input);
  const lexer = new Lexer(source);
  return { tokens: lexer.tokenize(), diagnostics: lexer.getDiagnostics() };
}

const KEYWORD_MAP: [string, TokenKind][] = [
  ["assert", TokenKind.Assert],
  ["bool", TokenKind.Bool],
  ["break", TokenKind.Break],
  ["case", TokenKind.Case],
  ["catch", TokenKind.Catch],
  ["const", TokenKind.Const],
  ["continue", TokenKind.Continue],
  ["default", TokenKind.Default],
  ["defer", TokenKind.Defer],
  ["else", TokenKind.Else],
  ["enum", TokenKind.Enum],
  ["extern", TokenKind.Extern],
  ["false", TokenKind.False],
  ["fn", TokenKind.Fn],
  ["for", TokenKind.For],
  ["if", TokenKind.If],
  ["import", TokenKind.Import],
  ["in", TokenKind.In],
  ["int", TokenKind.Int],
  ["let", TokenKind.Let],
  ["move", TokenKind.Move],
  ["mut", TokenKind.Mut],
  ["null", TokenKind.Null],
  ["panic", TokenKind.Panic],
  ["ptr", TokenKind.Ptr],
  ["pub", TokenKind.Pub],
  ["require", TokenKind.Require],
  ["return", TokenKind.Return],
  ["self", TokenKind.Self],
  ["static", TokenKind.Static],
  ["string", TokenKind.String],
  ["struct", TokenKind.Struct],
  ["switch", TokenKind.Switch],
  ["throw", TokenKind.Throw],
  ["throws", TokenKind.Throws],
  ["true", TokenKind.True],
  ["type", TokenKind.Type],
  ["uint", TokenKind.Uint],
  ["unsafe", TokenKind.Unsafe],
  ["void", TokenKind.Void],
  ["while", TokenKind.While],
  ["array", TokenKind.Array],
  ["dynarray", TokenKind.Dynarray],
  ["slice", TokenKind.Slice],
  ["byte", TokenKind.Byte],
  ["short", TokenKind.Short],
  ["long", TokenKind.Long],
  ["float", TokenKind.Float],
  ["double", TokenKind.Double],
  ["isize", TokenKind.Isize],
  ["usize", TokenKind.Usize],
  ["i8", TokenKind.I8],
  ["i16", TokenKind.I16],
  ["i32", TokenKind.I32],
  ["i64", TokenKind.I64],
  ["u8", TokenKind.U8],
  ["u16", TokenKind.U16],
  ["u32", TokenKind.U32],
  ["u64", TokenKind.U64],
  ["f32", TokenKind.F32],
  ["f64", TokenKind.F64],
];

describe("keywords", () => {
  for (const [keyword, expectedKind] of KEYWORD_MAP) {
    test(`keyword '${keyword}'`, () => {
      const { tokens } = tokenize(keyword);
      expect(tokens[0]?.kind).toBe(expectedKind);
      expect(tokens[0]?.lexeme).toBe(keyword);
    });
  }

  test("true has boolean value", () => {
    const { tokens } = tokenize("true");
    expect(tokens[0]?.value).toBe(true);
  });

  test("false has boolean value", () => {
    const { tokens } = tokenize("false");
    expect(tokens[0]?.value).toBe(false);
  });

  test("identifiers are not keywords", () => {
    const { tokens } = tokenize("foo bar _test");
    expect(tokens[0]?.kind).toBe(TokenKind.Identifier);
    expect(tokens[1]?.kind).toBe(TokenKind.Identifier);
    expect(tokens[2]?.kind).toBe(TokenKind.Identifier);
  });
});

const RESERVED_KEYWORDS = [
  "async",
  "await",
  "closure",
  "generic",
  "impl",
  "interface",
  "macro",
  "match",
  "override",
  "private",
  "protected",
  "ref",
  "shared",
  "super",
  "trait",
  "virtual",
  "where",
  "yield",
];

describe("reserved keywords", () => {
  for (const keyword of RESERVED_KEYWORDS) {
    test(`reserved keyword '${keyword}' produces diagnostic`, () => {
      const { diagnostics } = tokenize(keyword);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain("reserved for future use");
    });
  }
});
