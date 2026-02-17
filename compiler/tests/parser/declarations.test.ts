import { describe, expect, test } from "bun:test";
import { parse } from "./helpers.ts";

describe("Parser — Declarations", () => {
  test("simple function", () => {
    const program = parse("fn add(a: int, b: int) -> int { return a + b; }");
    expect(program.declarations).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one declaration
    const fn = program.declarations[0]!;
    expect(fn.kind).toBe("FunctionDecl");
    if (fn.kind !== "FunctionDecl") return;
    expect(fn.name).toBe("add");
    expect(fn.isPublic).toBe(false);
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0]?.name).toBe("a");
    expect(fn.returnType).not.toBeNull();
    if (fn.returnType) expect(fn.returnType.kind).toBe("NamedType");
  });

  test("void function", () => {
    const program = parse("fn greet() { }");
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one declaration
    const fn = program.declarations[0]!;
    expect(fn.kind).toBe("FunctionDecl");
    if (fn.kind !== "FunctionDecl") return;
    expect(fn.name).toBe("greet");
    expect(fn.returnType).toBeNull();
    expect(fn.params).toHaveLength(0);
  });

  test("function with throws", () => {
    const program = parse("fn get() -> int throws NotFound, DbError { return 0; }");
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one declaration
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    expect(fn.throwsTypes).toHaveLength(2);
    expect(fn.throwsTypes[0]?.kind).toBe("NamedType");
  });

  test("pub function", () => {
    const program = parse("pub fn helper() -> int { return 1; }");
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one declaration
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    expect(fn.isPublic).toBe(true);
  });

  test("generic function", () => {
    const program = parse("fn identity<T>(x: T) -> T { return x; }");
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one declaration
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    expect(fn.genericParams).toEqual(["T"]);
    expect(fn.params[0]?.typeAnnotation.kind).toBe("NamedType");
  });

  test("extern function", () => {
    const program = parse("extern fn malloc(size: usize) -> ptr<u8>;");
    // biome-ignore lint/style/noNonNullAssertion: test input guarantees at least one declaration
    const fn = program.declarations[0]!;
    expect(fn.kind).toBe("ExternFunctionDecl");
    if (fn.kind !== "ExternFunctionDecl") return;
    expect(fn.name).toBe("malloc");
    expect(fn.params).toHaveLength(1);
    expect(fn.returnType).not.toBeNull();
    if (fn.returnType) {
      expect(fn.returnType.kind).toBe("GenericType");
    }
  });

  test("struct with fields and methods", () => {
    const program = parse(`
      struct Point {
        x: f64;
        y: f64;
        fn length(self: Point) -> f64 {
          return self.x;
        }
      }
    `);
    const s = program.declarations[0]!;
    expect(s.kind).toBe("StructDecl");
    if (s.kind !== "StructDecl") return;
    expect(s.name).toBe("Point");
    expect(s.fields).toHaveLength(2);
    expect(s.methods).toHaveLength(1);
    expect(s.fields[0]?.name).toBe("x");
  });

  test("unsafe struct with lifecycle hooks", () => {
    const program = parse(`
      unsafe struct Buffer {
        data: ptr<u8>;
        size: usize;
        fn __destroy(self: Buffer) { }
        fn __oncopy(self: Buffer) -> Buffer { return self; }
      }
    `);
    const s = program.declarations[0]!;
    expect(s.kind).toBe("UnsafeStructDecl");
    if (s.kind !== "UnsafeStructDecl") return;
    expect(s.fields).toHaveLength(2);
    expect(s.methods).toHaveLength(2);
    expect(s.methods[0]?.name).toBe("__destroy");
    expect(s.methods[1]?.name).toBe("__oncopy");
  });

  test("generic struct", () => {
    const program = parse("struct Pair<A, B> { first: A; second: B; }");
    const s = program.declarations[0]!;
    if (s.kind !== "StructDecl") return;
    expect(s.genericParams).toEqual(["A", "B"]);
    expect(s.fields).toHaveLength(2);
  });

  test("simple enum with base type", () => {
    const program = parse("enum Color : u8 { Red = 0, Green = 1, Blue = 2 }");
    const e = program.declarations[0]!;
    expect(e.kind).toBe("EnumDecl");
    if (e.kind !== "EnumDecl") return;
    expect(e.name).toBe("Color");
    expect(e.baseType).not.toBeNull();
    expect(e.variants).toHaveLength(3);
    expect(e.variants[0]?.name).toBe("Red");
    expect(e.variants[0]?.value).not.toBeNull();
  });

  test("data enum", () => {
    const program = parse("enum Shape { Circle(radius: f64), Rectangle(w: f64, h: f64), Point }");
    const e = program.declarations[0]!;
    if (e.kind !== "EnumDecl") return;
    expect(e.variants).toHaveLength(3);
    expect(e.variants[0]?.fields).toHaveLength(1);
    expect(e.variants[1]?.fields).toHaveLength(2);
    expect(e.variants[2]?.fields).toHaveLength(0);
  });

  test("type alias", () => {
    const program = parse("type Integer = i32;");
    const t = program.declarations[0]!;
    expect(t.kind).toBe("TypeAlias");
    if (t.kind !== "TypeAlias") return;
    expect(t.name).toBe("Integer");
  });

  test("simple import", () => {
    const program = parse("import math;");
    const i = program.declarations[0]!;
    expect(i.kind).toBe("ImportDecl");
    if (i.kind !== "ImportDecl") return;
    expect(i.path).toBe("math");
    expect(i.items).toHaveLength(0);
  });

  test("selective import", () => {
    const program = parse("import { add, mul } from math;");
    const i = program.declarations[0]!;
    if (i.kind !== "ImportDecl") return;
    expect(i.path).toBe("math");
    expect(i.items).toEqual(["add", "mul"]);
  });

  test("static declaration", () => {
    const program = parse("static PAGE_SIZE = 4096;");
    const s = program.declarations[0]!;
    expect(s.kind).toBe("StaticDecl");
    if (s.kind !== "StaticDecl") return;
    expect(s.name).toBe("PAGE_SIZE");
  });

  test("pub struct", () => {
    const program = parse("pub struct User { name: string; }");
    const s = program.declarations[0]!;
    if (s.kind !== "StructDecl") return;
    expect(s.isPublic).toBe(true);
  });

  test("pub enum", () => {
    const program = parse("pub enum Status { Active = 0, Inactive = 1 }");
    const e = program.declarations[0]!;
    if (e.kind !== "EnumDecl") return;
    expect(e.isPublic).toBe(true);
  });

  test("pub type alias", () => {
    const program = parse("pub type Id = u64;");
    const t = program.declarations[0]!;
    if (t.kind !== "TypeAlias") return;
    expect(t.isPublic).toBe(true);
  });

  test("pub static", () => {
    const program = parse("pub static VERSION = 1;");
    const s = program.declarations[0]!;
    if (s.kind !== "StaticDecl") return;
    expect(s.isPublic).toBe(true);
  });

  test("function with mut and move params", () => {
    const program = parse("fn consume(mut x: int, move y: string) { }");
    const fn = program.declarations[0]!;
    if (fn.kind !== "FunctionDecl") return;
    expect(fn.params[0]?.isMut).toBe(true);
    expect(fn.params[0]?.isMove).toBe(false);
    expect(fn.params[1]?.isMut).toBe(false);
    expect(fn.params[1]?.isMove).toBe(true);
  });

  test("dotted import path", () => {
    const program = parse("import net.http;");
    const i = program.declarations[0]!;
    if (i.kind !== "ImportDecl") return;
    expect(i.path).toBe("net.http");
  });
});
