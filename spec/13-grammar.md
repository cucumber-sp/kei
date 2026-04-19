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
field_decl       = IDENT ":" type ";" ;
method_decl      = "fn" IDENT [generic_params] "(" [param_list] ")" ["->" type] ["throws" type_list] block ;

(* Functions *)
function_decl    = ["pub"] "fn" IDENT [generic_params] "(" [param_list] ")" ["->" type] ["throws" type_list] block ;
extern_fn_decl   = "extern" "fn" IDENT "(" [extern_param_list] ")" ["->" type] ";" ;
param_list       = param { "," param } ;
param            = ["mut" | "move"] IDENT ":" type ;

(* Generics *)
generic_params   = "<" IDENT { "," IDENT } ">" ;
generic_args     = "<" type { "," type } ">" ;

(* Enums *)
enum_decl        = ["pub"] "enum" IDENT [":" integer_type] "{" enum_body "}" ;
enum_body        = variant { "," variant } [","] ;
variant          = IDENT [ "(" field_list ")" ]
                 | IDENT [ "=" INTEGER ] ;

(* Types *)
type             = ref_type | nullable_type ;

ref_type         = "ref" [ "mut" ] base_type ;
   (* v1: ref types are valid only in parameter and local-binding positions.
      Struct fields, return types, and collection element types reject `ref T`.
      Enforced by the checker, not the grammar. *)

nullable_type    = base_type [ "?" ] ;

base_type        = primitive_type | IDENT [generic_args]
                 | "ptr" "<" type ">"
                 | "array" "<" type "," INTEGER ">"
                 | "slice" "<" type ">"
                 | "fn" "(" [type_list] ")" [ "->" type ] ;

type_list        = type { "," type } ;

primitive_type   = "i8" | "i16" | "i32" | "i64"
                 | "u8" | "u16" | "u32" | "u64"
                 | "f32" | "f64"
                 | "int" | "uint"
                 | "bool" | "void" ;

(* Note: `string`, `array<T>` (heap), `List<T>`, `Shared<T>` are stdlib types,
   not built-in base_types. Users write them as user-defined IDENT references. *)

(* Statements *)
statement        = let_stmt | const_stmt | assign_stmt | return_stmt
                 | if_stmt | while_stmt | for_stmt | switch_stmt
                 | defer_stmt | unsafe_block | expr_stmt | block ;

let_stmt         = "let" IDENT [":" type] "=" expr ";" ;
const_stmt       = "const" IDENT [":" type] "=" expr ";" ;
static_decl      = "static" IDENT [":" type] "=" expr ";" ;
return_stmt      = "return" [expr] ";" ;
defer_stmt       = "defer" statement ;
unsafe_block     = "unsafe" block ;

(* Expressions *)
expr             = literal | IDENT | expr bin_op expr | unary_op expr
                 | expr "." IDENT | "*" expr | expr "->" IDENT
                 | expr "[" expr "]"
                 | expr "(" [arg_list] ")" | "if" expr block "else" block
                 | struct_literal | "(" expr ")"
                 | "&" expr                    (* address-of: ref T in safe, ptr<T> in unsafe *)
                 | "&" "mut" expr              (* mutable address-of: ref mut T *)
                 | "move" expr
                 | expr "as" type
                 | expr "catch" catch_block
                 | expr "catch" "panic"
                 | expr "catch" "throw" ;

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

## Keyword List

```
as          assert      bool        break       case
catch       const       continue    default     defer
else        enum        extern      false       fn
for         if          import      in          int
let         match       move        mut         null
panic       ptr         pub         ref         require
return      self        slice       static      string
struct      switch      throw       throws      true
type        uint        unsafe      void        while
```

`string` and `slice` are reserved words even though they resolve to stdlib or
compiler types — to keep the lexer rules local and simple.

## Reserved for Future

```
async       await       impl        macro       shared
super       trait       where       yield
```

Items removed from this list since earlier drafts (now spec'd above): `closure`,
`generic`, `interface`, `override`, `private`, `protected`, `ref`, `virtual`, `match`.

## Changes from v0.0.1 Draft

> **Note:** The grammar above reflects current design decisions:
> - `ref struct` removed — two-tier model with `struct` and `unsafe struct`.
> - `str` type removed — single `string` stdlib type with CoW semantics.
> - Lifecycle hooks `__destroy`/`__oncopy` auto-generated for `struct` types.
> - Generics via `<T>` syntax with compile-time monomorphization.
> - `throws`/`catch`/`throw` for error handling.
> - `move` keyword for explicit ownership transfer.
> - `enum` supports both data variants and simple numeric enums.
> - **`T?` added** as suffix nullability with niche optimization.
> - **`as` added** as explicit cast operator.
> - **`ref T` / `ref mut T` added** as safe, scope-bound references (replaces the
>   earlier `self: ptr<T>` pattern in method receivers).
> - **No closures, no nested functions** — functions are module- or struct-level only.
> - **`dynarray` removed** — use `List<T>` (stdlib, growable) or `array<T>` (stdlib, CoW fixed).
> - **Postfix `++`/`--` removed** — use `x += 1` / `x -= 1`.
> - **Function-pointer type syntax** `fn(…) -> …` is a first-class type; plain C
>   function pointers, 8 bytes, no environment.

## Assertions

```ebnf
assert_stmt    = "assert" "(" expr [ "," string_lit ] ")" ";" ;
require_stmt   = "require" "(" expr [ "," string_lit ] ")" ";" ;
```
