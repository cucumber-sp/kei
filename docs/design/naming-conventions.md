# Naming conventions

These conventions describe the intended spelling of Kei identifiers and standard library APIs. They are not all enforced by the compiler. Check [SPEC-STATUS.md](../../SPEC-STATUS.md) before treating a named standard library type as implemented.

| Kind | Convention | Examples |
| --- | --- | --- |
| Struct, enum, type alias | PascalCase | `User`, `Shared<T>`, `Pair<A, B>` |
| Primitive or intrinsic type | Lowercase | `i32`, `bool`, `inline<T, N>` |
| Method and top-level function | camelCase | `pushBack`, `parseInt` |
| Field and local binding | camelCase | `userId`, `parsedValue` |
| File-level static | SCREAMING_SNAKE_CASE | `MAX_USERS` |
| Module file | snake_case | `net_http.kei` |
| Lifecycle hook | Double underscore prefix | `__oncopy`, `__destroy` |
| Operator overload | `op_` prefix | `op_add`, `op_eq` |
| Type parameter | Uppercase letter or PascalCase | `T`, `Item` |

Fields and methods share a namespace inside a struct, so they cannot use the same name. Treat long acronyms as words: `JsonParser` and `parseJson`. Use `IoError` and `ioError` for short abbreviations.

The lowercase `string` spelling is part of the current language. The specification also describes an `array<T>` spelling and planned standard library types; their implementation status is tracked separately. Other standard library types use their PascalCase names, such as `Shared<T>`.

An unsafe pointer-and-length pair can be written as `*T` plus `usize`. For stack-backed arrays, pass a reference to `inline<T, N>` with indices when a subrange is needed. These are API design patterns, not additional language keywords.
