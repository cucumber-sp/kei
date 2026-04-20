/**
 * AST tree pretty-printer for `--ast` mode.
 *
 * Walks an AST node generically by introspecting its shape: skips `kind` and
 * `span`, prints scalar fields inline, recurses into child nodes/arrays.
 */

export function printAst(node: Record<string, unknown>, indent: number): void {
  const prefix = "  ".repeat(indent);
  const kind = node.kind as string;

  if (kind === "Program") {
    console.log(`${prefix}Program`);
    const decls = node.declarations as Record<string, unknown>[];
    for (const decl of decls) {
      printAst(decl, indent + 1);
    }
    return;
  }

  const simpleFields: string[] = [];
  const childNodes: [string, Record<string, unknown> | Record<string, unknown>[]][] = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === "kind" || key === "span") continue;
    if (value === null || value === undefined) continue;

    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0]?.kind
    ) {
      childNodes.push([key, value as Record<string, unknown>[]]);
    } else if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).kind
    ) {
      childNodes.push([key, value as Record<string, unknown>]);
    } else if (Array.isArray(value)) {
      simpleFields.push(`${key}=[${value.join(", ")}]`);
    } else {
      simpleFields.push(`${key}=${String(value)}`);
    }
  }

  const fieldStr = simpleFields.length > 0 ? ` ${simpleFields.join(" ")}` : "";
  console.log(`${prefix}${kind}${fieldStr}`);

  for (const [key, value] of childNodes) {
    if (Array.isArray(value)) {
      console.log(`${prefix}  ${key}:`);
      for (const child of value) {
        printAst(child, indent + 2);
      }
    } else {
      console.log(`${prefix}  ${key}:`);
      printAst(value, indent + 2);
    }
  }
}
