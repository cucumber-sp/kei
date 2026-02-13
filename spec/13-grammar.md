# Grammar & Keywords

## EBNF Grammar (simplified)

```ebnf
program          = { top_level_decl } ;

top_level_decl   = function_decl | struct_decl | ref_struct_decl 
                 | unsafe_struct_decl | enum_decl | type_alias 
                 | static_decl | import_decl | extern_fn_decl ;

(* Structures *)
struct_decl      = ["pub"] "struct" IDENT "{" { struct_member } "}" ;
ref_struct_decl  = ["pub"] "ref" "struct" IDENT "{" { struct_member } "}" ;
unsafe_struct_decl = ["pub"] "unsafe" "struct" IDENT "{" { struct_member } "}" ;
struct_member    = field_decl | method_decl ;
field_decl       = IDENT ":" type ";" ;
method_decl      = "fn" IDENT "(" [param_list] ")" ["->" type] ["throws" type_list] block ;

(* Functions *)
function_decl    = ["pub"] "fn" IDENT "(" [param_list] ")" ["->" type] ["throws" type_list] block ;
extern_fn_decl   = "extern" "fn" IDENT "(" [extern_param_list] ")" ["->" type] ";" ;
param_list       = param { "," param } ;
param            = ["mut" | "move"] IDENT ":" type ;

(* Enums *)
enum_decl        = ["pub"] "enum" IDENT [":" integer_type] "{" enum_body "}" ;
enum_body        = variant { "," variant } [","] ;
variant          = IDENT [ "(" field_list ")" ]
                 | IDENT [ "=" INTEGER ] ;

(* Types *)
type             = primitive_type | IDENT 
                 | "ptr" "<" type ">" 
                 | "array" "<" type "," INTEGER ">"
                 | "dynarray" "<" type ">"
                 | "slice" "<" type ">" ;

type_list        = type { "," type } ;

primitive_type   = "i8" | "i16" | "i32" | "i64"
                 | "u8" | "u16" | "u32" | "u64"
                 | "f32" | "f64"
                 | "int" | "uint"
                 | "bool" | "str" | "String" | "void" ;

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
                 | expr "." IDENT | expr ".*" | expr "[" expr "]"
                 | expr "(" [arg_list] ")" | "if" expr block "else" block
                 | struct_literal | "(" expr ")" | "&" expr
                 | "move" expr
                 | expr "catch" catch_block
                 | expr "catch" "panic"
                 | expr "catch" "throw" ;

catch_block      = "{" { catch_arm } ["default" ":" statement] "}" ;
catch_arm        = IDENT [IDENT] ":" statement ;

struct_literal   = IDENT "{" [field_init { "," field_init }] "}" ;

(* Imports *)
import_decl      = "import" import_path ";"
                 | "import" "{" IDENT { "," IDENT } "}" "from" import_path ";" ;

type_alias       = ["pub"] "type" IDENT "=" type ";" ;
block            = "{" { statement } "}" ;
```

## Keyword List

```
bool        break       case        catch       const
continue    default     defer       dynarray    else
enum        extern      false       fn          for
if          import      in          int         let
move        mut         panic       ptr         pub
ref         return      self        slice       static
str         String      struct      switch      throw
throws      true        type        uint        unsafe
void        while
```

## Reserved for Future

```
async       await       closure     generic     impl
interface   macro       match       override    private
protected   shared      super       trait       virtual
where       yield
```

## Changes from v0.0.1 Draft

> **Note:** The grammar above reflects the current design decisions:
> - `throws`/`catch`/`throw` replaces the `|` union return type syntax for error handling
> - `move` keyword added for explicit ownership transfer
> - `enum` supports both data variants (like Rust) and simple numeric enums
> - `borrow` keyword removed from parameters (refcount handles sharing)
> - `union` keyword replaced by `enum` with data variants
