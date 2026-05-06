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
   (* `ref T` is valid only in parameter and local-binding positions (initially).
      Struct fields, return types, and collection element types reject `ref T`.
      Enforced by the checker, not the grammar. *)

nullable_type    = base_type [ "?" ] ;

base_type        = primitive_type | IDENT [generic_args]
                 | "ptr" "<" type ">"
                 | "inline" "<" type "," INTEGER ">"
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

## Keyword list

Active — recognised by the parser today:

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

`string`, `slice`, and `array` are keywords (not user-defined identifiers)
even when they resolve to stdlib or compiler-built types — keeping lexer
rules local and simple.

## Reserved keywords

Recognised by the lexer; rejected as identifiers; not yet usable as syntax:

```
async       await       impl        macro       match
ref         shared      super       trait       where
yield
```

`ref` is reserved for safe references (`ref T` / `ref mut T`); `match` is
reserved for fuller pattern matching beyond what `switch` covers today. Both
are spec'd elsewhere; their planned status lives in
[`SPEC-STATUS.md`](../SPEC-STATUS.md).

## Assertions

```ebnf
assert_stmt    = "assert" "(" expr [ "," string_lit ] ")" ";" ;
require_stmt   = "require" "(" expr [ "," string_lit ] ")" ";" ;
```
