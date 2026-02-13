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

**Note:** Nested multi-line comments are not supported in version 0.0.1.

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
__free
__refcount
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

#### Raw strings (future)
*Not implemented in v0.0.1, but planned:*
```kei
r"raw string with \n literal backslashes"
r#"raw string with "quotes" inside"#
```

## Keywords

The following identifiers are reserved as keywords:

```
break       case        catch       const       continue    
default     else        enum        extern      false
fn          for         if          import      let
match       move        null        return      ref
struct      throw       throws      true        unsafe
while
```

## Operators

### Arithmetic operators
```kei
+   -   *   /   %   // Basic arithmetic
++  --              // Increment/decrement
```

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
->                  // Pointer dereference and member access
&                   // Address-of
*                   // Dereference
?                   // Optional (future)
```

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
- **Identifiers:** ASCII letters, digits, underscore only (Unicode identifiers not supported in v0.0.1)

---

The lexical structure is designed to be simple, unambiguous, and familiar to programmers coming from C-family languages.