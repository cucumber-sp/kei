/**
 * Token types and keyword lookup tables for the Kei language lexer.
 *
 * @module token
 */

/** Byte-offset range within source text (half-open: `[start, end)`). */
export interface Span {
  start: number;
  end: number;
}

/** Discriminator for every token the lexer can produce. */
export enum TokenKind {
  // Special tokens
  Eof = "EOF",
  Error = "Error",

  // Literals
  IntLiteral = "IntLiteral",
  FloatLiteral = "FloatLiteral",
  StringLiteral = "StringLiteral",

  // Identifiers
  Identifier = "Identifier",

  // Keywords — core language
  As = "as",
  Assert = "assert",
  Bool = "bool",
  Break = "break",
  Case = "case",
  Catch = "catch",
  Const = "const",
  Continue = "continue",
  Default = "default",
  Defer = "defer",
  Dynarray = "dynarray",
  Else = "else",
  Enum = "enum",
  Extern = "extern",
  False = "false",
  Fn = "fn",
  For = "for",
  If = "if",
  Import = "import",
  In = "in",
  Int = "int",
  Let = "let",
  Move = "move",
  Mut = "mut",
  Null = "null",
  Panic = "panic",
  Ptr = "ptr",
  Pub = "pub",
  Require = "require",
  Return = "return",
  Self = "self",
  Slice = "slice",
  Static = "static",
  String = "string",
  Struct = "struct",
  Switch = "switch",
  Throw = "throw",
  Throws = "throws",
  True = "true",
  Type = "type",
  Uint = "uint",
  Unsafe = "unsafe",
  Void = "void",
  While = "while",

  // Collection type keywords
  Array = "array",

  // Primitive type keywords
  I8 = "i8",
  I16 = "i16",
  I32 = "i32",
  I64 = "i64",
  U8 = "u8",
  U16 = "u16",
  U32 = "u32",
  U64 = "u64",
  F32 = "f32",
  F64 = "f64",
  Isize = "isize",
  Usize = "usize",

  // Type alias keywords
  Byte = "byte",
  Short = "short",
  Long = "long",
  Float = "float",
  Double = "double",

  // Reserved keywords (future use)
  Async = "async",
  Await = "await",
  Closure = "closure",
  Generic = "generic",
  Impl = "impl",
  Interface = "interface",
  Macro = "macro",
  Match = "match",
  Override = "override",
  Private = "private",
  Protected = "protected",
  Ref = "ref",
  Shared = "shared",
  Super = "super",
  Trait = "trait",
  Virtual = "virtual",
  Where = "where",
  Yield = "yield",

  // Arithmetic operators
  Plus = "+",
  Minus = "-",
  Star = "*",
  Slash = "/",
  Percent = "%",
  PlusPlus = "++",
  MinusMinus = "--",

  // Comparison operators
  EqualEqual = "==",
  BangEqual = "!=",
  Less = "<",
  LessEqual = "<=",
  Greater = ">",
  GreaterEqual = ">=",

  // Logical operators
  AmpAmp = "&&",
  PipePipe = "||",
  Bang = "!",

  // Bitwise operators
  Amp = "&",
  Pipe = "|",
  Caret = "^",
  Tilde = "~",
  LessLess = "<<",
  GreaterGreater = ">>",

  // Assignment operators
  Equal = "=",
  PlusEqual = "+=",
  MinusEqual = "-=",
  StarEqual = "*=",
  SlashEqual = "/=",
  PercentEqual = "%=",
  AmpEqual = "&=",
  PipeEqual = "|=",
  CaretEqual = "^=",
  LessLessEqual = "<<=",
  GreaterGreaterEqual = ">>=",

  // Other operators
  Dot = ".",
  DotDot = "..",
  DotDotEqual = "..=",
  Arrow = "->",
  FatArrow = "=>",
  DotStar = ".*",

  // Punctuation
  LeftBrace = "{",
  RightBrace = "}",
  LeftParen = "(",
  RightParen = ")",
  LeftBracket = "[",
  RightBracket = "]",
  Semicolon = ";",
  Colon = ":",
  Comma = ",",
}

/**
 * A single lexical token produced by the {@link Lexer}.
 *
 * Every token carries its raw source text (`lexeme`), location information,
 * and an optional pre-parsed `value` for literals.
 */
export interface Token {
  kind: TokenKind;
  /** Raw source text that was consumed to produce this token. */
  lexeme: string;
  /** Byte-offset span within the source file. */
  span: Span;
  /** 1-based line number where the token starts. */
  line: number;
  /** 1-based column number where the token starts. */
  column: number;
  /** Pre-parsed literal value (numbers, strings, booleans). */
  value?: number | string | boolean;
}

/** Active keywords — identifiers that map to a specific {@link TokenKind}. */
const KEYWORD_MAP: ReadonlyMap<string, TokenKind> = new Map([
  ["as", TokenKind.As],
  ["assert", TokenKind.Assert],
  ["bool", TokenKind.Bool],
  ["break", TokenKind.Break],
  ["case", TokenKind.Case],
  ["catch", TokenKind.Catch],
  ["const", TokenKind.Const],
  ["continue", TokenKind.Continue],
  ["default", TokenKind.Default],
  ["defer", TokenKind.Defer],
  ["dynarray", TokenKind.Dynarray],
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
  ["slice", TokenKind.Slice],
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
  ["isize", TokenKind.Isize],
  ["usize", TokenKind.Usize],
  ["byte", TokenKind.Byte],
  ["short", TokenKind.Short],
  ["long", TokenKind.Long],
  ["float", TokenKind.Float],
  ["double", TokenKind.Double],
]);

/** Reserved keywords — produce a diagnostic when used as identifiers. */
const RESERVED_KEYWORD_MAP: ReadonlyMap<string, TokenKind> = new Map([
  ["async", TokenKind.Async],
  ["await", TokenKind.Await],
  ["closure", TokenKind.Closure],
  ["generic", TokenKind.Generic],
  ["impl", TokenKind.Impl],
  ["interface", TokenKind.Interface],
  ["macro", TokenKind.Macro],
  ["match", TokenKind.Match],
  ["override", TokenKind.Override],
  ["private", TokenKind.Private],
  ["protected", TokenKind.Protected],
  ["ref", TokenKind.Ref],
  ["shared", TokenKind.Shared],
  ["super", TokenKind.Super],
  ["trait", TokenKind.Trait],
  ["virtual", TokenKind.Virtual],
  ["where", TokenKind.Where],
  ["yield", TokenKind.Yield],
]);

/** Returns the keyword {@link TokenKind} for `identifier`, or `undefined` if it is not a keyword. */
export function lookupKeyword(identifier: string): TokenKind | undefined {
  return KEYWORD_MAP.get(identifier);
}

/** Returns `true` if `identifier` is a reserved keyword (not yet usable in Kei). */
export function isReservedKeyword(identifier: string): boolean {
  return RESERVED_KEYWORD_MAP.has(identifier);
}

/** Returns the {@link TokenKind} for a reserved keyword, or `undefined` if it is not reserved. */
export function getReservedTokenKind(identifier: string): TokenKind | undefined {
  return RESERVED_KEYWORD_MAP.get(identifier);
}
