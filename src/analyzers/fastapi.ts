import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  AnalyzerDiagnostic,
  ApiContract,
  Schema,
  Field,
  SourceLocation,
} from "../types.js";
import { normalizePath, normalizeMethod } from "../core/path.js";
interface ParsedDiagnostic {
  code: string;
  message: string;
  line: number;
  column: number;
}
interface LocalRoute {
  owner: string;
  path: string;
  methods: string[];
  request?: Schema;
  response?: Schema;
  requestName?: string;
  responseName?: string;
  line: number;
  column: number;
}
interface Include {
  owner: string;
  child: string;
  prefix: string;
  line: number;
}
interface Import {
  module: string;
  level: number;
  name: string;
}
interface ParsedResult {
  diagnostics: ParsedDiagnostic[];
  roots?: string[];
  routerPrefixes?: Record<string, string>;
  includes?: Include[];
  imports?: Record<string, Import>;
  localRoutes?: LocalRoute[];
  models?: Record<string, Schema>;
}
export interface FastApiResult {
  contracts: ApiContract[];
  diagnostics: AnalyzerDiagnostic[];
}
const parser = fileURLToPath(
  new URL("./python/parse_fastapi.py", import.meta.url),
);
const commands: Array<[string, string[]]> =
  process.platform === "win32"
    ? [
        ["py", ["-3", "-I", parser]],
        ["python", ["-I", parser]],
        ["python3", ["-I", parser]],
      ]
    : [
        ["python3", ["-I", parser]],
        ["python", ["-I", parser]],
      ];
function parseWith(
  command: string,
  args: string[],
  payload: string,
): Promise<ParsedResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const timer = setTimeout(() => child.kill(), 10_000);
    child.on("error", (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    });
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 5_000_000) child.kill();
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 20_000) child.kill();
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error(stderr || `Python parser exited ${code}`));
      try {
        resolve(JSON.parse(stdout) as ParsedResult);
      } catch {
        reject(new Error("Python parser returned invalid JSON"));
      }
    });
    child.stdin.end(payload);
  });
}
function validField(value: unknown, depth = 0): value is Field {
  if (!value || typeof value !== "object" || depth > 30) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.type === "string" &&
    typeof f.optional === "boolean" &&
    typeof f.nullable === "boolean" &&
    (!f.fields ||
      (typeof f.fields === "object" &&
        Object.values(f.fields).every((x) => validField(x, depth + 1)))) &&
    (!f.element || validField(f.element, depth + 1))
  );
}
function validSchema(value: unknown): value is Schema {
  return (
    !!value &&
    typeof value === "object" &&
    !!(value as Schema).fields &&
    Object.values((value as Schema).fields).every((x) => validField(x))
  );
}
function diagnostic(
  file: string,
  code: string,
  message: string,
  line = 1,
  column = 1,
): AnalyzerDiagnostic {
  return { code, message, location: { file, line, column }, blocking: true };
}
async function parseFile(
  root: string,
  file: string,
): Promise<{ parsed?: ParsedResult; diagnostics: AnalyzerDiagnostic[] }> {
  const source = await readFile(path.join(root, file), "utf8");
  let parsed: ParsedResult | undefined, lastError: unknown;
  for (const [command, args] of commands) {
    try {
      parsed = await parseWith(command, args, JSON.stringify({ file, source }));
      break;
    } catch (e) {
      lastError = e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") break;
    }
  }
  if (!parsed)
    return {
      diagnostics: [
        diagnostic(
          file,
          "PYTHON_PARSER_UNAVAILABLE",
          `Python AST parser unavailable: ${String(lastError)}`,
        ),
      ],
    };
  if (!Array.isArray(parsed.diagnostics))
    return {
      diagnostics: [
        diagnostic(
          file,
          "PYTHON_PARSER_INVALID_OUTPUT",
          "Python AST parser returned an invalid result",
        ),
      ],
    };
  const diagnostics = parsed.diagnostics
    .filter((d) => !["UNMOUNTED_ROUTER", "UNRESOLVED_ROUTER"].includes(d.code))
    .map((d) => diagnostic(file, d.code, d.message, d.line, d.column));
  return { parsed, diagnostics };
}
function resolveImport(
  from: string,
  imp: Import,
  available: Set<string>,
): string | undefined {
  let base = path.posix.dirname(from);
  for (let i = 1; i < imp.level; i++) base = path.posix.dirname(base);
  const modulePath = imp.module.replaceAll(".", "/");
  if (imp.level > 0) {
    const direct = path.posix.normalize(path.posix.join(base, modulePath));
    return [direct + ".py", direct + "/__init__.py"].find((x) =>
      available.has(x),
    );
  }
  const suffix = modulePath + ".py";
  const candidates = [...available].filter(
    (x) => x === suffix || x.endsWith("/" + suffix),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}
export async function analyzeFastApiProject(
  root: string,
  files: string[],
): Promise<FastApiResult> {
  const available = new Set(files),
    parsed = new Map<string, ParsedResult>(),
    diagnostics: AnalyzerDiagnostic[] = [];
  for (const file of files) {
    try {
      const result = await parseFile(root, file);
      diagnostics.push(...result.diagnostics);
      if (result.parsed) parsed.set(file, result.parsed);
    } catch (e) {
      diagnostics.push(diagnostic(file, "PYTHON_ANALYZER_ERROR", String(e)));
    }
  }
  function symbol(
    file: string,
    name: string,
  ): { file: string; name: string } | undefined {
    const own = parsed.get(file);
    if (own?.routerPrefixes?.[name] !== undefined || own?.models?.[name])
      return { file, name };
    const imp = own?.imports?.[name];
    if (!imp) return;
    const target = resolveImport(file, imp, available);
    if (!target) return;
    return { file: target, name: imp.name };
  }
  function model(file: string, name: string | undefined): Schema | undefined {
    if (!name) return;
    const resolved = symbol(file, name);
    const schema =
      resolved && parsed.get(resolved.file)?.models?.[resolved.name];
    return schema && validSchema(schema) ? schema : undefined;
  }
  const contracts: ApiContract[] = [],
    reached = new Set<string>(),
    dedup = new Set<string>();
  function visit(
    file: string,
    owner: string,
    prefix: string,
    stack: Set<string>,
    mountEvidence: SourceLocation[],
  ): void {
    const node = `${file}#${owner}`;
    if (stack.has(node)) {
      diagnostics.push(
        diagnostic(
          file,
          "PYTHON_ROUTER_CYCLE",
          `Router inclusion cycle at ${owner}`,
        ),
      );
      return;
    }
    const data = parsed.get(file);
    if (!data?.routerPrefixes || data.routerPrefixes[owner] === undefined) {
      diagnostics.push(
        diagnostic(
          file,
          "UNRESOLVED_ROUTER",
          `Router ${owner} cannot be resolved`,
        ),
      );
      return;
    }
    const nextStack = new Set(stack);
    nextStack.add(node);
    const currentPrefix = normalizePath(
      prefix + "/" + data.routerPrefixes[owner],
    );
    for (const route of data.localRoutes ?? [])
      if (route.owner === owner) {
        reached.add(`${file}:${route.line}:${route.column}`);
        for (const rawMethod of route.methods) {
          const method = normalizeMethod(rawMethod);
          if (!method) continue;
          const fullPath = normalizePath(currentPrefix + "/" + route.path);
          const id = `backend:${file}:${route.line}:${route.column}:${method}:${fullPath}`;
          if (dedup.has(id)) continue;
          dedup.add(id);
          const location = { file, line: route.line, column: route.column };
          const response =
            route.response && validSchema(route.response)
              ? route.response
              : model(file, route.responseName);
          const request =
            route.request && validSchema(route.request)
              ? route.request
              : model(file, route.requestName);
          contracts.push({
            id,
            source: "backend",
            framework: "FastAPI",
            method,
            path: fullPath,
            resolved: true,
            request,
            response,
            sourceLocation: location,
            confidence: mountEvidence.length ? 0.91 : 0.96,
            evidence: [
              {
                description: "FastAPI route decorator parsed from Python AST",
                location,
              },
              ...mountEvidence.map((loc) => ({
                description: "Static router inclusion",
                location: loc,
              })),
            ],
          });
        }
      }
    for (const inc of data.includes ?? [])
      if (inc.owner === owner) {
        const target = symbol(file, inc.child);
        const location = { file, line: inc.line, column: 1 };
        if (!target) {
          diagnostics.push(
            diagnostic(
              file,
              "UNRESOLVED_ROUTER",
              `Router ${inc.child} cannot be resolved`,
              inc.line,
            ),
          );
          continue;
        }
        visit(
          target.file,
          target.name,
          normalizePath(currentPrefix + "/" + inc.prefix),
          nextStack,
          [...mountEvidence, location],
        );
      }
  }
  for (const [file, data] of parsed)
    for (const rootName of data.roots ?? [])
      visit(file, rootName, "", new Set(), []);
  for (const [file, data] of parsed)
    for (const route of data.localRoutes ?? [])
      if (!reached.has(`${file}:${route.line}:${route.column}`))
        diagnostics.push(
          diagnostic(
            file,
            "UNMOUNTED_ROUTER",
            `Route on ${route.owner} has no resolvable application mount`,
            route.line,
            route.column,
          ),
        );
  return { contracts, diagnostics };
}
export async function analyzeFastApi(
  root: string,
  rel: string,
): Promise<FastApiResult> {
  return analyzeFastApiProject(root, [rel]);
}
