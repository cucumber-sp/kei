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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ImportDecl, Program } from "../ast/nodes";
import { createDiagnostics, type Diagnostic as ModuleDiagnostic } from "../diagnostics";
import type { Span as DiagSpan } from "../diagnostics/types";
import type { Diagnostic } from "../errors/diagnostic";
import { Lexer } from "../lexer";
import { Parser } from "../parser";
import { SourceFile } from "../utils/source";

/** Maximum number of per-stage diagnostics rendered in a resolver error. */
const MAX_RENDERED_DIAGS = 3;

/**
 * Format up to {@link MAX_RENDERED_DIAGS} error diagnostics for inclusion in a
 * resolver error string. Returns null if there are no errors.
 */
function formatStageErrors(
  diags: readonly Diagnostic[],
  moduleName: string,
  filePath: string,
  stage: "lexer" | "parse"
): string | null {
  const errors = diags.filter((d) => d.severity === "error");
  if (errors.length === 0) return null;

  const details = errors
    .slice(0, MAX_RENDERED_DIAGS)
    .map((d) => `  ${d.location.line}:${d.location.column}: ${d.message}`)
    .join("\n");
  const extra =
    errors.length > MAX_RENDERED_DIAGS
      ? `\n  ... and ${errors.length - MAX_RENDERED_DIAGS} more`
      : "";
  return `module '${moduleName}': ${stage} errors in '${filePath}':\n${details}${extra}`;
}

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
  /**
   * Structured diagnostics emitted during resolution. Module-level
   * resolver-pass errors carry specific `E7xxx` variants
   * (`cyclicImport`, `moduleNotFound`, …). Lexer/parse stage errors
   * encountered while reading dependent modules surface as
   * `untriaged` for now; PRs 4a–4f own those categories.
   *
   * Kept alongside `errors: string[]` so legacy console-error printing
   * continues to work unchanged while typed consumers can opt in.
   */
  diagnostics: readonly ModuleDiagnostic[];
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
   * Typed diagnostics accumulator. Populated in parallel with `errors`
   * so the surfacing step stamps the right `E7xxx` kind without
   * disturbing the legacy `string[]` API consumers rely on.
   */
  private diag = createDiagnostics({});

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
   *
   * In source mode (`bun run src/cli.ts`), `import.meta.url` points at this
   * file and `std/` sits two directories up. In a `bun build --compile`
   * standalone binary, `import.meta.url` resolves into a virtual `$bunfs/`
   * root, so we fall back to `process.execPath` and look for `std/` shipped
   * alongside the executable.
   */
  private findStdRoot(): string | null {
    try {
      const thisDir = dirname(new URL(import.meta.url).pathname);
      const sourceStd = resolve(thisDir, "..", "..", "std");
      if (existsSync(sourceStd)) return sourceStd;
    } catch {
      // import.meta.url unavailable or not a file URL — fall through.
    }

    const execStd = join(dirname(process.execPath), "std");
    if (existsSync(execStd)) return execStd;

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

    this.discoverModule(mainModuleName, absPath, null);

    // Even if there are discovery errors, attempt topological sort
    // to report as many issues as possible
    const sorted = this.topologicalSort();

    return { modules: sorted, errors: this.errors, diagnostics: this.diag.diagnostics() };
  }

  /**
   * Recursively discover a module and all its imports.
   *
   * Errors during file reading, lexing, or parsing are collected (not thrown)
   * so that the resolver can continue discovering other modules and report
   * multiple errors at once. `importedFrom` carries the importer's source +
   * import-decl byte span so `moduleNotFound` diagnostics can point at the
   * `import` statement that triggered the lookup. The entry-point module
   * has no importer; in that case `importedFrom` is `null` and the
   * diagnostic falls back to a synthetic span at the start of the file.
   */
  private discoverModule(
    moduleName: string,
    filePath: string,
    importedFrom: { source: SourceFile; importSpan: { start: number; end: number } } | null
  ): void {
    if (this.modules.has(moduleName)) return;

    // Read and parse the file
    const content = this.readFile(filePath);
    if (content === null) {
      const hint = this.suggestSimilarModules(moduleName);
      const msg = `module '${moduleName}' not found: no file at '${filePath}'`;
      this.errors.push(hint ? `${msg}\n  hint: did you mean '${hint}'?` : msg);
      this.diag.moduleNotFound({
        span: this.spanForImport(importedFrom, filePath),
        importPath: moduleName,
        notes: hint ? [`did you mean '${hint}'?`] : undefined,
      });
      return;
    }

    const source = new SourceFile(filePath, content);
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const lexerError = formatStageErrors(lexer.getDiagnostics(), moduleName, filePath, "lexer");
    if (lexerError !== null) {
      this.errors.push(lexerError);
      return;
    }

    const parser = new Parser(tokens);
    const program = parser.parse();

    const parseError = formatStageErrors(parser.getDiagnostics(), moduleName, filePath, "parse");
    if (parseError !== null) {
      this.errors.push(parseError);
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
    for (const decl of importDecls) {
      const importPath = decl.path;
      const resolvedPath = this.resolveImportPath(importPath);
      if (resolvedPath) {
        this.discoverModule(importPath, resolvedPath, { source, importSpan: decl.span });
      } else {
        const searchedPaths = this.describeSearchPathList(importPath);
        const searched = searchedPaths.map((p) => `    ${p}`).join("\n");
        this.errors.push(
          `module '${moduleName}': cannot resolve import '${importPath}'\n  searched:\n${searched}`
        );
        this.diag.moduleNotFound({
          span: this.locationFromSource(source, decl.span.start),
          importPath,
          importerModule: moduleName,
          searched: searchedPaths,
        });
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
    const relPath = `${parts.join("/")}.kei`;

    // 1. Source root
    const srcPath = join(this.sourceRoot, relPath);
    if (existsSync(srcPath)) return srcPath;

    // 2. deps/ directory
    if (this.depsRoot) {
      const depsPath = join(this.depsRoot, relPath);
      if (existsSync(depsPath)) return depsPath;

      // Also try deps/<first>/mod.kei for package-level imports
      if (parts.length === 1) {
        const packageName = parts[0];
        if (!packageName) return null;
        const modPath = join(this.depsRoot, packageName, "mod.kei");
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
    return rel
      .replace(/\.kei$/, "")
      .replace(/\//g, ".")
      .replace(/\\/g, ".");
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
        this.errors.push(`Circular dependency detected: ${cycle.join(" \u2192 ")}`);
        this.diag.cyclicImport({
          span: this.spanForCycle(cycle),
          path: cycle,
        });
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
   * Returns the list of attempted absolute paths so both the legacy
   * string-error formatting and the typed-diagnostic envelope can share
   * one source of truth.
   */
  private describeSearchPathList(importPath: string): string[] {
    const parts = importPath.split(".");
    const relPath = `${parts.join("/")}.kei`;
    const paths: string[] = [];

    paths.push(join(this.sourceRoot, relPath));

    if (this.depsRoot) {
      paths.push(join(this.depsRoot, relPath));
      if (parts.length === 1) {
        const packageName = parts[0];
        if (packageName) {
          paths.push(join(this.depsRoot, packageName, "mod.kei"));
        }
      }
    }

    if (this.stdRoot) {
      paths.push(join(this.stdRoot, relPath));
    }

    return paths;
  }

  /**
   * Build a `Span` (SourceLocation) for the importer's `import` statement
   * when known, or fall back to a synthetic location at the start of
   * the missing file. The latter is the only sane fallback for the
   * entry-point module: there is no importer, so we have nothing to
   * point at.
   */
  private spanForImport(
    importedFrom: { source: SourceFile; importSpan: { start: number; end: number } } | null,
    fallbackFile: string
  ): DiagSpan {
    if (importedFrom) {
      return this.locationFromSource(importedFrom.source, importedFrom.importSpan.start);
    }
    return { file: fallbackFile, line: 1, column: 1, offset: 0 };
  }

  /**
   * Best-effort span for a cyclic-import diagnostic. The cycle has no
   * single natural anchor; we point at the first `import` statement in
   * the first module of the cycle that references the next module in
   * the chain. If the lookup fails (shouldn't, but defensive), we fall
   * back to the start of the first module's source.
   */
  private spanForCycle(cycle: string[]): DiagSpan {
    const first = cycle[0];
    const next = cycle[1];
    if (first && next) {
      const mod = this.modules.get(first);
      if (mod) {
        const decl = mod.importDecls.find((d) => d.path === next);
        if (decl) return this.locationFromSource(mod.source, decl.span.start);
        return this.locationFromSource(mod.source, 0);
      }
    }
    return { file: first ?? "<unknown>", line: 1, column: 1, offset: 0 };
  }

  /** Convert a byte-offset into a `SourceLocation` rooted at `source`. */
  private locationFromSource(source: SourceFile, offset: number): DiagSpan {
    const lc = source.lineCol(offset);
    return { file: source.filename, line: lc.line, column: lc.column, offset };
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
    return candidates[0] ?? null;
  }

  private commonPrefixLength(a: string, b: string): number {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  /** Read a file, returning null if it doesn't exist or can't be read. */
  private readFile(filePath: string): string | null {
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }
}
