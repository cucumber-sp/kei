import { describe, expect, test } from "bun:test";
import { SourceFile } from "../../src/utils/source";

describe("SourceFile — construction", () => {
  test("preserves filename and content", () => {
    const f = new SourceFile("foo.kei", "abc");
    expect(f.filename).toBe("foo.kei");
    expect(f.content).toBe("abc");
  });

  test("length matches content length", () => {
    expect(new SourceFile("a", "").length).toBe(0);
    expect(new SourceFile("a", "x").length).toBe(1);
    expect(new SourceFile("a", "hello").length).toBe(5);
    expect(new SourceFile("a", "a\nb\nc").length).toBe(5);
  });
});

describe("SourceFile.charAt", () => {
  const f = new SourceFile("a", "abc");

  test("returns each character at its offset", () => {
    expect(f.charAt(0)).toBe("a");
    expect(f.charAt(1)).toBe("b");
    expect(f.charAt(2)).toBe("c");
  });

  test("returns empty string past end-of-content", () => {
    expect(f.charAt(3)).toBe("");
    expect(f.charAt(99)).toBe("");
  });

  test("returns empty string for negative offset", () => {
    expect(f.charAt(-1)).toBe("");
  });
});

describe("SourceFile.lineCol — single-line content", () => {
  const f = new SourceFile("a", "hello");

  test("offset 0 → line 1, col 1", () => {
    expect(f.lineCol(0)).toEqual({ line: 1, column: 1 });
  });

  test("offsets are 1-based columns", () => {
    expect(f.lineCol(1)).toEqual({ line: 1, column: 2 });
    expect(f.lineCol(4)).toEqual({ line: 1, column: 5 });
  });

  test("offset at end-of-string maps to last column + 1", () => {
    expect(f.lineCol(5)).toEqual({ line: 1, column: 6 });
  });
});

describe("SourceFile.lineCol — LF newlines", () => {
  // "a\nb\nc": offsets 0='a', 1='\n', 2='b', 3='\n', 4='c'
  const f = new SourceFile("a", "a\nb\nc");

  test("first character is line 1", () => {
    expect(f.lineCol(0)).toEqual({ line: 1, column: 1 });
  });

  test("newline character itself reports the line it terminates", () => {
    expect(f.lineCol(1)).toEqual({ line: 1, column: 2 });
  });

  test("character right after newline starts the next line", () => {
    expect(f.lineCol(2)).toEqual({ line: 2, column: 1 });
    expect(f.lineCol(4)).toEqual({ line: 3, column: 1 });
  });
});

describe("SourceFile.lineCol — CRLF newlines", () => {
  // "a\r\nb\r\nc": 0='a', 1='\r', 2='\n', 3='b', 4='\r', 5='\n', 6='c'
  const f = new SourceFile("a", "a\r\nb\r\nc");

  test("first character is line 1, col 1", () => {
    expect(f.lineCol(0)).toEqual({ line: 1, column: 1 });
  });

  test("CRLF is treated as a single line break", () => {
    // 'b' is at offset 3, on line 2
    expect(f.lineCol(3)).toEqual({ line: 2, column: 1 });
    // 'c' is at offset 6, on line 3
    expect(f.lineCol(6)).toEqual({ line: 3, column: 1 });
  });
});

describe("SourceFile.lineCol — bare CR newlines", () => {
  // "a\rb\rc"
  const f = new SourceFile("a", "a\rb\rc");

  test("bare CR starts a new line", () => {
    expect(f.lineCol(2)).toEqual({ line: 2, column: 1 });
    expect(f.lineCol(4)).toEqual({ line: 3, column: 1 });
  });
});

describe("SourceFile.lineCol — empty content", () => {
  const f = new SourceFile("empty", "");

  test("offset 0 maps to line 1, col 1", () => {
    expect(f.lineCol(0)).toEqual({ line: 1, column: 1 });
  });
});

describe("SourceFile.lineCol — leading newline", () => {
  // "\nabc": line 1 is empty, line 2 is "abc"
  const f = new SourceFile("a", "\nabc");

  test("offset 0 (the newline) is line 1, col 1", () => {
    expect(f.lineCol(0)).toEqual({ line: 1, column: 1 });
  });

  test("offset 1 ('a') is line 2, col 1", () => {
    expect(f.lineCol(1)).toEqual({ line: 2, column: 1 });
  });
});

describe("SourceFile.lineCol — consecutive blank lines", () => {
  // "a\n\n\nb": offsets 0='a', 1='\n', 2='\n', 3='\n', 4='b'
  // Three newlines in a row exercise the binary search across adjacent
  // line offsets — a regression-prone shape if the offsets array is
  // mishandled.
  const f = new SourceFile("a", "a\n\n\nb");

  test("each blank-line newline maps to its own line number", () => {
    expect(f.lineCol(0)).toEqual({ line: 1, column: 1 });
    expect(f.lineCol(2)).toEqual({ line: 2, column: 1 });
    expect(f.lineCol(3)).toEqual({ line: 3, column: 1 });
    expect(f.lineCol(4)).toEqual({ line: 4, column: 1 });
  });
});

describe("SourceFile.lineCol — performance shape", () => {
  // Large file: ensure binary search lookup is correct over many lines.
  const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`);
  const f = new SourceFile("big", lines.join("\n"));

  test("first byte of each line maps to (line, 1)", () => {
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      expect(f.lineCol(offset)).toEqual({ line: i + 1, column: 1 });
      offset += (lines[i] as string).length + 1; // +1 for the '\n'
    }
  });
});
