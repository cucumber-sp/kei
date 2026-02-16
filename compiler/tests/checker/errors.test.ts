import { describe, test } from "bun:test";
import { checkError, checkOk } from "./helpers.ts";

describe("Checker — Error Handling", () => {
  test("call throws function without catch → error", () => {
    checkError(
      `
        struct NotFound {}
        fn getUser(id: int) -> int throws NotFound {
          if id < 0 { throw NotFound{}; }
          return id;
        }
        fn main() -> int { let x = getUser(1); return 0; }
      `,
      "must use 'catch'"
    );
  });

  test("call throws function with catch handling all types → ok", () => {
    checkOk(`
      struct NotFound {}
      fn getUser(id: int) -> int throws NotFound {
        if id < 0 { throw NotFound{}; }
        return id;
      }
      fn main() -> int {
        let x = getUser(1) catch {
          NotFound: return -1;
        };
        return x;
      }
    `);
  });

  test("catch missing an error type → error", () => {
    checkError(
      `
        struct NotFound {}
        struct DbError { message: string; }
        fn getUser(id: int) -> int throws NotFound, DbError {
          if id < 0 { throw NotFound{}; }
          return id;
        }
        fn main() -> int {
          let x = getUser(1) catch {
            NotFound: return -1;
          };
          return x;
        }
      `,
      "unhandled error types: DbError"
    );
  });

  test("catch with default clause covers remaining → ok", () => {
    checkOk(`
      struct NotFound {}
      struct DbError { message: string; }
      fn getUser(id: int) -> int throws NotFound, DbError {
        if id < 0 { throw NotFound{}; }
        return id;
      }
      fn main() -> int {
        let x = getUser(1) catch {
          NotFound: return -1;
          default: return -2;
        };
        return x;
      }
    `);
  });

  test("catch panic → always ok", () => {
    checkOk(`
      struct NotFound {}
      fn getUser(id: int) -> int throws NotFound {
        if id < 0 { throw NotFound{}; }
        return id;
      }
      fn main() -> int {
        let x = getUser(1) catch panic;
        return x;
      }
    `);
  });

  test("catch throw in function that throws same types → ok", () => {
    checkOk(`
      struct NotFound {}
      fn getUser(id: int) -> int throws NotFound {
        if id < 0 { throw NotFound{}; }
        return id;
      }
      fn loadProfile(id: int) -> int throws NotFound {
        let user = getUser(id) catch throw;
        return user;
      }
    `);
  });

  test("catch throw in function that doesn't throw → error", () => {
    checkError(
      `
        struct NotFound {}
        fn getUser(id: int) -> int throws NotFound {
          if id < 0 { throw NotFound{}; }
          return id;
        }
        fn main() -> int {
          let x = getUser(1) catch throw;
          return x;
        }
      `,
      "does not declare 'throws'"
    );
  });

  test("catch throw with incompatible throws types → error", () => {
    checkError(
      `
        struct NotFound {}
        struct DbError { message: string; }
        fn getUser(id: int) -> int throws NotFound, DbError {
          if id < 0 { throw NotFound{}; }
          return id;
        }
        fn loadProfile(id: int) -> int throws NotFound {
          let user = getUser(id) catch throw;
          return user;
        }
      `,
      "cannot propagate error type 'DbError'"
    );
  });

  test("throw E{} inside function that throws E → ok", () => {
    checkOk(`
      struct AppError {}
      fn doStuff() throws AppError {
        throw AppError{};
      }
    `);
  });

  test("throw E{} inside function that doesn't throw E → error", () => {
    checkError(
      `
        struct AppError {}
        struct OtherError {}
        fn doStuff() throws OtherError {
          throw AppError{};
        }
      `,
      "is not declared in function's throws clause"
    );
  });

  test("throw E{} outside throws function → error", () => {
    checkError(
      `
        struct AppError {}
        fn doStuff() { throw AppError{}; }
      `,
      "does not declare 'throws'"
    );
  });

  test("error type is a valid struct → ok", () => {
    checkOk(`
      struct NotFound {}
      fn getUser(id: int) -> int throws NotFound {
        if id < 0 { throw NotFound{}; }
        return id;
      }
      fn main() -> int {
        let x = getUser(1) catch {
          NotFound: return -1;
        };
        return x;
      }
    `);
  });

  test("nested catch: inner function throws, outer catches", () => {
    checkOk(`
      struct NotFound {}
      fn getUser(id: int) -> int throws NotFound {
        if id < 0 { throw NotFound{}; }
        return id;
      }
      fn processUser(id: int) -> int throws NotFound {
        let user = getUser(id) catch throw;
        return user;
      }
      fn main() -> int {
        let x = processUser(1) catch {
          NotFound: return -1;
        };
        return x;
      }
    `);
  });

  test("catch clause variable has correct error type", () => {
    checkOk(`
      struct DbError { message: string; code: int; }
      fn query() -> int throws DbError {
        throw DbError{ message: "fail", code: 500 };
      }
      fn main() -> int {
        let x = query() catch {
          DbError e: {
            let msg = e.message;
            return -1;
          };
        };
        return x;
      }
    `);
  });

  test("multiple throws types, all handled", () => {
    checkOk(`
      struct NotFound {}
      struct DbError { message: string; }
      struct AuthError {}
      fn getUser(id: int) -> int throws NotFound, DbError, AuthError {
        if id < 0 { throw NotFound{}; }
        return id;
      }
      fn main() -> int {
        let x = getUser(1) catch {
          NotFound: return -1;
          DbError e: return -2;
          AuthError: return -3;
        };
        return x;
      }
    `);
  });

  test("catch throw propagates correctly through call chain", () => {
    checkOk(`
      struct E {}
      fn a() -> int throws E { throw E{}; }
      fn b() -> int throws E { return a() catch throw; }
      fn c() -> int throws E { return b() catch throw; }
      fn main() -> int {
        let x = c() catch { E: return -1; };
        return x;
      }
    `);
  });

  test("non-exhaustive catch without default → error", () => {
    checkError(
      `
        struct A {}
        struct B {}
        fn foo() -> int throws A, B { throw A{}; }
        fn main() -> int {
          let x = foo() catch {
            A: return -1;
          };
          return x;
        }
      `,
      "unhandled error types: B"
    );
  });

  test("throws function with void return type", () => {
    checkOk(`
      struct IOError {}
      fn writeFile() throws IOError {
        throw IOError{};
      }
      fn main() -> int {
        writeFile() catch { IOError: return -1; };
        return 0;
      }
    `);
  });

  test("catch with default variable binding", () => {
    checkOk(`
      struct A {}
      struct B {}
      fn foo() -> int throws A, B { throw A{}; }
      fn main() -> int {
        let x = foo() catch {
          A: return -1;
          default e: return -2;
        };
        return x;
      }
    `);
  });

  test("error type not thrown by callee → error", () => {
    checkError(
      `
        struct A {}
        struct B {}
        fn foo() -> int throws A { throw A{}; }
        fn main() -> int {
          let x = foo() catch {
            A: return -1;
            B: return -2;
          };
          return x;
        }
      `,
      "is not thrown by the callee"
    );
  });
});
