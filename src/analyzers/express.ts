import ts from "typescript";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AnalyzerDiagnostic,
  ApiContract,
  HttpMethod,
  SourceLocation,
} from "../types.js";
import { normalizeMethod, normalizePath } from "../core/path.js";

interface Route {
  owner: string;
  path: string;
  method: HttpMethod;
  location: SourceLocation;
}
interface Mount {
  owner: string;
  target: string;
  prefix: string;
  location: SourceLocation;
}
interface ModuleInfo {
  rel: string;
  roots: Set<string>;
  routers: Set<string>;
  exports: Map<string, string>;
  imports: Map<string, { module: string; name: string }>;
  routes: Route[];
  mounts: Mount[];
  diagnostics: AnalyzerDiagnostic[];
}
const ext = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"];
function key(file: string, name: string): string {
  return `${file}#${name}`;
}
function resolveModule(
  from: string,
  spec: string,
  available: Set<string>,
): string | undefined {
  if (!spec.startsWith(".")) return;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), spec),
  );
  const alternate = base.replace(/\.jsx?$/, (m) =>
    m === ".js" ? ".ts" : ".tsx",
  );
  if (base.startsWith("../") || path.posix.isAbsolute(base)) return;
  return [base, alternate, ...ext.map((x) => base + x)].find((x) =>
    available.has(x),
  );
}
export async function analyzeExpressProject(
  root: string,
  files: string[],
): Promise<{ contracts: ApiContract[]; diagnostics: AnalyzerDiagnostic[] }> {
  const available = new Set(files);
  const modules: ModuleInfo[] = [];
  for (const rel of files) {
    const source = await readFile(path.join(root, rel), "utf8");
    const sf = ts.createSourceFile(
      rel,
      source,
      ts.ScriptTarget.Latest,
      true,
      rel.endsWith("x")
        ? ts.ScriptKind.TSX
        : rel.endsWith(".js")
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS,
    );
    const info: ModuleInfo = {
      rel,
      roots: new Set(),
      routers: new Set(),
      exports: new Map(),
      imports: new Map(),
      routes: [],
      mounts: [],
      diagnostics: [],
    };
    const parseErrors =
      (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
        .parseDiagnostics ?? [];
    if (parseErrors.length) {
      for (const d of parseErrors) {
        const p = sf.getLineAndCharacterOfPosition(d.start ?? 0);
        info.diagnostics.push({
          code: "TYPESCRIPT_SYNTAX_ERROR",
          message: ts.flattenDiagnosticMessageText(d.messageText, " "),
          location: { file: rel, line: p.line + 1, column: p.character + 1 },
          blocking: true,
        });
      }
      modules.push(info);
      continue;
    }
    const expressNames = new Set<string>();
    const routerFactories = new Set<string>();
    function loc(n: ts.Node): SourceLocation {
      const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      return { file: rel, line: p.line + 1, column: p.character + 1 };
    }
    function string(n: ts.Node | undefined): string | undefined {
      return n && ts.isStringLiteralLike(n) ? n.text : undefined;
    }
    for (const stmt of sf.statements) {
      if (
        ts.isImportDeclaration(stmt) &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const mod = stmt.moduleSpecifier.text,
          clause = stmt.importClause;
        if (mod === "express") {
          if (clause?.name) expressNames.add(clause.name.text);
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
            for (const item of clause.namedBindings.elements)
              if ((item.propertyName?.text ?? item.name.text) === "Router")
                routerFactories.add(item.name.text);
        } else if (mod.startsWith(".") && clause) {
          if (clause.name)
            info.imports.set(clause.name.text, {
              module: mod,
              name: "default",
            });
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
            for (const item of clause.namedBindings.elements)
              info.imports.set(item.name.text, {
                module: mod,
                name: item.propertyName?.text ?? item.name.text,
              });
        }
      }
      if (ts.isVariableStatement(stmt))
        for (const decl of stmt.declarationList.declarations)
          if (ts.isIdentifier(decl.name) && decl.initializer) {
            const name = decl.name.text,
              init = decl.initializer;
            if (ts.isCallExpression(init)) {
              const called = init.expression.getText(sf);
              if (expressNames.has(called)) info.roots.add(name);
              if (
                routerFactories.has(called) ||
                [...expressNames].some((x) => called === x + ".Router")
              )
                info.routers.add(name);
            }
            if (
              stmt.modifiers?.some(
                (m) => m.kind === ts.SyntaxKind.ExportKeyword,
              )
            )
              info.exports.set(name, name);
          }
      if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression))
        info.exports.set("default", stmt.expression.text);
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.exportClause &&
        ts.isNamedExports(stmt.exportClause)
      )
        for (const e of stmt.exportClause.elements)
          info.exports.set(e.name.text, e.propertyName?.text ?? e.name.text);
    }
    function walk(n: ts.Node): void {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression)
      ) {
        const owner = n.expression.expression.getText(sf),
          method = n.expression.name.text;
        if (
          (info.roots.has(owner) || info.routers.has(owner)) &&
          method === "use"
        ) {
          const prefix = string(n.arguments[0]);
          const target = n.arguments[1];
          if (prefix !== undefined && target && ts.isIdentifier(target))
            info.mounts.push({
              owner,
              target: target.text,
              prefix,
              location: loc(n),
            });
          else if (
            prefix !== undefined ||
            (target === undefined &&
              n.arguments[0] &&
              ts.isIdentifier(n.arguments[0]) &&
              info.routers.has(n.arguments[0].text))
          )
            info.diagnostics.push({
              code: "EXPRESS_DYNAMIC_MOUNT",
              message: "Router mount path or target cannot be resolved",
              location: loc(n),
              blocking: true,
            });
        }
        const verb = normalizeMethod(method);
        if ((info.roots.has(owner) || info.routers.has(owner)) && verb) {
          const first = n.arguments[0];
          const paths =
            first && ts.isArrayLiteralExpression(first)
              ? first.elements.map(string)
              : [string(first)];
          if (paths.some((x) => x === undefined))
            info.diagnostics.push({
              code: "EXPRESS_DYNAMIC_ROUTE",
              message: "Express route path is not a static string",
              location: loc(n),
              blocking: true,
            });
          else
            for (const route of paths)
              info.routes.push({
                owner,
                method: verb,
                path: route!,
                location: loc(n),
              });
        }
      }
      ts.forEachChild(n, walk);
    }
    walk(sf);
    modules.push(info);
  }
  const byFile = new Map(modules.map((m) => [m.rel, m]));
  const roots: string[] = [],
    allMounts = new Map<
      string,
      Array<{ target: string; prefix: string; location: SourceLocation }>
    >();
  const allRoutes = new Map<string, Route[]>();
  const diagnostics: AnalyzerDiagnostic[] = [];
  for (const m of modules) {
    diagnostics.push(...m.diagnostics);
    for (const name of m.roots) roots.push(key(m.rel, name));
    for (const route of m.routes) {
      const k = key(m.rel, route.owner);
      allRoutes.set(k, [...(allRoutes.get(k) ?? []), route]);
    }
    for (const mount of m.mounts) {
      let target = key(m.rel, mount.target);
      const imported = m.imports.get(mount.target);
      if (imported) {
        const resolved = resolveModule(m.rel, imported.module, available);
        const targetModule = resolved ? byFile.get(resolved) : undefined;
        const exported = targetModule?.exports.get(imported.name);
        if (!resolved || !exported) {
          diagnostics.push({
            code: "EXPRESS_UNRESOLVED_MOUNT",
            message: `Cannot resolve imported router ${mount.target}`,
            location: mount.location,
            blocking: true,
          });
          continue;
        }
        target = key(resolved, exported);
      }
      if (
        !m.routers.has(mount.target) &&
        !m.roots.has(mount.target) &&
        !imported
      ) {
        diagnostics.push({
          code: "EXPRESS_UNRESOLVED_MOUNT",
          message: `Cannot resolve router ${mount.target}`,
          location: mount.location,
          blocking: true,
        });
        continue;
      }
      const k = key(m.rel, mount.owner);
      allMounts.set(k, [
        ...(allMounts.get(k) ?? []),
        { target, prefix: mount.prefix, location: mount.location },
      ]);
    }
  }
  const contracts: ApiContract[] = [];
  const visitedRoutes = new Set<string>();
  function walk(
    owner: string,
    prefix: string,
    stack: Set<string>,
    evidence: SourceLocation[],
  ): void {
    if (stack.has(owner)) {
      diagnostics.push({
        code: "EXPRESS_MOUNT_CYCLE",
        message: "Router mount cycle detected",
        location: evidence.at(-1) ?? {
          file: owner.split("#")[0],
          line: 1,
          column: 1,
        },
        blocking: true,
      });
      return;
    }
    const next = new Set(stack);
    next.add(owner);
    for (const route of allRoutes.get(owner) ?? []) {
      const full = normalizePath(prefix + "/" + route.path),
        id = `backend:${route.location.file}:${route.location.line}:${route.method}:${full}`;
      if (visitedRoutes.has(id)) continue;
      visitedRoutes.add(id);
      contracts.push({
        id,
        source: "backend",
        framework: "Express",
        method: route.method,
        path: full,
        resolved: true,
        sourceLocation: route.location,
        confidence: 0.93,
        evidence: [
          {
            description: "Express route declaration",
            location: route.location,
          },
          ...evidence.map((location) => ({
            description: "Static router mount",
            location,
          })),
        ],
      });
    }
    for (const mount of allMounts.get(owner) ?? [])
      walk(mount.target, normalizePath(prefix + "/" + mount.prefix), next, [
        ...evidence,
        mount.location,
      ]);
  }
  for (const rootKey of roots) walk(rootKey, "", new Set(), []);
  for (const [owner, routes] of allRoutes)
    if (
      !routes.some((r) =>
        contracts.some(
          (c) =>
            c.sourceLocation.file === r.location.file &&
            c.sourceLocation.line === r.location.line,
        ),
      )
    )
      diagnostics.push({
        code: "EXPRESS_UNMOUNTED_ROUTER",
        message: `Router ${owner.split("#")[1]} has no resolvable application mount`,
        location: routes[0].location,
        blocking: true,
      });
  return { contracts, diagnostics };
}
