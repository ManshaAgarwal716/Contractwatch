import type { ScanReport } from "../types.js";
export function terminalReport(r: ScanReport, verbose = false): string {
  const s = r.summary;
  const lines = [
    `ContractWatch v0.1.0`,
    ``,
    `Project: ${r.cwd}`,
    `Frameworks: ${r.discovery.frameworks.join(", ") || "unknown"}`,
    `API calls: ${s.frontendCalls}  Backend routes: ${s.backendEndpoints}  Matched: ${s.matched}`,
    `Health: ${s.health}/100  Errors: ${s.errors}  Warnings: ${s.warnings}  Info: ${s.info}`,
    ``,
  ];
  for (const f of r.findings) {
    if (!verbose && f.severity === "info") continue;
    lines.push(
      `${f.severity.toUpperCase()} ${f.code} ${f.category}`,
      `  ${f.endpoint}`,
    );
    if (f.frontend)
      lines.push(`  Frontend: ${f.frontend.file}:${f.frontend.line}`);
    if (f.backend) lines.push(`  Backend: ${f.backend.file}:${f.backend.line}`);
    lines.push(
      `  ${f.explanation}`,
      `  Expected: ${f.expected}`,
      `  Actual: ${f.actual}`,
      `  Confidence: ${Math.round(f.confidence * 100)}%`,
      `  Fix: ${f.remediation}`,
      ``,
    );
  }
  if (r.diagnostics.length)
    lines.push(
      "Analysis diagnostics:",
      ...r.diagnostics.map(
        (d) =>
          `  ${d.code} ${d.location.file}:${d.location.line}: ${d.message}`,
      ),
    );
  if (r.discovery.errors.length)
    lines.push("Analysis notes:", ...r.discovery.errors.map((e) => `  ${e}`));
  lines.push(`Completed in ${s.durationMs} ms`);
  return lines.join("\n");
}
