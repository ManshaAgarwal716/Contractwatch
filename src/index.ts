import path from "node:path";
import { discover } from "./core/discovery.js";
import { loadConfig, validateConfig } from "./core/config.js";
import { analyzeFrontend } from "./analyzers/frontend.js";
import { analyzeFastApiProject } from "./analyzers/fastapi.js";
import { analyzeWrappersProject } from "./analyzers/wrappers.js";
import { analyzeExpressProject } from "./analyzers/express.js";
import { matchContracts } from "./core/matcher.js";
import { detectFindings } from "./core/findings.js";
import { normalizePath } from "./core/path.js";
import type {
  AnalyzerDiagnostic,
  ApiContract,
  ScanOptions,
  ScanReport,
} from "./types.js";
export type {
  ContractWatchConfig,
  ScanOptions,
  ScanReport,
  Finding,
  ApiContract,
  Severity,
  SourceLocation,
  AnalyzerDiagnostic,
} from "./types.js";
function backendSource(file: string): boolean {
  return (
    /(^|\/)(backend|server)(\/|$)/.test(file) ||
    /(^|\/)(server|app)\.[jt]sx?$/.test(file) ||
    /(^|\/)app\/api\//.test(file)
  );
}
export async function scanProject(
  options: ScanOptions = {},
): Promise<ScanReport> {
  const start = performance.now(),
    cwd = path.resolve(options.cwd ?? process.cwd());
  const projectConfig = await loadConfig(cwd);
  const config = validateConfig({
    ...projectConfig,
    ...(options.config ?? {}),
    severity: {
      ...(projectConfig.severity ?? {}),
      ...(options.config?.severity ?? {}),
    },
  });
  const discovery = await discover(cwd, config);
  const frontend: ApiContract[] = [],
    backend: ApiContract[] = [],
    diagnostics: AnalyzerDiagnostic[] = [];
  for (const file of discovery.files.filter(
    (f) => !f.endsWith(".py") && !backendSource(f),
  )) {
    try {
      const result = await analyzeFrontend(cwd, file);
      frontend.push(...result.contracts);
      diagnostics.push(...result.diagnostics);
    } catch (e) {
      diagnostics.push({
        code: "FRONTEND_ANALYZER_FAILURE",
        message: String(e),
        location: { file, line: 1, column: 1 },
        blocking: true,
      });
    }
  }
  try {
    const fastapi = await analyzeFastApiProject(
      cwd,
      discovery.files.filter((f) => f.endsWith(".py")),
    );
    backend.push(...fastapi.contracts);
    diagnostics.push(...fastapi.diagnostics);
  } catch (e) {
    diagnostics.push({
      code: "FASTAPI_ANALYZER_FAILURE",
      message: String(e),
      location: { file: ".", line: 1, column: 1 },
      blocking: true,
    });
  }
  try {
    const wrapped = await analyzeWrappersProject(
      cwd,
      discovery.files.filter((f) => !f.endsWith(".py") && !backendSource(f)),
    );
    const retained = frontend.filter(
      (f) =>
        !wrapped.internalFetches.has(
          `${f.sourceLocation.file}:${f.sourceLocation.line}:${f.sourceLocation.column}`,
        ),
    );
    frontend.splice(0, frontend.length, ...retained, ...wrapped.contracts);
  } catch (e) {
    diagnostics.push({
      code: "WRAPPER_ANALYZER_FAILURE",
      message: String(e),
      location: { file: ".", line: 1, column: 1 },
      blocking: true,
    });
  }
  try {
    const express = await analyzeExpressProject(
      cwd,
      discovery.files.filter((f) => !f.endsWith(".py")),
    );
    backend.push(...express.contracts);
    const expressFiles = new Set(
      express.contracts.map((c) => c.sourceLocation.file),
    );
    const retained = frontend.filter(
      (f) => !expressFiles.has(f.sourceLocation.file),
    );
    frontend.splice(0, frontend.length, ...retained);
    diagnostics.push(...express.diagnostics);
    discovery.backend.push(
      ...new Set(express.contracts.map((c) => c.sourceLocation.file)),
    );
    discovery.backend = [...new Set(discovery.backend)].sort();
  } catch (e) {
    diagnostics.push({
      code: "EXPRESS_ANALYZER_FAILURE",
      message: String(e),
      location: { file: ".", line: 1, column: 1 },
      blocking: true,
    });
  }
  if (config.baseUrl) {
    const base = normalizePath(config.baseUrl);
    for (const f of frontend)
      if (f.resolved && !f.path.startsWith(base + "/") && f.path !== base) {
        f.path = normalizePath(base + "/" + f.path);
        f.evidence.push({ description: `Configured base URL ${base}` });
      }
  }
  const seenDiagnostics = new Set<string>();
  const uniqueDiagnostics = diagnostics.filter((d) => {
    const key = `${d.code}:${d.location.file}:${d.location.line}:${d.location.column}`;
    if (seenDiagnostics.has(key)) return false;
    seenDiagnostics.add(key);
    return true;
  });
  const matched = matchContracts(frontend, backend);
  const findings = detectFindings(
    matched.matches,
    matched.unmatchedFrontend,
    matched.unmatchedBackend,
    matched.ambiguous,
    backend,
    frontend,
    config,
    backend.length > 0 && !uniqueDiagnostics.some((d) => d.blocking),
  );
  const errors = findings.filter((x) => x.severity === "error").length,
    warnings = findings.filter((x) => x.severity === "warning").length,
    info = findings.filter((x) => x.severity === "info").length;
  const health = Math.max(0, 100 - errors * 20 - warnings * 7);
  return {
    version: "1",
    cwd,
    discovery,
    diagnostics: uniqueDiagnostics,
    frontend,
    backend,
    matches: matched.matches,
    findings,
    summary: {
      frontendCalls: frontend.length,
      backendEndpoints: backend.length,
      matched: matched.matches.length,
      compatible: matched.matches.filter(
        (m) =>
          !findings.some(
            (f) =>
              f.frontend?.file === m.frontend.sourceLocation.file &&
              f.frontend.line === m.frontend.sourceLocation.line &&
              f.severity !== "info",
          ),
      ).length,
      errors,
      warnings,
      info,
      health,
      durationMs: Math.round(performance.now() - start),
    },
  };
}
