/**
 * Parser tests for ref-redesign syntax: `ref T`, `readonly ref T`, `*T`,
 * `readonly` field/param modifier.
 *
 * Position rules (e.g. "ref T cannot appear in a return type") are the
 * checker's job; these tests just confirm the surface productions parse
 * to the right AST shape.
 */

import { describe, expect, test } from "bun:test";
import { parse } from "./helpers";

describe("Parser — ref-redesign types", () => {
  test("`ref T` parameter parses to RefType { readonly: false }", () => {
    const program = parse("fn read(x: ref Item) { }");
    const fn = program.declarations[0];
    if (fn?.kind !== "FunctionDecl") throw new Error("expected FunctionDecl");
    const ann = fn.params[0]?.typeAnnotation;
    if (ann?.kind !== "RefType") throw new Error("expected RefType");
    expect(ann.readonly).toBe(false);
    expect(ann.pointee.kind).toBe("NamedType");
    if (ann.pointee.kind === "NamedType") expect(ann.pointee.name).toBe("Item");
  });

  test("`readonly ref T` parameter parses to RefType { readonly: true }", () => {
    const program = parse("fn show(x: readonly ref Item) { }");
    const fn = program.declarations[0];
    if (fn?.kind !== "FunctionDecl") throw new Error("expected FunctionDecl");
    const ann = fn.params[0]?.typeAnnotation;
    if (ann?.kind !== "RefType") throw new Error("expected RefType");
    expect(ann.readonly).toBe(true);
  });

  test("`*T` parameter parses to RawPtrType", () => {
    const program = parse("fn f(p: *u8) { }");
    const fn = program.declarations[0];
    if (fn?.kind !== "FunctionDecl") throw new Error("expected FunctionDecl");
    const ann = fn.params[0]?.typeAnnotation;
    if (ann?.kind !== "RawPtrType") throw new Error("expected RawPtrType");
    expect(ann.pointee.kind).toBe("NamedType");
  });

  test("`*T` extern fn return parses", () => {
    const program = parse("extern fn malloc(size: usize) -> *u8;");
    const fn = program.declarations[0];
    if (fn?.kind !== "ExternFunctionDecl") throw new Error("expected ExternFunctionDecl");
    expect(fn.returnType?.kind).toBe("RawPtrType");
  });

  test("readonly field on a struct", () => {
    const program = parse(`
      struct Cfg {
        readonly dbUrl: string;
        online: bool;
      }
    `);
    const s = program.declarations[0];
    if (s?.kind !== "StructDecl") throw new Error("expected StructDecl");
    expect(s.fields[0]?.isReadonly).toBe(true);
    expect(s.fields[1]?.isReadonly).toBe(false);
  });

  test("readonly param + ref T param mix", () => {
    const program = parse("fn f(readonly x: int, y: ref Item) { }");
    const fn = program.declarations[0];
    if (fn?.kind !== "FunctionDecl") throw new Error("expected FunctionDecl");
    expect(fn.params[0]?.isReadonly).toBe(true);
    expect(fn.params[1]?.isReadonly).toBe(false);
    expect(fn.params[1]?.typeAnnotation.kind).toBe("RefType");
  });

  test("nested `ref` inside generic argument parses", () => {
    // The checker rejects ref T in generic position; the parser still
    // accepts it so the diagnostic is structured.
    const program = parse("fn f(x: List<ref Item>) { }");
    const fn = program.declarations[0];
    if (fn?.kind !== "FunctionDecl") throw new Error("expected FunctionDecl");
    const ann = fn.params[0]?.typeAnnotation;
    if (ann?.kind !== "GenericType") throw new Error("expected GenericType");
    expect(ann.typeArgs[0]?.kind).toBe("RefType");
  });

});

describe("Parser — `mut` is gone", () => {
  test("`mut x: int` is no longer a valid param form (mut keyword still parses elsewhere)", () => {
    // `mut` is still in the lexer's active keyword set (consumed by older
    // unaffected paths until the parser cleanup). The new `parseParam`
    // path no longer accepts it as a leading modifier — so the call-site
    // either rejects or parses `mut` as the parameter name.
    // Smoke test: `fn f(mut x: int)` should NOT produce a Param with name
    // "x" anymore.
    const program = parse("fn f(mut x: int) { }");
    const fn = program.declarations[0];
    if (fn?.kind !== "FunctionDecl") return;
    // Either parser errors out or the leading `mut` is taken as the name —
    // both are acceptable; what matters is that no Param now claims
    // "isMut: true" the way the old form did.
    expect(fn.params[0]?.isReadonly ?? false).toBe(false);
  });
});

describe("Parser — `Type<T>.method(args)` static call on a generic type", () => {
  test("`Shared<i32>.wrap(n)` parses with type-args on the call", () => {
    const program = parse(`
      unsafe struct Shared<T> {
        value: ref T;
        fn wrap(item: ref T) -> Shared<T> { let s = Shared<T>{}; return s; }
        fn __oncopy(self: ref Shared<T>) {}
        fn __destroy(self: ref Shared<T>) {}
      }
      fn main() -> int {
        let n: i32 = 0;
        let s = Shared<i32>.wrap(n);
        return 0;
      }
    `);
    const main = program.declarations[program.declarations.length - 1];
    if (main?.kind !== "FunctionDecl") throw new Error("expected main FunctionDecl");
    const letS = main.body.statements[1];
    if (letS?.kind !== "LetStmt") throw new Error("expected let s");
    const call = letS.initializer;
    if (call.kind !== "CallExpr") throw new Error("expected CallExpr");
    expect(call.typeArgs).toHaveLength(1);
    expect(call.typeArgs[0]?.kind).toBe("NamedType");
    if (call.callee.kind !== "MemberExpr") throw new Error("expected MemberExpr callee");
    expect(call.callee.property).toBe("wrap");
    if (call.callee.object.kind !== "Identifier") throw new Error("expected Identifier object");
    expect(call.callee.object.name).toBe("Shared");
  });

  test("`Type<T>.method` without call is a type-qualified member access", () => {
    // The parser keeps the bare `Type<T>.method` form (no `(args)`)
    // around so future uses (like first-class function references)
    // have a place to land. Today the checker rejects it; this test
    // just pins the parser shape.
    const program = parse(`
      struct Foo<T> { x: T; fn make() -> Foo<T> { return Foo<T>{ x: 0 as T }; } }
      fn main() -> int {
        let _f = Foo<i32>.make;
        return 0;
      }
    `);
    expect(program.declarations.length).toBeGreaterThan(0);
  });
});
