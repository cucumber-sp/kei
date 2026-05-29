import type { KirType } from "./kir-types";

/**
 * `Optional<T>` can be represented as plain T when T has a zero/null niche.
 * The currently-shipped niche is raw pointers: `Optional<*T>` is just `*T`,
 * with NULL representing `None`.
 */
export function optionalNichePayloadType(type: KirType): KirType | null {
  if (type.kind !== "enum") return null;
  if (!isOptionalName(type.name)) return null;

  const some = type.variants.find((v) => v.name === "Some");
  const none = type.variants.find((v) => v.name === "None");
  if (!some || !none) return null;
  if (some.fields.length !== 1 || none.fields.length !== 0) return null;

  const payload = some.fields[0]?.type;
  if (!payload) return null;
  if (payload.kind === "ptr") return payload;

  return null;
}

function isOptionalName(name: string): boolean {
  return name === "Optional" || name.startsWith("Optional_");
}
