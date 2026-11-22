import ts from "typescript";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ApiContract, Field, Schema, SourceLocation } from "../types.js";
import { normalizeMethod, normalizePath } from "../core/path.js";

interface Wrapper {
  file: string;
  name: string;
  exported: boolean;
  prefix: string;
  pathParameter: string;
  defaultMethod: string;
  methodFromOptions: boolean;
  bodyFromOptions: boolean;
  location: SourceLocation;
  fetchLocation: SourceLocation;
  start: number;
  end: number;
}
interface Source {
  file: string;
  ast: ts.SourceFile;
  constants: Map<string, string>;
  imports: Map<string, { file: string; name: string }>;
}
const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"];
function moduleFile(
  from: string,
  specifier: string,
  available: Set<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), specifier),
  );
  if (base.startsWith("../") || path.posix.isAbsolute(base)) return;
  const candidates = [
    base,
    base.replace(/\.jsx?$/, (x) => (x === ".js" ? ".ts" : ".tsx")),
    ...extensions.map((x) => base + x),
  ];
  return candidates.find((x) => available.has(x));
}
function location(
  file: string,
  ast: ts.SourceFile,
  node: ts.Node,
): SourceLocation {
  const p = ast.getLineAndCharacterOfPosition(node.getStart(ast));
  return { file, line: p.line + 1, column: p.character + 1 };
}
function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const p = object.properties.find(
    (x) =>
      (ts.isPropertyAssignment(x) || ts.isShorthandPropertyAssignment(x)) &&
      x.name.getText(object.getSourceFile()).replace(/["']/g, "") === name,
  );
  return p && ts.isPropertyAssignment(p)
    ? p.initializer
    : p && ts.isShorthandPropertyAssignment(p)
      ? p.name
      : undefined;
}
function staticValue(
  node: ts.Node | undefined,
  constants: Map<string, string>,
): string | undefined {
  if (!node) return;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) return constants.get(node.text);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const a = staticValue(node.left, constants),
      b = staticValue(node.right, constants);
    return a !== undefined && b !== undefined ? a + b : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const part of node.templateSpans) {
      const v = staticValue(part.expression, constants);
      if (v === undefined) return;
      out += v + part.literal.text;
    }
    return out;
  }
}
function callerPath(
  node: ts.Expression,
  constants: Map<string, string>,
): { path?: string; resolved: boolean } {
  const exact = staticValue(node, constants);
  if (exact !== undefined) return { path: exact, resolved: true };
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const part of node.templateSpans) {
      const known = staticValue(part.expression, constants);
      out +=
        known ??
        `:${ts.isIdentifier(part.expression) ? part.expression.text : "dynamic"}`;
      out += part.literal.text;
    }
    if (out.startsWith("/")) return { path: out, resolved: false };
  }
  return { resolved: false };
}
function fields(node: ts.Expression | undefined): Schema | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return;
  const result: Record<string, Field> = {};
  for (const p of node.properties) {
    if (ts.isSpreadAssignment(p)) return;
    if (ts.isShorthandPropertyAssignment(p)) {
      result[p.name.text] = {
        type: "unknown",
        optional: false,
        nullable: false,
      };
      continue;
    }
    if (!ts.isPropertyAssignment(p)) return;
    const key =
      ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)
        ? p.name.text
        : undefined;
    if (!key) return;
    const value = p.initializer;
    result[key] = {
      type: ts.isStringLiteralLike(value)
        ? "string"
        : ts.isNumericLiteral(value)
          ? "number"
          : value.kind === ts.SyntaxKind.TrueKeyword ||
              value.kind === ts.SyntaxKind.FalseKeyword
            ? "boolean"
            : "unknown",
      optional: false,
      nullable: false,
    };
  }
  return { fields: result };
}
export async function analyzeWrappersProject(
  root: string,
  files: string[],
): Promise<{ contracts: ApiContract[]; internalFetches: Set<string> }> {
  const available = new Set(files),
    sources: Source[] = [],
    wrappers: Wrapper[] = [];
  for (const file of files) {
    const text = await readFile(path.join(root, file), "utf8"),
      ast = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x")
          ? ts.ScriptKind.TSX
          : file.endsWith(".js")
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS,
      );
    const source: Source = {
      file,
      ast,
      constants: new Map(),
      imports: new Map(),
    };
    sources.push(source);
    for (const stmt of ast.statements) {
      if (
        ts.isImportDeclaration(stmt) &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        stmt.importClause
      ) {
        const target = moduleFile(file, stmt.moduleSpecifier.text, available);
        if (target) {
          const clause = stmt.importClause;
          if (clause.name)
            source.imports.set(clause.name.text, {
              file: target,
              name: "default",
            });
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
            for (const item of clause.namedBindings.elements)
              source.imports.set(item.name.text, {
                file: target,
                name: item.propertyName?.text ?? item.name.text,
              });
        }
      }
      if (ts.isVariableStatement(stmt))
        for (const d of stmt.declarationList.declarations)
          if (ts.isIdentifier(d.name)) {
            const value = staticValue(d.initializer, source.constants);
            if (value !== undefined) source.constants.set(d.name.text, value);
          }
    }
  }
  for (const source of sources) {
    const { ast, file, constants } = source;
    function inspect(
      name: string,
      node: ts.FunctionLikeDeclarationBase,
      exported: boolean,
    ): void {
      const pathParam = node.parameters[0]?.name;
      if (!pathParam || !ts.isIdentifier(pathParam) || !node.body) return;
      let defaultMethod = "GET",
        methodBinding = false,
        bodyBinding = false;
      const options = node.parameters[1];
      if (options && ts.isObjectBindingPattern(options.name))
        for (const e of options.name.elements) {
          if (e.name.getText(ast) === "method") {
            methodBinding = true;
            if (e.initializer)
              defaultMethod = staticValue(e.initializer, constants) ?? "GET";
          }
          if (e.name.getText(ast) === "body") bodyBinding = true;
        }
      const fetches: ts.CallExpression[] = [];
      function walk(n: ts.Node): void {
        if (ts.isCallExpression(n) && n.expression.getText(ast) === "fetch")
          fetches.push(n);
        ts.forEachChild(n, walk);
      }
      walk(node.body);
      if (fetches.length !== 1) return;
      const fetch = fetches[0],
        arg = fetch.arguments[0];
      if (!arg) return;
      let prefix: string | undefined;
      if (
        ts.isTemplateExpression(arg) &&
        arg.templateSpans.length === 1 &&
        ts.isIdentifier(arg.templateSpans[0].expression) &&
        arg.templateSpans[0].expression.text === pathParam.text &&
        arg.templateSpans[0].literal.text === ""
      )
        prefix = arg.head.text;
      if (
        ts.isBinaryExpression(arg) &&
        arg.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        ts.isIdentifier(arg.right) &&
        arg.right.text === pathParam.text
      )
        prefix = staticValue(arg.left, constants);
      if (!prefix?.startsWith("/")) return;
      const fetchOptions = fetch.arguments[1];
      if (fetchOptions && !ts.isObjectLiteralExpression(fetchOptions)) return;
      const methodExpr =
        fetchOptions && ts.isObjectLiteralExpression(fetchOptions)
          ? property(fetchOptions, "method")
          : undefined;
      let methodFromOptions = false;
      if (methodExpr) {
        if (
          ts.isIdentifier(methodExpr) &&
          methodExpr.text === "method" &&
          methodBinding
        )
          methodFromOptions = true;
        else {
          const fixed = staticValue(methodExpr, constants);
          if (!fixed) return;
          defaultMethod = fixed;
        }
      }
      const bodyExpr =
        fetchOptions && ts.isObjectLiteralExpression(fetchOptions)
          ? property(fetchOptions, "body")
          : undefined;
      let bodyFromOptions = false;
      if (bodyExpr && bodyBinding) {
        function hasBody(n: ts.Node): boolean {
          if (ts.isIdentifier(n) && n.text === "body") return true;
          return ts.forEachChild(n, hasBody) ?? false;
        }
        bodyFromOptions = hasBody(bodyExpr);
      }
      wrappers.push({
        file,
        name,
        exported,
        prefix,
        pathParameter: pathParam.text,
        defaultMethod,
        methodFromOptions,
        bodyFromOptions,
        location: location(file, ast, node),
        fetchLocation: location(file, ast, fetch),
        start: node.getStart(ast),
        end: node.getEnd(),
      });
    }
    for (const stmt of ast.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name)
        inspect(
          stmt.name.text,
          stmt,
          !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
        );
      if (ts.isVariableStatement(stmt))
        for (const d of stmt.declarationList.declarations)
          if (
            ts.isIdentifier(d.name) &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) ||
              ts.isFunctionExpression(d.initializer))
          )
            inspect(
              d.name.text,
              d.initializer,
              !!stmt.modifiers?.some(
                (m) => m.kind === ts.SyntaxKind.ExportKeyword,
              ),
            );
    }
    for (const stmt of ast.statements)
      if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
        const exportedName = stmt.expression.text;
        const wrapper = wrappers.find(
          (w) => w.file === file && w.name === exportedName,
        );
        if (wrapper) wrapper.exported = true;
      }
  }
  const contracts: ApiContract[] = [],
    internalFetches = new Set(
      wrappers.map(
        (w) =>
          `${w.fetchLocation.file}:${w.fetchLocation.line}:${w.fetchLocation.column}`,
      ),
    );
  for (const source of sources) {
    const { ast, file, constants, imports } = source;
    function visit(n: ts.Node): void {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const local = n.expression.text,
          imported = imports.get(local);
        const wrapper = wrappers.find((w) =>
          imported
            ? w.exported &&
              w.file === imported.file &&
              (w.name === imported.name || imported.name === "default")
            : w.file === file && w.name === local,
        );
        if (
          wrapper &&
          n.arguments[0] &&
          !(
            wrapper.file === file &&
            n.getStart(ast) >= wrapper.start &&
            n.getEnd() <= wrapper.end
          )
        ) {
          const value = callerPath(n.arguments[0], constants),
            opts =
              n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])
                ? n.arguments[1]
                : undefined;
          const methodNode = opts ? property(opts, "method") : undefined;
          const method = normalizeMethod(
            wrapper.methodFromOptions
              ? methodNode
                ? staticValue(methodNode, constants)
                : wrapper.defaultMethod
              : wrapper.defaultMethod,
          );
          const loc = location(file, ast, n);
          const raw = value.path ? wrapper.prefix + value.path : undefined;
          contracts.push({
            id: `frontend:${file}:${loc.line}:${loc.column}:wrapper`,
            source: "frontend",
            framework: "fetch-wrapper",
            method,
            path: raw ? normalizePath(raw) : n.arguments[0].getText(ast),
            resolved: !!raw && value.resolved,
            urlStatus: raw
              ? value.resolved
                ? "static"
                : "partially_resolved"
              : "unresolved",
            request:
              opts && wrapper.bodyFromOptions
                ? fields(property(opts, "body"))
                : undefined,
            requestKnowledge:
              opts && wrapper.bodyFromOptions && fields(property(opts, "body"))
                ? "fully_known"
                : "unknown",
            sourceLocation: loc,
            confidence: value.resolved ? 0.84 : raw ? 0.58 : 0.25,
            evidence: [
              {
                description: "Call to a statically traced fetch wrapper",
                location: loc,
              },
              {
                description: `Wrapper adds prefix ${wrapper.prefix}`,
                location: wrapper.location,
              },
            ],
            context: n.parent.getText(ast).slice(0, 180),
          });
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(ast);
  }
  return { contracts, internalFetches };
}
