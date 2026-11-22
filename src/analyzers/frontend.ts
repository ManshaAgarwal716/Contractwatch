import ts from "typescript";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AnalyzerDiagnostic,
  ApiContract,
  Field,
  Schema,
  SourceLocation,
} from "../types.js";
import { field } from "../core/schema.js";
import { normalizeMethod, normalizePath } from "../core/path.js";
export async function analyzeFrontend(
  root: string,
  rel: string,
): Promise<{ contracts: ApiContract[]; diagnostics: AnalyzerDiagnostic[] }> {
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
  const parseErrors =
    (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  if (parseErrors.length)
    return {
      contracts: [],
      diagnostics: parseErrors.map((d) => {
        const p = sf.getLineAndCharacterOfPosition(d.start ?? 0);
        return {
          code: "TYPESCRIPT_SYNTAX_ERROR",
          message: ts.flattenDiagnosticMessageText(d.messageText, " "),
          location: { file: rel, line: p.line + 1, column: p.character + 1 },
          blocking: true,
        };
      }),
    };
  const constants = new Map<string, string>(),
    variableTypes = new Map<string, Schema>(),
    types = new Map<string, Schema>(),
    axiosNames = new Set<string>(),
    axiosBases = new Map<string, string>(),
    fetchNames = new Set(["fetch"]),
    shadowedFetch = new Set<string>();
  function loc(n: ts.Node): SourceLocation {
    const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    return { file: rel, line: p.line + 1, column: p.character + 1 };
  }
  function value(n: ts.Node | undefined): string | undefined {
    if (!n) return undefined;
    if (ts.isStringLiteralLike(n) || ts.isNoSubstitutionTemplateLiteral(n))
      return n.text;
    if (ts.isIdentifier(n)) return constants.get(n.text);
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const a = value(n.left),
        b = value(n.right);
      return a !== undefined && b !== undefined ? a + b : undefined;
    }
    if (ts.isTemplateExpression(n)) {
      let s = n.head.text;
      for (const span of n.templateSpans) {
        const v = value(span.expression);
        if (v === undefined) return undefined;
        s += v + span.literal.text;
      }
      return s;
    }
    return undefined;
  }
  function parseType(n: ts.TypeNode | undefined): Field {
    if (!n) return field("unknown");
    if (ts.isUnionTypeNode(n)) {
      const nullable = n.types.some(
        (t) =>
          t.kind === ts.SyntaxKind.NullKeyword ||
          t.kind === ts.SyntaxKind.UndefinedKeyword ||
          t.getText(sf) === "null",
      );
      const other = n.types.filter(
        (t) => t.getText(sf) !== "null" && t.getText(sf) !== "undefined",
      );
      return other.length === 1
        ? { ...parseType(other[0]), nullable }
        : {
            type: "union",
            optional: false,
            nullable,
            variants: other.map(parseType),
          };
    }
    if (ts.isArrayTypeNode(n))
      return {
        type: "array",
        optional: false,
        nullable: false,
        element: parseType(n.elementType),
      };
    if (ts.isTypeLiteralNode(n))
      return {
        type: "object",
        optional: false,
        nullable: false,
        fields: members(n.members).fields,
      };
    if (ts.isTypeReferenceNode(n)) {
      const name = n.typeName.getText(sf);
      if ((name === "Array" || name === "Promise") && n.typeArguments?.length)
        return name === "Array"
          ? {
              type: "array",
              optional: false,
              nullable: false,
              element: parseType(n.typeArguments[0]),
            }
          : parseType(n.typeArguments[0]);
      return field(name);
    }
    return field(n.getText(sf));
  }
  function members(ms: ts.NodeArray<ts.TypeElement>): Schema {
    const fields: Record<string, Field> = {};
    for (const m of ms)
      if (ts.isPropertySignature(m) && m.type)
        fields[m.name.getText(sf).replace(/['"]/g, "")] = {
          ...parseType(m.type),
          optional: !!m.questionToken,
        };
    return { fields };
  }
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const mod = stmt.moduleSpecifier.text,
        clause = stmt.importClause;
      if (mod === "axios") {
        if (clause?.name) axiosNames.add(clause.name.text);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const item of clause.namedBindings.elements)
            if (item.propertyName?.text === "default")
              axiosNames.add(item.name.text);
      }
      if (
        ["node-fetch", "undici", "cross-fetch", "isomorphic-fetch"].includes(
          mod,
        ) &&
        clause?.name
      )
        fetchNames.add(clause.name.text);
      if (
        clause?.name?.text === "fetch" &&
        !["node-fetch", "undici", "cross-fetch", "isomorphic-fetch"].includes(
          mod,
        )
      )
        shadowedFetch.add("fetch");
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === "fetch")
      shadowedFetch.add("fetch");
    if (ts.isVariableStatement(stmt))
      for (const d of stmt.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === "fetch")
          shadowedFetch.add("fetch");
  }
  function collect(n: ts.Node): void {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const v = value(n.initializer);
      if (v !== undefined) constants.set(n.name.text, v);
      if (n.type) {
        const known = schemaForType(n.type);
        if (known) variableTypes.set(n.name.text, known);
      }
      if (
        n.initializer &&
        ts.isCallExpression(n.initializer) &&
        ts.isPropertyAccessExpression(n.initializer.expression) &&
        n.initializer.expression.name.text === "create" &&
        axiosNames.has(n.initializer.expression.expression.getText(sf))
      ) {
        axiosNames.add(n.name.text);
        const opts = n.initializer.arguments[0];
        if (opts && ts.isObjectLiteralExpression(opts))
          for (const p of opts.properties)
            if (
              ts.isPropertyAssignment(p) &&
              p.name.getText(sf) === "baseURL"
            ) {
              const base = value(p.initializer);
              if (base) axiosBases.set(n.name.text, base);
            }
      }
    }
    if (ts.isInterfaceDeclaration(n))
      types.set(n.name.text, members(n.members));
    if (ts.isTypeAliasDeclaration(n)) {
      const f = parseType(n.type);
      if (f.fields) types.set(n.name.text, { fields: f.fields });
    }
    ts.forEachChild(n, collect);
  }
  collect(sf);
  function expand(f: Field, seen = new Set<string>()): Field {
    if (f.element) return { ...f, element: expand(f.element, seen) };
    if (f.variants)
      return { ...f, variants: f.variants.map((v) => expand(v, seen)) };
    const nested = f.fields ?? types.get(f.type)?.fields;
    if (!nested || seen.has(f.type)) return f;
    const next = new Set(seen);
    next.add(f.type);
    return {
      ...f,
      type: "object",
      fields: Object.fromEntries(
        Object.entries(nested).map(([k, v]) => [k, expand(v, next)]),
      ),
    };
  }
  function schemaForType(n: ts.TypeNode | undefined): Schema | undefined {
    if (!n) return;
    const f = expand(parseType(n));
    return f.fields ? { fields: f.fields } : undefined;
  }
  function responseType(call: ts.CallExpression): Schema | undefined {
    if (call.typeArguments?.[0]) return schemaForType(call.typeArguments[0]);
    if (ts.isAsExpression(call.parent)) return schemaForType(call.parent.type);
    let parent: ts.Node = call;
    for (let i = 0; i < 20 && parent.parent; i++, parent = parent.parent) {
      if (ts.isVariableDeclaration(parent)) return schemaForType(parent.type);
      if (ts.isFunctionLike(parent) && parent.type)
        return schemaForType(parent.type);
    }
    return undefined;
  }
  function urlValue(n: ts.Expression): {
    raw?: string;
    status: "static" | "partially_resolved" | "unresolved";
  } {
    const exact = value(n);
    if (exact !== undefined) return { raw: exact, status: "static" };
    if (ts.isTemplateExpression(n)) {
      let raw = n.head.text,
        unknown = 0;
      for (const span of n.templateSpans) {
        const v = value(span.expression);
        if (v !== undefined) raw += v;
        else {
          raw +=
            ":" +
            (ts.isIdentifier(span.expression)
              ? span.expression.text
              : "dynamic" + ++unknown);
        }
        raw += span.literal.text;
      }
      return {
        raw: raw.startsWith("/") ? raw : undefined,
        status: raw.startsWith("/") ? "partially_resolved" : "unresolved",
      };
    }
    return { status: "unresolved" };
  }
  function objectSchema(n: ts.Expression | undefined): {
    schema?: Schema;
    knowledge: "fully_known" | "partially_known" | "unknown";
  } {
    if (!n) return { knowledge: "unknown" };
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "JSON.stringify")
      return objectSchema(n.arguments[0]);
    if (ts.isAsExpression(n))
      return { schema: schemaForType(n.type), knowledge: "fully_known" };
    if (ts.isIdentifier(n))
      return {
        schema: variableTypes.get(n.text),
        knowledge: variableTypes.has(n.text) ? "fully_known" : "unknown",
      };
    if (!ts.isObjectLiteralExpression(n)) return { knowledge: "unknown" };
    const fields: Record<string, Field> = {};
    let partial = false;
    for (const p of n.properties) {
      if (ts.isSpreadAssignment(p)) {
        partial = true;
        continue;
      }
      if (ts.isShorthandPropertyAssignment(p)) {
        fields[p.name.text] = field("unknown");
        continue;
      }
      if (ts.isPropertyAssignment(p)) {
        const name =
          ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)
            ? p.name.text
            : undefined;
        if (!name) {
          partial = true;
          continue;
        }
        const init = p.initializer;
        fields[name] = field(
          ts.isStringLiteralLike(init)
            ? "string"
            : ts.isNumericLiteral(init)
              ? "number"
              : init.kind === ts.SyntaxKind.TrueKeyword ||
                  init.kind === ts.SyntaxKind.FalseKeyword
                ? "boolean"
                : "unknown",
        );
      } else partial = true;
    }
    return {
      schema: { fields },
      knowledge: partial ? "partially_known" : "fully_known",
    };
  }
  function property(
    n: ts.ObjectLiteralExpression,
    key: string,
  ): ts.Expression | undefined {
    const p = n.properties.find(
      (x) =>
        ts.isPropertyAssignment(x) &&
        x.name.getText(sf).replace(/["']/g, "") === key,
    );
    return p && ts.isPropertyAssignment(p) ? p.initializer : undefined;
  }
  const out: ApiContract[] = [];
  function visit(n: ts.Node): void {
    if (ts.isCallExpression(n)) {
      const expr = n.expression,
        text = expr.getText(sf);
      let method: string | undefined,
        url: ts.Expression | undefined,
        body: ts.Expression | undefined,
        framework = "fetch";
      let options: ts.ObjectLiteralExpression | undefined,
        owner: string | undefined;
      if (
        (fetchNames.has(text) && !shadowedFetch.has(text)) ||
        text === "globalThis.fetch"
      ) {
        url = n.arguments[0];
        method = "GET";
        const opts = n.arguments[1];
        if (opts && ts.isObjectLiteralExpression(opts)) {
          options = opts;
          for (const p of opts.properties)
            if (ts.isPropertyAssignment(p)) {
              const key = p.name.getText(sf);
              if (key === "method") method = value(p.initializer) ?? undefined;
              if (key === "body") body = p.initializer;
            }
        }
      } else if (
        ts.isPropertyAccessExpression(expr) &&
        ["get", "post", "put", "patch", "delete", "request"].includes(
          expr.name.text,
        )
      ) {
        owner = expr.expression.getText(sf);
        if (axiosNames.has(owner)) {
          method = expr.name.text;
          url = n.arguments[0];
          body = n.arguments[1];
          framework = "axios";
          if (
            expr.name.text === "request" &&
            n.arguments[0] &&
            ts.isObjectLiteralExpression(n.arguments[0])
          ) {
            options = n.arguments[0];
            url = property(options, "url");
            method = value(property(options, "method")) ?? "GET";
            body = property(options, "data");
          } else if (
            n.arguments[2] &&
            ts.isObjectLiteralExpression(n.arguments[2])
          )
            options = n.arguments[2];
          else if (
            n.arguments[1] &&
            ts.isObjectLiteralExpression(n.arguments[1]) &&
            ["get", "delete"].includes(expr.name.text)
          )
            options = n.arguments[1];
        }
      } else if (
        ts.isIdentifier(expr) &&
        axiosNames.has(expr.text) &&
        n.arguments[0] &&
        ts.isObjectLiteralExpression(n.arguments[0])
      ) {
        framework = "axios";
        owner = expr.text;
        options = n.arguments[0];
        url = property(options, "url");
        method = value(property(options, "method")) ?? "GET";
        body = property(options, "data");
      }
      if (url) {
        const urlResult = urlValue(url),
          raw = urlResult.raw;
        let resolved = urlResult.status === "static";
        const bodyResult = objectSchema(body);
        const request = bodyResult.schema;
        let rawPath = raw;
        if (
          rawPath &&
          owner &&
          axiosBases.has(owner) &&
          rawPath.startsWith("/")
        )
          rawPath = axiosBases.get(owner)! + rawPath;
        const external = !!rawPath && /^https?:\/\//i.test(rawPath);
        if (external) resolved = false;
        const queryFields: Record<string, Field> = {};
        if (rawPath?.includes("?"))
          for (const [name] of new URLSearchParams(rawPath.split("?")[1]))
            queryFields[name] = field("string");
        const params = options && property(options, "params"),
          headers = options && property(options, "headers");
        const querySchema = objectSchema(params).schema,
          headerSchema = objectSchema(headers).schema;
        const m = normalizeMethod(method),
          location = loc(n);
        out.push({
          id: `frontend:${rel}:${location.line}:${location.column}`,
          source: "frontend",
          method: m,
          path: rawPath
            ? external
              ? rawPath
              : normalizePath(rawPath)
            : url.getText(sf),
          external,
          urlStatus: urlResult.status,
          requestKnowledge: bodyResult.knowledge,
          query:
            querySchema ??
            (Object.keys(queryFields).length
              ? { fields: queryFields }
              : undefined),
          headers: headerSchema,
          resolved,
          request,
          response: responseType(n),
          sourceLocation: location,
          framework,
          confidence: resolved
            ? 0.95
            : urlResult.status === "partially_resolved"
              ? 0.65
              : 0.25,
          evidence: [
            {
              description: external
                ? "Absolute external URL"
                : resolved
                  ? "Static API URL"
                  : urlResult.status === "partially_resolved"
                    ? "Partially resolved API URL"
                    : "Unresolved API URL",
              location,
            },
          ],
          context: n.parent.getText(sf).slice(0, 180),
          definition:
            !!n.parent.parent &&
            (ts.isFunctionDeclaration(n.parent.parent) ||
              ts.isArrowFunction(n.parent.parent)),
        });
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return { contracts: out, diagnostics: [] };
}
