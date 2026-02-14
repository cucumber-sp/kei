# Error Handling

Kei provides explicit error handling through a `throws`/`catch`/`throw` system that ensures all errors are handled at compile time. There are no exceptions, no automatic propagation, and no hidden control flow.

**Core principle:** Errors are explicit return values that the compiler forces you to handle.

## Overview

Kei's error handling model:
- **No exceptions** — errors don't bypass normal control flow
- **No automatic propagation** — errors must be explicitly handled or forwarded
- **Compile-time enforcement** — unhandled errors cause compilation failures
- **Zero runtime overhead** — implemented as efficient return value checking
- **Exhaustive handling** — all declared error types must be handled

## Function error declaration (`throws`)

Functions declare possible errors using the `throws` keyword in their signature:

```kei
fn getUser(id: int) -> User throws NotFound, DbError {
    if id < 0 {
        throw NotFound{};
    }
    if !dbConnected() {
        throw DbError{ message: "no connection" };
    }
    return User{ name: "Alice", age: 25 };
}
```

**Syntax:**
- `fn name(...) -> ReturnType throws ErrorType1, ErrorType2`
- Functions without `throws` cannot generate errors
- Error types are typically defined as `struct`

## Error handling (`catch`)

Every call to a `throws` function must use `catch` to handle errors. The compiler enforces **exhaustive handling** — missing an error variant is a compile error.

### Full error handling

Handle each error type individually:

```kei
let user = getUser(10) catch {
    NotFound: {
        print("User not found");
        return -1;
    };
    DbError e: {
        print("Database error: " + e.message);
        panic(e.message);
    };
};
// user is valid here — all errors handled
```

### Shorthand forms

For common patterns, Kei provides shorthand syntax:

```kei
// Panic on any error
let user = getUser(10) catch panic;

// Propagate all errors to caller (requires this function to also throw)
let user = getUser(10) catch throw;
```

### Default error handler

Handle multiple error types with a default clause:

```kei
let user = getUser(10) catch {
    NotFound: return null;
    default e: panic("Unexpected error: " + e.toString());
};
```

## Error propagation (`throw`)

If your function declares the same error types, you can propagate errors to the caller:

### Manual propagation

```kei
fn loadProfile(id: int) -> Profile throws NotFound, DbError {
    let user = getUser(id) catch {
        NotFound: throw NotFound{};
        DbError e: throw e;  // forward the error
    };
    return Profile{ user: user };
}
```

### Automatic propagation

Use `catch throw` to propagate all errors automatically:

```kei
fn loadProfile(id: int) -> Profile throws NotFound, DbError {
    let user = getUser(id) catch throw;  // propagate all errors
    return Profile{ user: user };
}
```

### Selective propagation

Handle some errors locally, propagate others:

```kei
fn loadProfile(id: int) -> Profile throws DbError {
    let user = getUser(id) catch {
        NotFound: return Profile.empty();  // handle locally
        DbError e: throw e;                // propagate to caller
    };
    return Profile{ user: user };
}
```

## Error types

Errors are regular Kei types, typically `struct`:

### Simple error types
```kei
struct NotFound {}
struct InvalidInput {
    field: string;
    value: string;
}
```

### Rich error types
```kei
struct DbError {
    message: string;
    error_code: int;
    query: string;

    fn toString(self: DbError) -> string {
        return "DB Error " + self.error_code + ": " + self.message;
    }
}
```

### Error hierarchies
```kei
// Base error interface (future feature)
struct NetworkError {
    message: string;
}

struct TimeoutError {
    network: NetworkError;
    duration_ms: int;
}

struct ConnectionError {
    network: NetworkError;
    host: string;
}
```

## `enum` for data variants (not errors)

`enum` types are for data that can be one of several variants, **not for error handling**:

```kei
enum Shape {
    Circle(radius: f64);
    Rectangle(width: f64, height: f64);
    Point;
}

fn area(shape: Shape) -> f64 {
    switch shape {
        Circle(r): return 3.14159 * r * r;
        Rectangle(w, h): return w * h;
        Point: return 0.0;
    }
}
```

### Simple numeric enums
```kei
enum Color : u8 {
    Red = 0;
    Green = 1;
    Blue = 2;
}

fn colorName(c: Color) -> string {
    switch c {
        Red: return "red";
        Green: return "green";
        Blue: return "blue";
    }
}
```

**Important:** Use `throws`/`catch` for errors, `enum` for data variants.

## Panic for unrecoverable errors

`panic` is for unrecoverable errors that terminate the program:

```kei
fn divide(a: int, b: int) -> int {
    if b == 0 {
        panic("division by zero");
    }
    return a / b;
}
```

**Panic behavior:**
- Immediately terminates the program
- Prints error message and stack trace (in debug builds)
- Cannot be caught or recovered from
- Use for programming errors, not expected failure conditions

### When to use panic vs throws

| Use `panic` for: | Use `throws` for: |
|------------------|-------------------|
| Programming bugs | Expected failures |
| Assertion failures | I/O errors |
| Impossible states | Network timeouts |
| Out of memory | File not found |
| Array bounds (debug) | Invalid user input |

## Compile-time error checking

The compiler enforces several error handling rules:

### Unhandled errors
```kei
fn example() -> int {
    let user = getUser(10);  // ERROR: unhandled throws
    return 0;
}
```

### Missing error variants
```kei
fn example() -> int {
    let user = getUser(10) catch {
        NotFound: return -1;
        // ERROR: DbError not handled
    };
    return 0;
}
```

### Invalid propagation
```kei
fn example() -> int {  // No throws declared
    let user = getUser(10) catch throw;  // ERROR: cannot propagate
    return 0;
}
```

### Type mismatches
```kei
fn example() -> int throws NetworkError {
    // ERROR: cannot propagate DbError as NetworkError
    let user = getUser(10) catch throw;
    return 0;
}
```

## Error handling patterns

### Error accumulation
```kei
fn validateUser(user: User) -> bool throws ValidationError {
    let errors: dynarray<string> = [];
    
    if user.name.isEmpty() {
        errors.push("name required");
    }
    
    if user.age < 0 {
        errors.push("age must be positive");
    }
    
    if errors.len > 0 {
        throw ValidationError{ messages: errors };
    }
    
    return true;
}
```

### Error transformation
```kei
fn loadConfig(path: string) -> Config throws ConfigError {
    let content = readFile(path) catch {
        FileNotFound: throw ConfigError{ message: "config file missing" };
        PermissionDenied: throw ConfigError{ message: "cannot read config" };
    };
    
    return parseConfig(content) catch {
        ParseError e: throw ConfigError{ message: "invalid config: " + e.message };
    };
}
```

### Partial success with cleanup
```kei
fn processFiles(paths: slice<string>) -> int throws ProcessingError {
    let processed = 0;
    defer cleanupTempFiles();
    
    for path in paths {
        processFile(path) catch {
            FileError e: {
                print("Warning: failed to process " + path + ": " + e.message);
                continue;  // skip this file
            };
        };
        processed++;
    }
    
    if processed == 0 {
        throw ProcessingError{ message: "no files processed successfully" };
    }
    
    return processed;
}
```

## Implementation details

### Runtime representation
Errors are implemented as tagged unions at the ABI level:

```c
// Conceptual C representation
typedef struct {
    enum { OK, ERROR_NOT_FOUND, ERROR_DB } tag;
    union {
        User ok_value;
        NotFound not_found;
        DbError db_error;
    } value;
} Result_User_NotFound_DbError;
```

### Performance characteristics
- **Success path:** Single branch check, no allocation
- **Error path:** Structured return with error data
- **Zero overhead:** No stack unwinding or exception handling
- **Compile-time optimization:** Dead code elimination for unused error paths

### Call site generation
```kei
// Source code
let user = getUser(10) catch {
    NotFound: return -1;
    DbError e: panic(e.message);
};
```

```c
// Generated C (conceptual)
Result_User_NotFound_DbError result = getUser(10);
switch (result.tag) {
    case OK:
        User user = result.value.ok_value;
        break;
    case ERROR_NOT_FOUND:
        return -1;
    case ERROR_DB:
        panic(result.value.db_error.message);
}
```

## Best practices

1. **Use throws for expected failures** — file I/O, network operations, user input validation
2. **Use panic for programming errors** — null pointer dereference, array bounds, assertions
3. **Be specific with error types** — avoid generic "Error" types, use descriptive names
4. **Handle errors at the right level** — don't propagate every error to main()
5. **Provide context in error messages** — include relevant data for debugging
6. **Use defer for cleanup** — ensure resources are freed even on error paths
7. **Document error conditions** — clearly specify what errors functions can throw

---

This error handling system ensures that all failure cases are explicitly handled while maintaining zero runtime overhead and compile-time safety.