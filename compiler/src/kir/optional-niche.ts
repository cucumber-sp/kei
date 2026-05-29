import type { KirType } from "./kir-types";

export interface OptionalNiche {
  /** Runtime carrier used for Optional<T>; NULL means None. */
  carrierType: KirType;
  /** Source payload type carried by Some(value). */
  payloadType: KirType;
  /** Field to extract/wrap when the payload is a one-field handle struct. */
  payloadField: string | null;
}

/**
 * `Optional<T>` can be represented as plain T when T has a zero/null niche.
 * Raw pointers use themselves as the carrier. One-word `Shared<T>` handles
 * use their single pointer field as the carrier.
 */
export function optionalNiche(type: KirType): OptionalNiche | null {
  if (type.kind !== "enum") return null;
  if (!isOptionalName(type.name)) return null;

  const some = type.variants.find((v) => v.name === "Some");
  const none = type.variants.find((v) => v.name === "None");
  if (!some || !none) return null;
  if (some.fields.length !== 1 || none.fields.length !== 0) return null;

  const payload = some.fields[0]?.type;
  if (!payload) return null;
  if (payload.kind === "ptr") {
    return { carrierType: payload, payloadType: payload, payloadField: null };
  }

  if (payload.kind === "struct" && isSharedName(payload.name) && payload.fields.length === 1) {
    const field = payload.fields[0];
    if (field?.type.kind === "ptr") {
      return { carrierType: field.type, payloadType: payload, payloadField: field.name };
    }
  }

  return null;
}

export function optionalNicheCarrierType(type: KirType): KirType | null {
  return optionalNiche(type)?.carrierType ?? null;
}

function isOptionalName(name: string): boolean {
  return name === "Optional" || name.startsWith("Optional_");
}

function isSharedName(name: string): boolean {
  return name === "Shared" || name.startsWith("Shared_") || name.endsWith("_Shared");
}
