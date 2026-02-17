/**
 * Enum declaration lowering methods for KirLowerer.
 * Handles lowering EnumDecl AST nodes to KIR type declarations.
 * Extracted from lowering-decl.ts for modularity.
 *
 * Note: enum variant construction and access are in lowering-enum.ts.
 */

import type { EnumDecl } from "../ast/nodes.ts";
import type { KirTypeDecl } from "./kir-types.ts";
import type { KirLowerer } from "./lowering.ts";

export function lowerEnumDecl(this: KirLowerer, decl: EnumDecl): KirTypeDecl {
  const variants = decl.variants.map((v) => ({
    name: v.name,
    fields: v.fields.map((f) => ({
      name: f.name,
      type: this.lowerTypeNode(f.typeAnnotation),
    })),
    value: v.value?.kind === "IntLiteral" ? v.value.value : null,
  }));

  return {
    name: decl.name,
    type: { kind: "enum", name: decl.name, variants },
  };
}
