# Lexical Structure

This document describes the lexical structure of Kei source code - how the compiler breaks source text into tokens.

## Source encoding

All Kei source files must be encoded in **UTF-8**.

```kei
// This is valid Kei source
fn main() -> int {
    print("Hello, 世界! 🌍");
    return 0;
}
```

## Comments

Kei supports two types of comments:

### Single-line comments
```kei
// This is a single-line comment
let x = 42; // Comment at end of line
```

### Multi-line comments
```kei
/*
This is a multi-line comment
that spans multiple lines
*/

let y = /* inline comment */ 10;
```

Nested multi-line comments are not supported.

## Identifiers

Identifiers follow the pattern: `[a-zA-Z_][a-zA-Z0-9_]*`

```kei
// Valid identifiers
let userName = "Alice";
let _private = true;
let count2 = 0;
let snake_case = "valid";
let camelCase = "also valid";

// Invalid identifiers  
let 2count = 0;     // Cannot start with digit
let user-name = ""; // Hyphen not allowed
```

### Reserved prefixes
Identifiers starting with `__` (double underscore) are reserved for compiler-generated symbols.

```kei
// Reserved - compiler use only
__destroy
__oncopy
__kei_internal

// User code should avoid these
```

## Literals

### Integer literals

```kei
42          // Decimal
0xFF        // Hexadecimal (prefix 0x)
0b1010      // Binary (prefix 0b)
0o77        // Octal (prefix 0o)
1_000_000   // Underscores as digit separators
```

**Digit separators:** Underscores can be used anywhere within numeric literals for readability:

```kei
let million = 1_000_000;
let binary = 0b1010_0001_1111_0000;
let hex = 0xFF_EE_DD_CC;
```

### Floating-point literals

```kei
3.14        // Standard decimal notation
1.0e10      // Scientific notation
2.5e-3      // Negative exponent
0.5         // Leading zero optional
.75         // No leading zero
1.          // Trailing zero optional
1_234.567_8 // Digit separators allowed
```

### Boolean literals

```kei
true
false
```

### String literals

Strings are enclosed in double quotes and support escape sequences:

```kei
"hello world"
"line one\nline two"
"tab\there"
"quote: \"hello\""
"backslash: \\"
"null byte: \0"
"hex escape: \x41"  // 'A'
```

#### Supported escape sequences
- `\n` — newline (LF)
- `\t` — tab
- `\r` — carriage return (CR)
- `\\` — backslash
- `\"` — double quote
- `\0` — null byte
- `\xHH` — hexadecimal byte (00-FF)

## Keywords

Active keywords — recognised by the parser today:

```
as          assert      bool        break       byte
case        catch       const       continue    default
defer       double      else        enum        extern
false       float       fn          for         if
import      in          inline      int         let
long        move        mut         null        panic
ptr         pub         require     return      self
short       slice       static      string      struct
switch      throw       throws      true        type
uint        unsafe      void        while

i8  i16  i32  i64  u8  u16  u32  u64  f32  f64  isize  usize
```

`array` is also a keyword; today it parses the same as `inline` shorthand for
fixed-size value arrays (`array<T>` parses but the heap CoW `array<T>` stdlib
type is not yet implemented — see [SPEC-STATUS.md](../SPEC-STATUS.md)).

Reserved keywords — recognised by the lexer but rejected as identifiers; not
yet usable as syntax:

```
async       await       impl        macro       match
ref         shared      super       trait       where
yield
```

`ref` is reserved for safe reference types (`ref T` / `ref mut T`); `match`
is reserved for full pattern-matching with destructuring beyond what `switch`
covers today. Both are spec'd; see [`03-types.md`](./03-types.md) and
[`05-control.md`](./05-control.md).

## Operators

### Arithmetic operators
```kei
+   -   *   /   %   // Basic arithmetic
```

Postfix `++` / `--` are **not** part of Kei. Use `x += 1` / `x -= 1` — one extra keystroke, no evaluation-order surprises.

### Comparison operators  
```kei
==  !=              // Equality
<   <=  >   >=      // Relational
```

### Logical operators
```kei
&&  ||  !           // Logical and, or, not
```

### Bitwise operators
```kei
&   |   ^   ~       // AND, OR, XOR, NOT
<<  >>              // Left shift, right shift
```

### Assignment operators
```kei
=                   // Assignment
+=  -=  *=  /=  %=  // Compound assignment
&=  |=  ^=          // Bitwise compound assignment
<<= >>=             // Shift compound assignment
```

### Other operators
```kei
.                   // Member access
->                  // Pointer dereference and member access (unsafe ptr<T> only)
&                   // Address-of: `&x` -> ref T (safe), ptr<T> (inside unsafe)
&mut                // Mutable address-of: `&mut x` -> ref mut T
*                   // Dereference (prefix) / multiplication (infix)
as                  // Explicit type cast:  let x = a as i32;
?                   // Nullable type suffix: string?, ptr<T>?  (see spec/03-types.md)
```

**`?` is a type-position suffix only.** Kei does not have a ternary operator —
`if` as an expression covers that case. The parser only recognises `?` after a
type (e.g. `string?`, `ptr<T>?`, after `->` or `:` in type position).

## Separators and punctuation

```kei
{  }                // Braces - block delimiters
(  )                // Parentheses - grouping, function calls
[  ]                // Brackets - array indexing (future)
;                   // Semicolon - statement terminator
:                   // Colon - type annotations
,                   // Comma - separators
.                   // Dot - member access
->                  // Arrow - function return type, pointer member access
=>                  // Fat arrow - match arms (future)
```

## Statement termination

**Semicolons are required** for all statements in Kei:

```kei
let x = 42;         // Required
print("hello");     // Required
return 0;           // Required

// Error - missing semicolon
let y = 10
```

This explicit approach eliminates ambiguity and makes the language easier to parse.

## Whitespace and line endings

- **Whitespace:** Spaces and tabs are used for formatting and are otherwise ignored
- **Line endings:** Any of `\n`, `\r\n`, or `\r` are accepted
- **Indentation:** Not significant (unlike Python)

```kei
// These are equivalent
fn compact()->int{return 0;}

fn readable() -> int {
    return 0;
}
```

## Character encoding details

- **Source files:** Must be valid UTF-8
- **String literals:** UTF-8 encoded
- **Identifiers:** ASCII letters, digits, underscore only (Unicode identifiers are not supported)

---

The lexical structure is designed to be simple, unambiguous, and familiar to programmers coming from C-family languages.