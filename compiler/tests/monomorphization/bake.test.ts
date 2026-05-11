/**
 * `bake` — pure AST clone walker, table-driven unit tests.
 *
 * The bake operation is structured as two cooperating halves (design
 * doc §4). The clone walker tested here is the *pure* first half: it
 * takes a generic template `Declaration` plus a substitution map and
 * returns a fresh AST `Declaration` whose every nested node has a new
 * identity. The second half — populating `Checker.typeMap` keyed by
 * the clone identities — happens during pass-3 body-check and is
 * covered by the end-to-end suite.
 *
 * Cases (per `docs/migrations/monomorphization/pr-4.md`):
 *   (a) struct with `T` field — clone identities + empty genericParams
 *   (b) struct method body — every nested node is a fresh identity
 *   (c) nested generic reference `Bar<T>` — TypeNode is cloned
 *   (d) function with `T` param and `T` return — clone identities
 *   (e) enum with `T` variant payload — variant field TypeNode cloned
 */

import { describe, expect, test } from "bun:test";
import type {
  EnumDecl,
  FunctionDecl,
  GenericType,
  NamedType,
  ReturnStmt,
  StructDecl,
  StructLiteral,
} from "../../src/ast/nodes";
import type { Type } from "../../src/checker/types";
import { TypeKind } from "../../src/checker/types";
import type { Span } from "../../src/lexer/token";
import { bake } from "../../src/monomorphization";

// ─── Fixture helpers ─────────────────────────────────────────────────────

const SPAN: Span = { start: 0, end: 0 };

function named(name: string): NamedType {
  return { kind: "NamedType", span: SPAN, name };
}

function generic(name: string, args: NamedType[]): GenericType {
  return { kind: "GenericType", span: SPAN, name, typeArgs: args };
}

function i32Type(): Type {
  return { kind: TypeKind.Int, bits: 32, signed: true };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("bake", () => {
  test("(a) struct with `T` field: clone has fresh identity, empty genericParams, cloned field TypeNode", () => {
    const template: StructDecl = {
      kind: "StructDecl",
      span: SPAN,
      name: "Box",
      isPublic: true,
      genericParams: ["T"],
      fields: [
        {
          kind: "Field",
          span: SPAN,
          name: "value",
          typeAnnotation: named("T"),
          isReadonly: false,
        },
      ],
      methods: [],
    };

    const subs = new Map<string, Type>([["T", i32Type()]]);
    const cloned = bake(template, subs);

    expect(cloned).not.toBe(template);
    expect(cloned.kind).toBe("StructDecl");
    if (cloned.kind !== "StructDecl") throw new Error("unreachable");
    // Concrete — genericParams cleared so downstream consumers don't
    // mistake the clone for a template.
    expect(cloned.genericParams).toEqual([]);
    // Field is a fresh AST node with a fresh TypeNode.
    expect(cloned.fields).toHaveLength(1);
    const clonedField = cloned.fields[0];
    if (!clonedField) throw new Error("unreachable");
    expect(clonedField).not.toBe(template.fields[0]);
    expect(clonedField.typeAnnotation).not.toBe(template.fields[0]?.typeAnnotation);
    // Field TypeNode keeps its NamedType identity (`T`) — substitution is
    // performed by the checker re-walk via `TypeResolver.setSubstitutions`,
    // not at the AST level.
    expect(clonedField.typeAnnotation.kind).toBe("NamedType");
    if (clonedField.typeAnnotation.kind === "NamedType") {
      expect(clonedField.typeAnnotation.name).toBe("T");
    }
  });

  test("(b) struct method body: every nested statement / expression is a fresh identity", () => {
    const returnStmt: ReturnStmt = {
      kind: "ReturnStmt",
      span: SPAN,
      value: { kind: "Identifier", span: SPAN, name: "self" },
    };
    const method: FunctionDecl = {
      kind: "FunctionDecl",
      span: SPAN,
      name: "get",
      isPublic: true,
      genericParams: [],
      params: [
        {
          kind: "Param",
          span: SPAN,
          name: "self",
          typeAnnotation: named("Self"),
          isReadonly: true,
        },
      ],
      returnType: named("T"),
      throwsTypes: [],
      body: {
        kind: "BlockStmt",
        span: SPAN,
        statements: [returnStmt],
      },
    };
    const template: StructDecl = {
      kind: "StructDecl",
      span: SPAN,
      name: "Box",
      isPublic: true,
      genericParams: ["T"],
      fields: [],
      methods: [method],
    };

    const subs = new Map<string, Type>([["T", i32Type()]]);
    const cloned = bake(template, subs);
    if (cloned.kind !== "StructDecl") throw new Error("unreachable");

    expect(cloned.methods).toHaveLength(1);
    const clonedMethod = cloned.methods[0];
    if (!clonedMethod) throw new Error("unreachable");
    expect(clonedMethod).not.toBe(method);
    expect(clonedMethod.body).not.toBe(method.body);
    expect(clonedMethod.body.statements).toHaveLength(1);
    const clonedReturn = clonedMethod.body.statements[0];
    if (!clonedReturn || clonedReturn.kind !== "ReturnStmt") {
      throw new Error("expected cloned ReturnStmt");
    }
    expect(clonedReturn).not.toBe(returnStmt);
    expect(clonedReturn.value).not.toBe(returnStmt.value);
    // Identifier value cloned with a fresh identity but same name.
    if (!clonedReturn.value || clonedReturn.value.kind !== "Identifier") {
      throw new Error("expected cloned Identifier");
    }
    expect(clonedReturn.value.name).toBe("self");
  });

  test("(c) nested generic reference `Bar<T>` keeps a fresh GenericType node", () => {
    // Template: `struct Foo<T> { inner: Bar<T> }`
    const template: StructDecl = {
      kind: "StructDecl",
      span: SPAN,
      name: "Foo",
      isPublic: true,
      genericParams: ["T"],
      fields: [
        {
          kind: "Field",
          span: SPAN,
          name: "inner",
          typeAnnotation: generic("Bar", [named("T")]),
          isReadonly: false,
        },
      ],
      methods: [],
    };

    const subs = new Map<string, Type>([["T", i32Type()]]);
    const cloned = bake(template, subs);
    if (cloned.kind !== "StructDecl") throw new Error("unreachable");
    const clonedField = cloned.fields[0];
    if (!clonedField) throw new Error("unreachable");
    expect(clonedField.typeAnnotation.kind).toBe("GenericType");
    if (clonedField.typeAnnotation.kind !== "GenericType") {
      throw new Error("unreachable");
    }
    expect(clonedField.typeAnnotation).not.toBe(template.fields[0]?.typeAnnotation);
    expect(clonedField.typeAnnotation.name).toBe("Bar");
    expect(clonedField.typeAnnotation.typeArgs).toHaveLength(1);
    // The inner `T` TypeNode is also a fresh identity. Substitution from
    // `T` to `i32` is the checker's job (via `TypeResolver`); the bake
    // walker is pure AST.
    expect(clonedField.typeAnnotation.typeArgs[0]).not.toBe(
      (template.fields[0]?.typeAnnotation as GenericType).typeArgs[0]
    );
  });

  test("(d) function with `T` param and `T` return: clone is concrete, body identifier cloned", () => {
    const param = {
      kind: "Param" as const,
      span: SPAN,
      name: "x",
      typeAnnotation: named("T"),
      isReadonly: false,
    };
    const idExpr = { kind: "Identifier" as const, span: SPAN, name: "x" };
    const template: FunctionDecl = {
      kind: "FunctionDecl",
      span: SPAN,
      name: "identity",
      isPublic: true,
      genericParams: ["T"],
      params: [param],
      returnType: named("T"),
      throwsTypes: [],
      body: {
        kind: "BlockStmt",
        span: SPAN,
        statements: [{ kind: "ReturnStmt", span: SPAN, value: idExpr }],
      },
    };

    const subs = new Map<string, Type>([["T", i32Type()]]);
    const cloned = bake(template, subs);
    if (cloned.kind !== "FunctionDecl") throw new Error("unreachable");

    expect(cloned).not.toBe(template);
    expect(cloned.genericParams).toEqual([]);
    expect(cloned.params).toHaveLength(1);
    expect(cloned.params[0]).not.toBe(param);
    expect(cloned.params[0]?.typeAnnotation).not.toBe(param.typeAnnotation);
    expect(cloned.returnType).not.toBe(template.returnType);

    // Body Identifier cloned with new identity, same name.
    const stmt = cloned.body.statements[0];
    if (!stmt || stmt.kind !== "ReturnStmt") throw new Error("expected ReturnStmt");
    expect(stmt.value).not.toBe(idExpr);
    if (!stmt.value || stmt.value.kind !== "Identifier") {
      throw new Error("expected Identifier");
    }
    expect(stmt.value.name).toBe("x");
  });

  test("(e) enum with `T` variant payload: variant + field TypeNode cloned with fresh identities", () => {
    const template: EnumDecl = {
      kind: "EnumDecl",
      span: SPAN,
      name: "Optional",
      isPublic: true,
      genericParams: ["T"],
      baseType: null,
      variants: [
        {
          kind: "EnumVariant",
          span: SPAN,
          name: "Some",
          fields: [
            {
              kind: "Field",
              span: SPAN,
              name: "value",
              typeAnnotation: named("T"),
              isReadonly: false,
            },
          ],
          value: null,
        },
        {
          kind: "EnumVariant",
          span: SPAN,
          name: "None",
          fields: [],
          value: null,
        },
      ],
    };

    const subs = new Map<string, Type>([["T", i32Type()]]);
    const cloned = bake(template, subs);
    if (cloned.kind !== "EnumDecl") throw new Error("unreachable");

    expect(cloned).not.toBe(template);
    expect(cloned.genericParams).toEqual([]);
    expect(cloned.variants).toHaveLength(2);
    const someVariant = cloned.variants[0];
    if (!someVariant) throw new Error("unreachable");
    expect(someVariant).not.toBe(template.variants[0]);
    expect(someVariant.fields).toHaveLength(1);
    const field = someVariant.fields[0];
    if (!field) throw new Error("unreachable");
    expect(field).not.toBe(template.variants[0]?.fields[0]);
    expect(field.typeAnnotation).not.toBe(template.variants[0]?.fields[0]?.typeAnnotation);
    expect(field.typeAnnotation.kind).toBe("NamedType");
  });

  test("struct literal in body: typeArgs and field initializers are cloned", () => {
    // `fn make<T>(): Box<T> { return Box<T> { value: x } }`
    const structLit: StructLiteral = {
      kind: "StructLiteral",
      span: SPAN,
      name: "Box",
      typeArgs: [named("T")],
      fields: [
        {
          kind: "FieldInit",
          span: SPAN,
          name: "value",
          value: { kind: "Identifier", span: SPAN, name: "x" },
        },
      ],
    };
    const template: FunctionDecl = {
      kind: "FunctionDecl",
      span: SPAN,
      name: "make",
      isPublic: true,
      genericParams: ["T"],
      params: [
        {
          kind: "Param",
          span: SPAN,
          name: "x",
          typeAnnotation: named("T"),
          isReadonly: false,
        },
      ],
      returnType: generic("Box", [named("T")]),
      throwsTypes: [],
      body: {
        kind: "BlockStmt",
        span: SPAN,
        statements: [{ kind: "ReturnStmt", span: SPAN, value: structLit }],
      },
    };

    const cloned = bake(template, new Map([["T", i32Type()]]));
    if (cloned.kind !== "FunctionDecl") throw new Error("unreachable");

    const ret = cloned.body.statements[0];
    if (!ret || ret.kind !== "ReturnStmt" || !ret.value) {
      throw new Error("expected ReturnStmt with value");
    }
    expect(ret.value).not.toBe(structLit);
    if (ret.value.kind !== "StructLiteral") {
      throw new Error("expected StructLiteral");
    }
    expect(ret.value.typeArgs).toHaveLength(1);
    expect(ret.value.typeArgs[0]).not.toBe(structLit.typeArgs[0]);
    expect(ret.value.fields).toHaveLength(1);
    expect(ret.value.fields[0]).not.toBe(structLit.fields[0]);
    expect(ret.value.fields[0]?.value).not.toBe(structLit.fields[0]?.value);
  });

  test("non-monomorphizable decls round-trip as shallow clones", () => {
    // Defensive — bake is invoked from `check-bodies.ts` only for
    // function / struct / unsafe-struct / enum templates, but the
    // discriminated-union signature must remain total.
    const importDecl = {
      kind: "ImportDecl" as const,
      span: SPAN,
      path: "math",
      items: ["add"],
    };
    const cloned = bake(importDecl, new Map());
    expect(cloned.kind).toBe("ImportDecl");
    if (cloned.kind === "ImportDecl") {
      expect(cloned.path).toBe("math");
      expect(cloned.items).toEqual(["add"]);
    }
  });
});
