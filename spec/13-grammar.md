# Grammar & Keywords

## EBNF Grammar (simplified)

```ebnf
program          = { top_level_decl } ;

top_level_decl   = function_decl | struct_decl
                 | unsafe_struct_decl | enum_decl | type_alias
                 | static_decl | import_decl | extern_fn_decl ;

(* Structures *)
struct_decl      = ["pub"] "struct" IDENT [generic_params] "{" { struct_member } "}" ;
unsafe_struct_decl = ["pub"] "unsafe" "struct" IDENT [generic_params] "{" { struct_member } "}" ;
struct_member    = field_decl | method_decl ;
field_decl       = ["readonly"] IDENT ":" type ";" ;
method_decl      = "fn" IDENT [generic_params] "(" [param_list] ")" ["->" type] ["throws" type_list] block ;

(* Functions *)
function_decl    = ["pub"] "fn" IDENT [generic_params] "(" [param_list] ")" ["->" type] ["throws" type_list] block ;
extern_fn_decl   = "extern" "fn" IDENT "(" [extern_param_list] ")" ["->" type] ";" ;
param_list       = param { "," param } ;
param            = ["readonly"] IDENT ":" type ;
   (* The `mut` parameter form is removed; parameters bind mutably by default,
      `readonly` opts out. The `move` parameter form is also removed; use
      the `move` expression at the call site instead. *)

(* Generics *)
generic_params   = "<" IDENT { "," IDENT } ">" ;
generic_args     = "<" type { "," type } ">" ;

(* Enums *)
enum_decl        = ["pub"] "enum" IDENT [":" integer_type] "{" enum_body "}" ;
enum_body        = variant { "," variant } [","] ;
variant          = IDENT [ "(" field_list ")" ]
                 | IDENT [ "=" INTEGER ] ;

(* Types *)
type             = ref_type | raw_ptr_type | base_type ;

ref_type         = ["readonly"] "ref" base_type ;
   (* `ref T` and `readonly ref T` are valid only in:
      - function/method parameter types,
      - `unsafe struct` field types.
      They are rejected in: return types, safe-struct fields, local
      bindings, generic argument positions, array/collection element
      types, `static` global types. Enforced by the checker.
      `readonly ref T` ≈ C# `in`; `ref T` ≈ C# `ref`. *)

raw_ptr_type     = "*" base_type ;
   (* `*T` is unsafe-only: `unsafe struct` fields, locals inside `unsafe`
      blocks, and `extern fn` signatures. *)

   (* Absence is expressed via the regular generic enum `Optional<T>`
      (see spec/03-types.md). *)

base_type        = primitive_type | IDENT [generic_args]
                 | "inline" "<" type "," INTEGER ">"
                 | "fn" "(" [type_list] ")" [ "->" type ] ;

type_list        = type { "," type } ;

primitive_type   = "i8" | "i16" | "i32" | "i64"
                 | "u8" | "u16" | "u32" | "u64"
                 | "f32" | "f64"
                 | "int" | "uint"
                 | "bool" | "void" ;

(* Note: `string`, `array<T>`, `List<T>`, `Shared<T>` are stdlib types.
   `string` and `array` are lowercase keyword aliases for the canonical
   `String` and `Array<T>`; `List<T>` and `Shared<T>` are written
   PascalCase directly. `inline<T, N>` is a compiler intrinsic. *)

(* Statements *)
statement        = let_stmt | const_stmt | assign_stmt | return_stmt
                 | if_stmt | while_stmt | for_stmt | switch_stmt
                 | defer_stmt | unsafe_block | expr_stmt | block ;

let_stmt         = "let" IDENT [":" type] "=" expr ";" ;
const_stmt       = "const" IDENT [":" type] "=" expr ";" ;
static_decl      = "static" IDENT [":" type] "=" expr ";" ;
   (* `static` names follow SCREAMING_SNAKE_CASE (lint-only — not grammar). *)
return_stmt      = "return" [expr] ";" ;
defer_stmt       = "defer" statement ;
unsafe_block     = "unsafe" block ;

(* Expressions *)
expr             = literal | IDENT | expr bin_op expr | unary_op expr
                 | expr "." IDENT | "*" expr
                 | expr "[" expr "]"
                 | expr "(" [arg_list] ")" | "if" expr block "else" block
                 | struct_literal | "(" expr ")"
                 | "&" expr                    (* raw address-of (unsafe-only): produces *T *)
                 | "move" expr
                 | expr "as" type
                 | expr "catch" catch_block
                 | expr "catch" "panic"
                 | expr "catch" "throw" ;

(* Note: For raw pointers (`*T`) write `(*p).field` to access fields;
   for `ref T` values the `.` operator auto-derefs. `&` is unsafe-only
   and produces `*T`. At call sites taking `ref T` parameters, the
   address is taken implicitly (no `&` needed). *)

(* Note: Kei has no postfix `++` / `--`. Use compound assignment `x += 1` / `x -= 1`. *)
(* Note: Kei has no closures and no nested fn declarations. Functions are
   module-level or struct-member (method) only. See spec/06-functions.md. *)

catch_block      = "{" { catch_arm } ["default" ":" statement] "}" ;
catch_arm        = IDENT [IDENT] ":" statement ;

struct_literal   = IDENT [generic_args] "{" [field_init { "," field_init }] "}" ;

(* Imports *)
import_decl      = "import" import_path ";"
                 | "import" "{" IDENT { "," IDENT } "}" "from" import_path ";" ;

type_alias       = ["pub"] "type" IDENT "=" type ";" ;
block            = "{" { statement } "}" ;
```

## Keyword list

Active — recognised by the parser:

```
as          assert      bool        break       byte
case        catch       const       continue    default
defer       double      else        enum        extern
false       float       fn          for         if
import      in          inline      int         let
long        move        panic       pub         readonly
ref         require     return      self        short
static      string      struct      switch      throw
throws      true        type        uint        unsafe
void        while

i8  i16  i32  i64  u8  u16  u32  u64  f32  f64  isize  usize
```

`string` and `array` are lowercase keyword aliases for the canonical
stdlib types `String` and `Array<T>`. `inline<T, N>` is a compiler
intrinsic for fixed-size value-type arrays.

## Reserved keywords

Recognised by the lexer; rejected as identifiers; not yet usable as syntax:

```
async       await       impl        macro       match
super       trait       where       yield
```

`match` is reserved for fuller pattern matching beyond what `switch`
covers today.

## Removed keywords

These keywords were active in earlier versions and have been removed:

- `mut` — replaced by `readonly` (see §07-structures.md). Bindings are
  mutable by default; `readonly` opts out.
- `ptr` — replaced by `ref T` / `readonly ref T` (safe) and `*T`
  (unsafe). The `ptr<T>` generic-style spelling is gone.
- `slice` — `slice<T>` removed entirely. Use `Array<T>` for refcounted
  views, `ref inline<T, N>` for stack views, or raw `*T` + `usize` at
  C boundaries.
- `shared` — un-reserved. The stdlib type is `Shared<T>` (no lowercase
  alias).

## Assertions

```ebnf
assert_stmt    = "assert" "(" expr [ "," string_lit ] ")" ";" ;
require_stmt   = "require" "(" expr [ "," string_lit ] ")" ";" ;
```
