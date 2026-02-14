# Modules, Imports & FFI

Kei organizes code into modules and supports interoperability with C libraries through a Foreign Function Interface (FFI). All code is compiled from source for maximum optimization.

## Modules

### File-based modules
Each `.kei` file is a module. The module name is derived from the file path:

```
src/
  main.kei          // module: main
  utils.kei         // module: utils
  net/
    http.kei        // module: net.http
    tcp.kei         // module: net.tcp
  data/
    parser.kei      // module: data.parser
```

### Module structure
A module contains top-level declarations:

```kei
// math.kei
pub fn add(a: int, b: int) -> int {
    return a + b;
}

pub fn multiply(a: int, b: int) -> int {
    return a * b;
}

fn helper() -> int {  // private to this module
    return 42;
}

pub struct Point {
    x: f64;
    y: f64;
}
```

## Visibility

All top-level declarations are **private by default**. Use `pub` to make them visible to other modules:

```kei
pub fn publicFunction() { }      // exported
fn privateFunction() { }         // internal only

pub struct PublicStruct { }      // exported
struct PrivateStruct { }         // internal only

pub static CONFIG_SIZE = 1024;   // exported
static internal_cache = 0;       // internal only
```

**What can be made public:**
- Functions (`pub fn`)
- Structures (`pub struct`, `pub unsafe struct`)
- Type aliases (`pub type`)
- Static constants (`pub static`)
- Enums (`pub enum`)

## Imports

### Module imports
Import entire modules:

```kei
import math;
import net.http;

fn main() -> int {
    let result = math.add(5, 3);
    let server = net.http.Server{ port: 8080 };
    return 0;
}
```

### Selective imports
Import specific items from a module:

```kei
import { add, multiply } from math;
import { Server, Client } from net.http;

fn main() -> int {
    let result = add(5, 3);  // Direct usage
    let server = Server{ port: 8080 };
    return 0;
}
```

### Import resolution
Imports are resolved relative to the source root:

```kei
// From src/main.kei
import utils;           // src/utils.kei
import net.http;        // src/net/http.kei
import data.parser;     // src/data/parser.kei
```

## Dependencies

Kei follows a **source-only** compilation model. All dependencies are `.kei` source files located in the `deps/` directory:

```
myproject/
  src/
    main.kei
  deps/
    json/
      parse.kei       // import json.parse;
      encode.kei      // import json.encode;
    crypto/
      hash.kei        // import crypto.hash;
```

### Dependency management
- **No binary packages** — everything compiled from source
- **No version conflicts** — single version of each dependency
- **Whole-program optimization** — compiler sees all code
- **Simple distribution** — just copy `.kei` files

### Example dependency usage
```kei
// main.kei
import json.parse;
import crypto.hash;

fn main() -> int {
    let data = json.parse.fromString("{\"key\":\"value\"}") catch {
        ParseError: return -1;
    };
    
    let signature = crypto.hash.sha256(data.toString());
    return 0;
}
```

## Foreign Function Interface (FFI)

Kei can interface with C libraries through external function declarations and unsafe structs.

### External function declarations

Declare C functions using `extern fn`:

```kei
extern fn malloc(size: usize) -> ptr<void>;
extern fn free(ptr: ptr<void>);
extern fn printf(fmt: ptr<c_char>, ...) -> int;

// C string functions
extern fn strlen(s: ptr<c_char>) -> usize;
extern fn strcpy(dest: ptr<c_char>, src: ptr<c_char>) -> ptr<c_char>;
```

**Characteristics:**
- No function body — implemented in C
- Uses C calling convention
- May use `ptr<T>` freely (FFI boundary)
- Supports variadic arguments (`...`)

### Safe C library wrappers

The idiomatic pattern is to wrap C libraries in safe Kei interfaces:

```kei
// SQLite wrapper example
extern fn sqlite3_open(filename: ptr<c_char>, db: ptr<ptr<void>>) -> int;
extern fn sqlite3_close(db: ptr<void>) -> int;
extern fn sqlite3_exec(db: ptr<void>, sql: ptr<c_char>, callback: ptr<void>, data: ptr<void>, errmsg: ptr<ptr<c_char>>) -> int;

struct DbError {
    code: int;
    message: string;
}

unsafe struct Database {
    handle: ptr<void>;
    
    fn Database(path: string) -> Database throws DbError {
        let db = Database{ handle: null };
        
        unsafe {
            let c_path = path.toCString();  
            let rc = sqlite3_open(c_path, &db.handle);
            if rc != 0 {
                throw DbError{ code: rc, message: "Failed to open database" };
            }
        }
        
        return db;
    }
    
    fn exec(self: Database, sql: string) -> bool throws DbError {
        unsafe {
            let c_sql = sql.toCString();
            let rc = sqlite3_exec(self.handle, c_sql, null, null, null);
            if rc != 0 {
                throw DbError{ code: rc, message: "Query failed" };
            }
        }
        return true;
    }
    
    fn __destroy(self: Database) {
        unsafe {
            if (self.handle != null) {
                sqlite3_close(self.handle);
            }
        }
    }
}

// Safe usage
fn useDatabase() -> int {
    let db = Database.Database("data.db") catch {
        DbError e: {
            print("Database error: " + e.message);
            return -1;
        };
    };
    
    db.exec("CREATE TABLE users (id INTEGER, name TEXT)") catch {
        DbError e: {
            print("SQL error: " + e.message);
            return -1;
        };
    };
    
    return 0;
}
```

### Type mapping

| Kei Type | C Type | Notes |
|----------|--------|-------|
| `i8` | `int8_t` | |
| `i16` | `int16_t` | |
| `i32` | `int32_t` | |
| `i64` | `int64_t` | |
| `u8` | `uint8_t` | |
| `u16` | `uint16_t` | |
| `u32` | `uint32_t` | |
| `u64` | `uint64_t` | |
| `int` | `int` | Platform dependent |
| `uint` | `unsigned int` | Platform dependent |
| `usize` | `size_t` | Pointer-sized |
| `f32` | `float` | |
| `f64` | `double` | |
| `bool` | `bool` | C99 |
| `c_char` | `char` | C character |
| `ptr<T>` | `T*` | Raw pointer |
| `struct` | `struct` | Direct mapping |

### Linking external libraries

Specify C libraries to link using compiler flags:

```bash
kei build main.kei --link sqlite3 --link math
# Generates: gcc output.c -lsqlite3 -lmath -o main
```

### String handling in FFI

Converting between Kei strings and C strings:

```kei
extern fn puts(s: ptr<c_char>) -> int;

fn printString(message: string) {
    unsafe {
        let c_str = message.toCString();
        puts(c_str);
        // c_str automatically freed when it goes out of scope
    }
}
```

### Memory management across FFI boundary

**Rules for C interop:**
- Kei manages Kei-allocated memory
- C manages C-allocated memory  
- Use `unsafe struct` wrappers to manage C resources
- Always pair C allocation functions (malloc/free, open/close, etc.)

```kei
extern fn fopen(filename: ptr<c_char>, mode: ptr<c_char>) -> ptr<void>;
extern fn fclose(file: ptr<void>) -> int;
extern fn fread(buffer: ptr<void>, size: usize, count: usize, file: ptr<void>) -> usize;

unsafe struct File {
    handle: ptr<void>;
    
    fn File(path: string, mode: string) -> File throws IOError {
        unsafe {
            let c_path = path.toCString();
            let c_mode = mode.toCString();
            let handle = fopen(c_path, c_mode);
            if handle == null {
                throw IOError{ message: "Failed to open file" };
            }
            return File{ handle: handle };
        }
    }
    
    fn read(self: File, buffer: ptr<u8>, size: usize) -> usize {
        unsafe {
            return fread(buffer, 1, size, self.handle);
        }
    }
    
    fn __destroy(self: File) {
        unsafe {
            if (self.handle != null) {
                fclose(self.handle);
            }
        }
    }
}
```

## Module compilation

### Source-only benefits
- **Whole-program optimization:** Compiler sees all code
- **Dead code elimination:** Unused functions removed across modules
- **Inlining:** Cross-module function inlining
- **Monomorphization:** Optimized generic instantiation
- **No ABI dependencies:** Single compilation target

### Build process
```bash
kei build src/main.kei
# 1. Discovers all imports transitively
# 2. Parses all .kei files in src/ and deps/
# 3. Type checks entire program
# 4. Generates optimized KIR
# 5. Compiles to single C file
# 6. Invokes C compiler
```

### Circular dependencies
Circular imports are detected and rejected at compile time:

```kei
// a.kei
import b;  // Error if b.kei imports a

// b.kei  
import a;  // Circular dependency
```

Use forward declarations or restructure code to break cycles.

---

This module system provides simple, predictable code organization while maintaining the performance benefits of source-only compilation and safe interoperability with the C ecosystem.