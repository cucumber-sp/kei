/**
 * Module resolver for the Kei compiler.
 *
 * Given a main .kei file, discovers all imports transitively,
 * resolves module paths to file paths, detects circular dependencies,
 * and returns a topologically-sorted list of modules to compile.
 */

import { existsSync } from "node:fs";
import { resolve, dirname, join, relative, basename } from "node:path";
import { Lexer } from "../lexer/index.ts";
import { Parser } from "../parser/index.ts";
import { SourceFile } from "../utils/source.ts";
import type { Program, ImportDecl } from "../ast/nodes.ts";

// ─── Module Info ──────────────────────────────────────────────────────────────

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

export interface ResolverResult {
  /** Modules in topological order (dependencies first) */
  modules: ModuleInfo[];
  /** Errors encountered during resolution */
  errors: string[];
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

export class ModuleResolver {
  private sourceRoot: string;
  private stdRoot: string | null;
  private depsRoot: string | null;
  private modules: Map<string, ModuleInfo> = new Map();
  private errors: string[] = [];

  constructor(mainFilePath: string, options?: { stdRoot?: string }) {
    const mainDir = dirname(resolve(mainFilePath));
    // Source root: if src/ dir exists as parent, use the project root; otherwise use the main file's dir
    const srcParent = this.findSourceRoot(mainDir);
    this.sourceRoot = srcParent;

    // deps/ directory: sibling to source root
    const depsDir = join(dirname(this.sourceRoot), "deps");
    this.depsRoot = existsSync(depsDir) ? depsDir : null;

    // std/ directory: look relative to the compiler installation
    if (options?.stdRoot) {
      this.stdRoot = options.stdRoot;
    } else {
      // Walk up from __dirname to find the compiler's std/ directory
      const compilerStd = this.findStdRoot();
      this.stdRoot = compilerStd;
    }
  }

  /**
   * Find the source root. If mainDir is inside a src/ directory, use that.
   * Otherwise, use mainDir itself.
   */
  private findSourceRoot(mainDir: string): string {
    // Check if mainDir ends with /src or has /src/ in the path
    const parts = mainDir.split("/");
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === "src") {
        return parts.slice(0, i + 1).join("/");
      }
    }
    return mainDir;
  }

  /**
   * Find the std/ directory relative to the compiler installation.
   * Looks for std/ as a sibling to the compiler's src/ directory.
   */
  private findStdRoot(): string | null {
    // Try to find std/ relative to this file's location (src/modules/resolver.ts)
    // The std/ dir should be at compiler/std/
    const thisDir = dirname(new URL(import.meta.url).pathname);
    // thisDir = .../compiler/src/modules
    const compilerRoot = resolve(thisDir, "..", "..");
    const stdDir = join(compilerRoot, "std");
    if (existsSync(stdDir)) return stdDir;
    return null;
  }

  /**
   * Resolve all imports starting from the main file.
   * Returns modules in topological order (dependencies first).
   */
  resolve(mainFilePath: string): ResolverResult {
    const absPath = resolve(mainFilePath);
    const mainModuleName = this.filePathToModuleName(absPath);

    // Parse and discover the main module
    this.discoverModule(mainModuleName, absPath);

    if (this.errors.length > 0) {
      return { modules: [], errors: this.errors };
    }

    // Topological sort with cycle detection
    const sorted = this.topologicalSort();

    return { modules: sorted, errors: this.errors };
  }

  /**
   * Recursively discover a module and all its imports.
   */
  private discoverModule(moduleName: string, filePath: string): void {
    if (this.modules.has(moduleName)) return;

    // Read and parse the file
    const content = this.readFile(filePath);
    if (content === null) {
      this.errors.push(`Module '${moduleName}': file not found at '${filePath}'`);
      return;
    }

    const source = new SourceFile(filePath, content);
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const lexerDiags = lexer.getDiagnostics();
    if (lexerDiags.some(d => d.severity === "error")) {
      this.errors.push(`Module '${moduleName}': lexer errors in '${filePath}'`);
      return;
    }

    const parser = new Parser(tokens);
    const program = parser.parse();

    const parserDiags = parser.getDiagnostics();
    if (parserDiags.some(d => d.severity === "error")) {
      this.errors.push(`Module '${moduleName}': parser errors in '${filePath}'`);
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
        this.errors.push(
          `Module '${moduleName}': cannot resolve import '${importPath}'`
        );
      }
    }
  }

  /**
   * Resolve a dotted import path to a file path.
   * Search order: source root → deps/ → std/
   *
   * import math       → src/math.kei
   * import net.http   → src/net/http.kei
   * import io         → std/io.kei (if not in src/)
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
   * Convert a file path to a module name relative to source root.
   */
  private filePathToModuleName(filePath: string): string {
    const rel = relative(this.sourceRoot, filePath);
    // Remove .kei extension and convert / to .
    return rel.replace(/\.kei$/, "").replace(/\//g, ".").replace(/\\/g, ".");
  }

  /**
   * Topological sort of modules with cycle detection.
   * Returns modules in dependency order (leaves first).
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
          `Circular dependency detected: ${cycle.join(" → ")}`
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

  private readFile(filePath: string): string | null {
    try {
      // Use Bun.file if available, fall back to fs
      return require("fs").readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }
}
