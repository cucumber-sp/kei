import { describe, expect, test } from "bun:test";
import { getInstructions, getTerminators, lower, lowerFunction } from "./helpers.ts";

describe("KIR — Enum variant construction", () => {
  test("data variant construction emits stack_alloc + tag + field stores", () => {
    const fn = lowerFunction(
      `
      enum Shape { Circle(radius: f64), Point }
      fn main() -> int {
        let s: Shape = Shape.Circle(3.14);
        return 0;
      }
      `,
      "main"
    );

    // Should have a stack_alloc for the enum type
    const allocs = getInstructions(fn, "stack_alloc");
    const enumAlloc = allocs.find(
      (i) => i.kind === "stack_alloc" && i.type.kind === "enum" && i.type.name === "Shape"
    );
    expect(enumAlloc).toBeDefined();

    // Should have field_ptr to "tag" and to "data.Circle.radius"
    const fieldPtrs = getInstructions(fn, "field_ptr");
    const tagPtr = fieldPtrs.find((i) => i.kind === "field_ptr" && i.field === "tag");
    expect(tagPtr).toBeDefined();
    const dataPtr = fieldPtrs.find(
      (i) => i.kind === "field_ptr" && i.field === "data.Circle.radius"
    );
    expect(dataPtr).toBeDefined();
  });

  test("fieldless variant on tagged union emits stack_alloc + tag only", () => {
    const fn = lowerFunction(
      `
      enum Shape { Circle(radius: f64), Point }
      fn main() -> int {
        let p: Shape = Shape.Point;
        return 0;
      }
      `,
      "main"
    );

    const allocs = getInstructions(fn, "stack_alloc");
    const enumAlloc = allocs.find(
      (i) => i.kind === "stack_alloc" && i.type.kind === "enum" && i.type.name === "Shape"
    );
    expect(enumAlloc).toBeDefined();

    const fieldPtrs = getInstructions(fn, "field_ptr");
    const tagPtr = fieldPtrs.find((i) => i.kind === "field_ptr" && i.field === "tag");
    expect(tagPtr).toBeDefined();

    // No data field ptrs — only tag
    const dataPtrs = fieldPtrs.filter(
      (i) => i.kind === "field_ptr" && i.field.startsWith("data.")
    );
    expect(dataPtrs.length).toBe(0);
  });

  test("simple enum variant emits const_int (one stack_alloc for the variable)", () => {
    const fn = lowerFunction(
      `
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
      fn main() -> int {
        let c: Color = Color.Red;
        return 0;
      }
      `,
      "main"
    );

    // One stack_alloc for the variable `c`, but no field_ptr (no tag/data setup)
    const allocs = getInstructions(fn, "stack_alloc");
    const enumAllocs = allocs.filter(
      (i) => i.kind === "stack_alloc" && i.type.kind === "enum"
    );
    expect(enumAllocs.length).toBe(1);

    // No field_ptr — simple enum doesn't use tag/data struct
    const fieldPtrs = getInstructions(fn, "field_ptr");
    expect(fieldPtrs.length).toBe(0);

    // Should have const_int for the variant value
    const consts = getInstructions(fn, "const_int");
    const tagConst = consts.find((i) => i.kind === "const_int" && i.value === 0);
    expect(tagConst).toBeDefined();
  });

  test("multi-field data variant construction", () => {
    const fn = lowerFunction(
      `
      enum Shape { Circle(radius: f64), Rect(w: f64, h: f64), Point }
      fn main() -> int {
        let r: Shape = Shape.Rect(1.0, 2.0);
        return 0;
      }
      `,
      "main"
    );

    const fieldPtrs = getInstructions(fn, "field_ptr");
    const tagPtr = fieldPtrs.find((i) => i.kind === "field_ptr" && i.field === "tag");
    expect(tagPtr).toBeDefined();
    const wPtr = fieldPtrs.find((i) => i.kind === "field_ptr" && i.field === "data.Rect.w");
    expect(wPtr).toBeDefined();
    const hPtr = fieldPtrs.find((i) => i.kind === "field_ptr" && i.field === "data.Rect.h");
    expect(hPtr).toBeDefined();
  });
});

describe("KIR — Switch on data variant enum tags", () => {
  test("switch on tagged union enum loads .tag and uses const_int cases", () => {
    const fn = lowerFunction(
      `
      enum Shape { Circle(radius: f64), Point }
      fn main() -> int {
        let s: Shape = Shape.Circle(3.14);
        switch s {
          case Circle: return 1;
          case Point: return 2;
        }
        return 0;
      }
      `,
      "main"
    );

    // Should have a field_ptr to "tag" for loading the switch subject's tag
    const fieldPtrs = getInstructions(fn, "field_ptr");
    const tagLoadPtrs = fieldPtrs.filter((i) => i.kind === "field_ptr" && i.field === "tag");
    // At least one tag field_ptr for construction + one for switch subject
    expect(tagLoadPtrs.length).toBeGreaterThanOrEqual(2);

    // Should have a switch terminator
    const switches = getTerminators(fn, "switch");
    expect(switches.length).toBe(1);

    // The switch should have 2 cases (Circle=0, Point=1)
    const sw = switches[0];
    if (sw.kind === "switch") {
      expect(sw.cases.length).toBe(2);
    }
  });

  test("switch on tagged union with 3 variants emits 3 case labels", () => {
    const fn = lowerFunction(
      `
      enum Shape { Circle(radius: f64), Rect(w: f64, h: f64), Point }
      fn main() -> int {
        let s: Shape = Shape.Point;
        switch s {
          case Circle: return 1;
          case Rect: return 2;
          case Point: return 3;
        }
        return 0;
      }
      `,
      "main"
    );

    const switches = getTerminators(fn, "switch");
    expect(switches.length).toBe(1);
    const sw = switches[0];
    if (sw.kind === "switch") {
      expect(sw.cases.length).toBe(3);
    }
  });

  test("switch on tagged union with default case", () => {
    const fn = lowerFunction(
      `
      enum Shape { Circle(radius: f64), Point }
      fn main() -> int {
        let s: Shape = Shape.Point;
        switch s {
          case Circle: return 1;
          default: return 0;
        }
        return 0;
      }
      `,
      "main"
    );

    const switches = getTerminators(fn, "switch");
    expect(switches.length).toBe(1);
    const sw = switches[0];
    if (sw.kind === "switch") {
      expect(sw.cases.length).toBe(1); // Only Circle, default is separate
    }
  });

  test("simple enum switch still works (no tag load)", () => {
    const fn = lowerFunction(
      `
      enum Color : u8 { Red = 0, Green = 1, Blue = 2 }
      fn main() -> int {
        let c: Color = Color.Red;
        switch c {
          case Red: return 0;
          case Green: return 1;
          case Blue: return 2;
        }
        return 0;
      }
      `,
      "main"
    );

    // Simple enum should NOT have field_ptr to "tag"
    const fieldPtrs = getInstructions(fn, "field_ptr");
    const tagPtrs = fieldPtrs.filter((i) => i.kind === "field_ptr" && i.field === "tag");
    expect(tagPtrs.length).toBe(0);

    const switches = getTerminators(fn, "switch");
    expect(switches.length).toBe(1);
  });
});
