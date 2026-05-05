/**
 * Lexer test helpers — wraps the shared pipeline so individual specs don't
 * need to repeat the `new SourceFile / new Lexer / lexer.tokenize` boilerplate.
 */

import type { Diagnostic } from "../../src/errors/diagnostic";
import type { Lexer, Token } from "../../src/lexer";
import { tokenize as tokenizeSource } from "../helpers/pipeline";

export interface LexResult {
  tokens: Token[];
  diagnostics: readonly Diagnostic[];
  lexer: Lexer;
}

/**
 * Tokenize `input` and return tokens, diagnostics, and the lexer instance
 * (for the rare specs that need access to internal state).
 */
export function lex(input: string): LexResult {
  const { tokens, diagnostics, lexer } = tokenizeSource(input);
  return { tokens, diagnostics, lexer };
}

/** Tokenize and return only the resulting tokens. */
export function tokensOf(input: string): Token[] {
  return tokenizeSource(input).tokens;
}
