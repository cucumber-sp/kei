# Control Flow

Kei provides familiar control flow constructs with some modern improvements for safety and clarity.

## Conditional statements

### `if` / `else`

Basic conditional execution with optional `else` and `else if` clauses:

```kei
if condition {
    // executed if condition is true
} else if other_condition {
    // executed if other_condition is true
} else {
    // executed if all conditions are false
}
```

**Syntax notes:**
- Parentheses around conditions are **optional**: `if (x > 0)` and `if x > 0` are both valid
- Braces around blocks are **required** - single statements must still be wrapped in braces
- Conditions must evaluate to `bool` type

### `if` as expression

`if` statements can be used as expressions when all branches return the same type:

```kei
let x = if a > b { a } else { b };  // ternary-like behavior

let message = if error_count > 0 {
    "Errors occurred"
} else {
    "Success"
};

fn max(a: int, b: int) -> int {
    return if a > b { a } else { b };
}
```

**Requirements for `if` expressions:**
- Must have an `else` clause (all paths must return a value)
- All branches must return the same type
- Cannot contain statements that don't produce values (like bare function calls)

## Loops

### `while` loops

Traditional condition-based looping:

```kei
while condition {
    // loop body
    if should_exit {
        break;
    }
    if should_skip {
        continue;
    }
}
```

### `for` loops

Kei provides iterator-based for loops that work with ranges and collections:

#### Range iteration
```kei
for i in 0..10 {       // 0 to 9 (exclusive)
    print(i);
}

for i in 0..=10 {      // 0 to 10 (inclusive)
    print(i);
}
```

#### Collection iteration
```kei
let numbers = [1, 2, 3, 4, 5];

// Iterate over elements
for item in numbers {
    print(item);
}

// Iterate with index
for item, index in numbers {
    print("numbers[" + index + "] = " + item);
}
```

**Supported collection types:**
- `array<T, N>` — fixed-size arrays
- `dynarray<T>` — dynamic arrays  
- `slice<T>` — array slices

#### Loop variable scope
Loop variables are scoped to the loop body:

```kei
for i in 0..5 {
    let doubled = i * 2;  // i is accessible here
}
// i and doubled not accessible here
```

### Loop control

#### `break`
Exit the innermost loop immediately:

```kei
while true {
    let input = getInput();
    if input == "quit" {
        break;  // exit the while loop
    }
    process(input);
}
```

#### `continue`
Skip the rest of the current iteration and continue with the next:

```kei
for i in 0..10 {
    if i % 2 == 0 {
        continue;  // skip even numbers
    }
    print(i);  // only odd numbers printed
}
```

## Pattern matching

### `switch` statements

`switch` provides efficient multi-way branching with no fall-through:

```kei
switch value {
    case 1: 
        doA();
    case 2, 3: 
        doB();        // multiple values in one case
    case 4..10: 
        doC();        // range matching
    default: 
        doD();        // default case
}
```

**Key features:**
- **No fall-through** — each case executes independently
- **Multiple values** — `case 2, 3:` matches either 2 or 3
- **Range matching** — `case 4..10:` matches 4 through 9
- **Exhaustiveness** — compiler ensures all possible values are handled when used with enums

#### `switch` with enums
When switching on enum values, the compiler enforces exhaustiveness:

```kei
enum Color { Red, Green, Blue }

fn describe(c: Color) -> string {
    switch c {
        case Red: return "warm";
        case Green: return "natural";  
        case Blue: return "cool";
        // no default needed - all cases covered
    }
}
```

#### `switch` as expression
Like `if`, `switch` can be used as an expression:

```kei
let description = switch status_code {
    case 200: "OK";
    case 404: "Not Found";
    case 500: "Server Error";
    default: "Unknown";
};
```

### `match` statements (future)

*Planned for future versions - advanced pattern matching with destructuring:*

```kei
match shape {
    Circle(radius): return 3.14 * radius * radius;
    Rectangle(w, h): return w * h;
    Point: return 0.0;
}
```

## Scope and cleanup

### `defer` statements

`defer` ensures cleanup code runs when leaving the current scope, regardless of how the scope is exited:

```kei
fn example() {
    let file = openFile("data.txt");
    defer closeFile(file);  // always runs at end of scope
    
    if file.is_empty() {
        return;  // closeFile still runs
    }
    
    processFile(file);
    // closeFile runs here too
}
```

**Execution order:**
- Multiple `defer` statements execute in **reverse order** (LIFO - Last In, First Out)
- `defer` statements capture variables by value at the point of declaration

```kei
fn multipleDefer() {
    defer print("First");
    defer print("Second");  
    defer print("Third");
    print("Main");
}
// Output: Main, Third, Second, First
```

**Use cases:**
- Resource cleanup (files, network connections, memory)
- Unlocking mutexes
- Restoring state
- Logging function entry/exit

### Scope-based resource management

Combined with Kei's automatic memory management, `defer` enables RAII-style resource management:

```kei
fn processData() {
    let mutex = acquireLock();
    defer releaseLock(mutex);
    
    let buffer = allocateBuffer(1024);
    defer deallocateBuffer(buffer);
    
    // work with locked, allocated resources
    // cleanup happens automatically in reverse order
}
```

## Control flow and types

### Unreachable code detection

The compiler detects unreachable code after unconditional control flow changes:

```kei
fn example() -> int {
    return 42;
    print("This is unreachable");  // WARNING or ERROR
}
```

### Control flow in expressions

Control flow in expression contexts must ensure all paths produce values:

```kei
// Valid - all paths return a value
let result = switch mode {
    case 1: calculate();
    case 2: estimate();  
    default: 0;
};

// Invalid - some paths don't return values
let result = switch mode {
    case 1: print("calculating");  // doesn't return a value
    case 2: 42;
};
```

---

This control flow system provides familiar constructs with modern safety features, ensuring predictable execution while maintaining the performance characteristics needed for systems programming.