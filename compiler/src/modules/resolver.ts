/**
 * Module resolver for the Kei compiler.
 *
 * Given a main .kei file, discovers all imports transitively,
 * resolves module paths to file paths, detects circular dependencies,
 * and returns a topologically-sorted list of modules to compile.
 *
 * Resolution order for `import foo`:
 *   1. Source root (project's src/ or main file's directory)
 *   2. deps/ directory (sibling to source root)
 *   3. std/ directory (compiler's standard library)
 */

import { existsSync } from "node:fs";
import { resolve, dirname, join, relative, basename } from "node:path";
import { Lexer } from "../lexer/index.ts";
import { Parser } from "../parser/index.ts";
import { SourceFile } from "../utils/source.ts";
import type { Program, ImportDecl } from "../ast/nodes.ts";

// ─── Module Info ──────────────────────────────────────────────────────────────

/** Metadata for a single resolved module. */
export interface ModuleInfo {
  /** Dotted module name, e.g. "math", "net.http" */
  name: string;
  /** Absolute file path */
  filePath: string;
  /** Parsed AST */
  program: Program;
  /** Source file for diagnostics */
  source: SourceFile;
  /** Modules this module imports (by dotted name) */
  imports: string[];
  /** Import declarations (for selective import info) */
  importDecls: ImportDecl[];
}

/** Result of module resolution — either a set of ordered modules or errors. */
export interface ResolverResult {
  /** Modules in topological order (dependencies first) */
  modules: ModuleInfo[];
  /** Errors encountered during resolution (collected, not thrown) */
  errors: string[];
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolves module imports for a Kei project.
 *
 * Starting from a main file, the resolver transitively discovers all imports,
 * parses each module, detects circular dependencies, and returns modules in
 * topological order (dependencies before dependents).
 *
 * Errors are collected rather than thrown — callers should check
 * `result.errors` after calling `resolve()`.
 */
export class ModuleResolver {
  private sourceRoot: string;
  private stdRoot: string | null;
  private depsRoot: string | null;
  private modules: Map<string, ModuleInfo> = new Map();
  private errors: string[] = [];

  /**
   * @param mainFilePath - Path to the project's main .kei file.
   * @param options.stdRoot - Override path to the standard library directory.
   */
  constructor(mainFilePath: string, options?: { stdRoot?: string }) {
    const mainDir = dirname(resolve(mainFilePath));
    const srcParent = this.findSourceRoot(mainDir);
    this.sourceRoot = srcParent;

    // deps/ directory: sibling to source root
    const depsDir = join(dirname(this.sourceRoot), "deps");
    this.depsRoot = existsSync(depsDir) ? depsDir : null;

    // std/ directory: look relative to the compiler installation
    if (options?.stdRoot) {
      this.stdRoot = options.stdRoot;
    } else {
      this.stdRoot = this.findStdRoot();
    }
  }

  /**
   * Find the source root. If mainDir is inside a `src/` directory, use that.
   * Otherwise, use mainDir itself.
   */
  private findSourceRoot(mainDir: string): string {
    const parts = mainDir.split("/");
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === "src") {
        return parts.slice(0, i + 1).join("/");
      }
    }
    return mainDir;
  }

  /**
   * Find the `std/` directory relative to the compiler installation.
   * Looks for `std/` as a sibling to the compiler's `src/` directory.
   */
  private findStdRoot(): string | null {
    const thisDir = dirname(new URL(import.meta.url).pathname);
    // thisDir = .../compiler/src/modules
    const compilerRoot = resolve(thisDir, "..", "..");
    const stdDir = join(compilerRoot, "std");
    if (existsSync(stdDir)) return stdDir;
    return null;
  }

  /**
   * Resolve all imports starting from the main file.
   *
   * Returns modules in topological order (dependencies first).
   * If any errors are encountered (missing files, parse errors, cycles),
   * they are collected in `result.errors` rather than thrown.
   *
   * @param mainFilePath - Absolute or relative path to the entry point.
   */
  resolve(mainFilePath: string): ResolverResult {
    const absPath = resolve(mainFilePath);
    const mainModuleName = this.filePathToModuleName(absPath);

    this.discoverModule(mainModuleName, absPath);

    // Even if there are discovery errors, attempt topological sort
    // to report as many issues as possible
    const sorted = this.topologicalSort();

    return { modules: sorted, errors: this.errors };
  }

  /**
   * Recursively discover a module and all its imports.
   *
   * Errors during file reading, lexing, or parsing are collected (not thrown)
   * so that the resolver can continue discovering other modules and report
   * multiple errors at once.
   */
  private discoverModule(moduleName: string, filePath: string): void {
    if (this.modules.has(moduleName)) return;

    // Read and parse the file
    const content = this.readFile(filePath);
    if (content === null) {
      const hint = this.suggestSimilarModules(moduleName);
      const msg = `module '${moduleName}' not found: no file at '${filePath}'`;
      this.errors.push(hint ? `${msg}\n  hint: did you mean '${hint}'?` : msg);
      return;
    }

    const source = new SourceFile(filePath, content);
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const lexerDiags = lexer.getDiagnostics();
    const lexErrors = lexerDiags.filter((d) => d.severity === "error");
    if (lexErrors.length > 0) {
      const details = lexErrors
        .slice(0, 3)
        .map((d) => `  ${d.location.line}:${d.location.column}: ${d.message}`)
        .join("\n");
      const extra = lexErrors.length > 3 ? `\n  ... and ${lexErrors.length - 3} more` : "";
      this.errors.push(`module '${moduleName}': lexer errors in '${filePath}':\n${details}${extra}`);
      return;
    }

    const parser = new Parser(tokens);
    const program = parser.parse();

    const parserDiags = parser.getDiagnostics();
    const parseErrors = parserDiags.filter((d) => d.severity === "error");
    if (parseErrors.length > 0) {
      const details = parseErrors
        .slice(0, 3)
        .map((d) => `  ${d.location.line}:${d.location.column}: ${d.message}`)
        .join("\n");
      const extra = parseErrors.length > 3 ? `\n  ... and ${parseErrors.length - 3} more` : "";
      this.errors.push(`module '${moduleName}': parse errors in '${filePath}':\n${details}${extra}`);
      return;
    }

    // Extract import declarations
    const importDecls: ImportDecl[] = [];
    const importNames: string[] = [];
    for (const decl of program.declarations) {
      if (decl.kind === "ImportDecl") {
        importDecls.push(decl);
        importNames.push(decl.path);
      }
    }

    const moduleInfo: ModuleInfo = {
      name: moduleName,
      filePath,
      program,
      source,
      imports: importNames,
      importDecls,
    };

    this.modules.set(moduleName, moduleInfo);

    // Recursively discover imported modules
    for (const importPath of importNames) {
      const resolvedPath = this.resolveImportPath(importPath);
      if (resolvedPath) {
        this.discoverModule(importPath, resolvedPath);
      } else {
        const searched = this.describeSearchPaths(importPath);
        this.errors.push(
          `module '${moduleName}': cannot resolve import '${importPath}'\n  searched:\n${searched}`
        );
      }
    }
  }

  /**
   * Resolve a dotted import path to a file path.
   *
   * Search order:
   *   1. `<sourceRoot>/<path>.kei`
   *   2. `<depsRoot>/<path>.kei` or `<depsRoot>/<name>/mod.kei`
   *   3. `<stdRoot>/<path>.kei`
   *
   * @param importPath - Dotted import path, e.g. "math" or "net.http".
   * @returns Absolute file path if found, `null` otherwise.
   */
  resolveImportPath(importPath: string): string | null {
    const parts = importPath.split(".");
    const relPath = parts.join("/") + ".kei";

    // 1. Source root
    const srcPath = join(this.sourceRoot, relPath);
    if (existsSync(srcPath)) return srcPath;

    // 2. deps/ directory
    if (this.depsRoot) {
      const depsPath = join(this.depsRoot, relPath);
      if (existsSync(depsPath)) return depsPath;

      // Also try deps/<first>/mod.kei for package-level imports
      if (parts.length === 1) {
        const modPath = join(this.depsRoot, parts[0], "mod.kei");
        if (existsSync(modPath)) return modPath;
      }
    }

    // 3. std/ directory
    if (this.stdRoot) {
      const stdPath = join(this.stdRoot, relPath);
      if (existsSync(stdPath)) return stdPath;
    }

    return null;
  }

  /**
   * Convert a file path to a dotted module name relative to source root.
   * e.g. `/project/src/net/http.kei` → `net.http`
   */
  private filePathToModuleName(filePath: string): string {
    const rel = relative(this.sourceRoot, filePath);
    return rel.replace(/\.kei$/, "").replace(/\//g, ".").replace(/\\/g, ".");
  }

  /**
   * Topological sort of modules with cycle detection.
   *
   * Returns modules in dependency order (leaves first, main module last).
   * Circular dependencies are reported as errors rather than throwing.
   */
  private topologicalSort(): ModuleInfo[] {
    const sorted: ModuleInfo[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const visit = (name: string, path: string[]): boolean => {
      if (inStack.has(name)) {
        const cycleStart = path.indexOf(name);
        const cycle = path.slice(cycleStart).concat(name);
        this.errors.push(
          `Circular dependency detected: ${cycle.join(" \u2192 ")}`
        );
        return false;
      }

      if (visited.has(name)) return true;

      inStack.add(name);
      const mod = this.modules.get(name);
      if (!mod) return true; // already reported as missing

      for (const imp of mod.imports) {
        if (!visit(imp, [...path, name])) return false;
      }

      inStack.delete(name);
      visited.add(name);
      sorted.push(mod);
      return true;
    };

    for (const [name] of this.modules) {
      if (!visited.has(name)) {
        visit(name, []);
      }
    }

    return sorted;
  }

  /**
   * Describe the paths that were searched when an import could not be resolved.
   * Used to produce helpful "searched:" output in error messages.
   */
  private describeSearchPaths(importPath: string): string {
    const parts = importPath.split(".");
    const relPath = parts.join("/") + ".kei";
    const paths: string[] = [];

    paths.push(`    ${join(this.sourceRoot, relPath)}`);

    if (this.depsRoot) {
      paths.push(`    ${join(this.depsRoot, relPath)}`);
      if (parts.length === 1) {
        paths.push(`    ${join(this.depsRoot, parts[0], "mod.kei")}`);
      }
    }

    if (this.stdRoot) {
      paths.push(`    ${join(this.stdRoot, relPath)}`);
    }

    return paths.join("\n");
  }

  /**
   * Suggest a similarly-named module that does exist, for "did you mean?" hints.
   * Uses simple prefix matching against already-discovered modules.
   */
  private suggestSimilarModules(moduleName: string): string | null {
    const candidates: string[] = [];
    for (const name of this.modules.keys()) {
      // Simple heuristic: common prefix of at least 2 chars
      const common = this.commonPrefixLength(moduleName, name);
      if (common >= 2 && name !== moduleName) {
        candidates.push(name);
      }
    }
    return candidates.length > 0 ? candidates[0] : null;
  }

  private commonPrefixLength(a: string, b: string): number {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  /** Read a file, returning null if it doesn't exist or can't be read. */
  private readFile(filePath: string): string | null {
    try {
      return require("fs").readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }
}
