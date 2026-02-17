// ─── Type Kind Constants ────────────────────────────────────────────────────

export const TypeKind = {
  Int: "int",
  Float: "float",
  Bool: "bool",
  Void: "void",
  String: "string",
  Ptr: "ptr",
  Array: "array",
  Slice: "slice",
  Struct: "struct",
  Enum: "enum",
  Function: "function",
  Null: "null",
  Error: "error",
  Range: "range",
  CChar: "c_char",
  TypeParam: "type_param",
  Module: "module",
} as const;

export type TypeKindValue = (typeof TypeKind)[keyof typeof TypeKind];
