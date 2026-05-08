# Naming conventions

Status: **decisions captured** — design pinned via review pass; spec/tests/
compiler not yet updated to reflect them. This doc is the single source of
truth for identifier-shape decisions across Kei.

This document is a companion to `docs/design/ref-redesign.md`. It captures
how Kei spells the things it has, not what those things mean. The goal is
that stdlib code looks like user code: a stdlib type is just a struct with
the same naming rules every user struct follows.

---

## 1. Conventions table

| Kind                          | Convention                                | Examples                                       |
|-------------------------------|-------------------------------------------|------------------------------------------------|
| Type (struct, enum, alias)    | PascalCase                                | `String`, `Shared<T>`, `User`, `Pair<A, B>`    |
| Lowercase type-keyword alias  | reserved keyword → PascalCase canonical   | `string` → `String`, `array<T>` → `Array<T>`   |
| Compiler intrinsic type       | lowercase (compiler-built, not stdlib)    | `inline<T, N>`                                 |
| Primitive scalar              | lowercase short                           | `i32`, `f64`, `bool`, `usize`, `c_char`        |
| Method                        | camelCase                                 | `lengthSquared`, `pushBack`, `arenaAlloc`      |
| Top-level function            | camelCase                                 | `parseInt`, `arenaMake`, `openFile`            |
| Field                         | camelCase                                 | `userId`, `dbUrl`, `maxConnections`            |
| Local binding (`let`/`const`) | camelCase                                 | `requestBody`, `parsedValue`                   |
| Static / `const` (file-level) | SCREAMING_SNAKE_CASE                      | `MAX_USERS`, `PAGE_SIZE`, `DEFAULT_TIMEOUT_MS` |
| Module name (file)            | snake_case                                | `arena.kei`, `mem.kei`, `net_http.kei`         |
| Lifecycle hook                | `__name` (double-underscore)              | `__oncopy`, `__destroy`                        |
| Operator overload             | `op_<name>` (compiler-recognised table)   | `op_add`, `op_eq`, `op_index`                  |
| Type parameter                | single uppercase letter (or PascalCase)   | `T`, `K`, `V`, `Item`                          |

### Notes

- **Method vs field collision**: methods are camelCase, fields are
  camelCase. They share a namespace within a struct (a field named `name`
  and a method named `name` cannot coexist on the same struct), so the
  compiler rejects the collision. This is the same rule the checker
  enforces today for snake_case names.

- **Two-letter abbreviations** stay capitalised in PascalCase types:
  `IoError`, `HttpRequest`, `Utf8Decoder`. In camelCase identifiers they
  follow the same rule: `ioError`, `httpRequest`, `utf8Decoder`.

- **Acronyms over three letters** are treated as words: `JsonParser`,
  `parseJson`, not `JSONParser` / `parseJSON`.

---

## 2. Lowercase type-keyword aliases

A small set of stdlib types have **lowercase keyword aliases** for
ergonomics on the most-touched names. The lexer keeps these as keywords;
the type-resolver maps each to its PascalCase canonical struct.

| Keyword alias   | Canonical type | Status                                                       |
|-----------------|----------------|--------------------------------------------------------------|
| `string`        | `String`       | stdlib type (target shape — currently C runtime; deferred port) |
| `array<T>`      | `Array<T>`     | stdlib type (planned)                                         |

Notes:

- These two are reserved because they appear constantly in user code and
  the lowercase form reads better at the use site (`fn greet(name: string)`
  beats `fn greet(name: String)` for the most ubiquitous type).

- All other stdlib types — `Shared<T>`, `Weak<T>`, `List<T>`, `Arena`,
  `IoError`, etc. — have **no lowercase alias**. Users write the
  PascalCase name directly.

- `inline<T, N>` is **not** an alias; it's a compiler-intrinsic type
  spelled in lowercase because it's a language primitive, not a stdlib
  struct (no `Inline<T, N>` to alias to).

- The `shared` keyword is dropped from the lexer's reserved list (see
  `docs/design/ref-redesign.md` §6.10). The stdlib type is `Shared<T>`;
  users write that name directly.

---

## 3. Removed: `slice<T>`

`slice<T>` is removed from the language.

### Why

The current implementation has the type wired through the lexer, parser,
checker, and type system (~100 lines), but **zero KIR usage, zero codegen,
zero stdlib `.kei` usage**. No e2e test produces or consumes a slice at
runtime — it's a paper type the checker validates but nothing instantiates.

The use cases it targeted are better served by the redesigned type
vocabulary:

- **Subrange of a refcounted collection** (`String`, `Array<T>`):
  produces the same type with offset/len adjusted and a refcount bump.
  No need for a separate view type — the spec already says CoW types
  return their own type on subranges.

- **Subrange of an `inline<T, N>`**: covered by `ref Inline<T, N>`
  parameters or by index arithmetic inside the function. Pass start/end
  indices alongside if needed; the source's stack lifetime makes this
  trivially safe.

- **C interop boundary**: pass `*T` and `usize` separately in `extern fn`
  signatures. `unsafe`-only by construction; matches C's calling
  convention.

### Migration

| Old                    | New                                                          |
|------------------------|--------------------------------------------------------------|
| `args: slice<string>`  | `args: Array<String>` (cmdline args; cheap if `.rodata`-backed) |
| `s: slice<u8>`         | `s: Array<u8>` (refcounted bytes) or `(p: *u8, len: usize)` in unsafe |
| `inline<T,N>` view     | `ref Inline<T, N>` parameter; `start: usize, end: usize` for sub-range |
| `slice<u8>` in spec    | spec rewrite drops the row                                   |

If a real zero-copy-span use case shows up later, `Slice<T>` (PascalCase
stdlib `unsafe struct` over `*T` + `usize`) is straightforward to add as
a normal stdlib type — no language-level work needed.

---

## 4. Worked example

The same data and operations under the new conventions:

```kei
struct AppConfig {
    readonly dbUrl: string;                 // field: camelCase; type: lowercase alias
    readonly maxConnections: Shared<i32>;   // canonical Shared<T>
    readonly online: Shared<bool>;
}

struct Session {
    userId: i32;
    token: string;
    createdAt: i64;
}

unsafe struct Shared<T> {
    refcount: ref i64;
    value: ref T;

    fn wrap(item: ref T) -> Shared<T> {     // method: camelCase
        let s = Shared<T>{};
        unsafe {
            let block = alloc<u8>(sizeof(i64) + sizeof(T));
            addr(s.refcount) = block as *i64;
            addr(s.value)    = (block + sizeof(i64)) as *T;
            s.refcount = 1;
            init s.value = item;
        }
        return s;
    }

    fn __oncopy(self: ref Shared<T>) {       // lifecycle hook: __name
        self.refcount += 1;
    }

    fn __destroy(self: ref Shared<T>) {
        self.refcount -= 1;
        if self.refcount == 0 {
            self.value.__destroy();
            unsafe { free(addr(self.refcount)); }
        }
    }

    fn sameHandle(self: ref Shared<T>, other: ref Shared<T>) -> bool {
        return addr(self.refcount) == addr(other.refcount);
    }
}

static MAX_RETRIES: i32 = 3;                 // file-level static: SCREAMING_SNAKE
static DEFAULT_TIMEOUT_MS: i64 = 5000;

fn handleRequest(cfg: ref AppConfig, body: ref string) -> string {
    if !cfg.online.value { return "offline"; }
    let parsedBody = parseJson(body);        // local: camelCase; fn: camelCase
    return "ok";
}
```

---

## 5. Migration

The naming conventions doc lands first; downstream commits adopt the new
conventions in passing during the ref-redesign rollout:

- **Spec sweep** — every example, table, and prose reference updated to
  the new conventions in one pass (`spec/03-types.md`, `spec/04-variables
  .md`, `spec/06-functions.md`, `spec/07-structures.md`, `spec/08-memory
  .md`, `spec/13-grammar.md`, `spec/02-lexical.md`, `SPEC-STATUS.md`).
- **Test sweep** — fixture rewrites for the ~hundreds of touch points
  across `compiler/tests/**` (snake_case methods/fields → camelCase;
  `slice<T>` removal; `ptr<T>` → `ref T` / `*T`; `->` → `.` or `(*p).`).
- **Stdlib** — `std/arena.kei` and `std/mem.kei` rename their public
  surfaces (`arena_make` → `arenaMake`, `arena_alloc` → `arenaAlloc`,
  etc.).
- **Compiler** — checker enforces the new conventions cosmetically
  (lints, not hard errors) only after the test sweep is in. The
  language-level rules (`mut` removal, `ref T`, `addr`, `init`,
  `readonly`, `slice<T>` removal) are hard errors per the ref-redesign
  doc.

The expected compatibility break is large — every existing test fixture
that uses snake_case methods or fields will need one mechanical
rename — but the rules are simple enough to be reviewed line-by-line.

---

## 6. Things this doc does not address

- The semantics of any type or operator (lives in `spec/`).
- The lifecycle / reference model (lives in `docs/design/ref-redesign.md`).
- The compiler's mangling scheme for monomorphized generics (internal,
  see `compiler/src/checker/generics.ts`).
- File / directory layout for stdlib modules beyond the snake_case file
  name rule.
