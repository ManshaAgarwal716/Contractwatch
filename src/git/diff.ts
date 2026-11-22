import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ApiContract, Field, Finding, ScanReport } from "../types.js";
import { scanProject } from "../index.js";
const run = promisify(execFile);
export async function diffProject(
  cwd: string,
  base = "main",
): Promise<{ base: string; findings: Finding[]; current: ScanReport }> {
  if (!base || base.startsWith("-"))
    throw new Error("Invalid Git base revision");
  const current = await scanProject({ cwd });
  if (current.diagnostics.some((d) => d.blocking))
    throw new Error(
      "Current project has analyzer diagnostics; diff cannot be trusted",
    );
  const tmp = await mkdtemp(path.join(os.tmpdir(), "contractwatch-"));
  try {
    let stdout: string;
    try {
      ({ stdout } = await run(
        "git",
        ["ls-tree", "-r", "-z", "--name-only", base],
        { cwd, maxBuffer: 20_000_000 },
      ));
    } catch (e) {
      throw new Error(
        `Cannot read Git base ${base}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const files = stdout.split("\0").filter((f) => /\.(tsx?|jsx?|py)$/.test(f));
    for (const file of files) {
      const dest = path.resolve(tmp, file);
      if (
        file.includes("\0") ||
        dest === tmp ||
        !dest.startsWith(tmp + path.sep)
      )
        throw new Error(`Unsafe Git tree path: ${file}`);
      let source: string;
      try {
        ({ stdout: source } = await run("git", ["show", `${base}:${file}`], {
          cwd,
          maxBuffer: 2_000_000,
        }));
      } catch (e) {
        throw new Error(
          `Cannot read ${file} from ${base}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, source);
    }
    const previous = await scanProject({ cwd: tmp });
    if (previous.diagnostics.some((d) => d.blocking))
      throw new Error(
        "Base revision has analyzer diagnostics; diff cannot be trusted",
      );
    const oldRoutes = new Map(
      previous.backend.map((x) => [`${x.method} ${x.path}`, x]),
    );
    const newRoutes = new Map(
      current.backend.map((x) => [`${x.method} ${x.path}`, x]),
    );
    const findings: Finding[] = [];
    function add(
      code: string,
      category: string,
      endpoint: string,
      old: ApiContract,
      now: ApiContract | undefined,
      expected: string,
      actual: string,
      explanation: string,
      remediation: string,
    ): void {
      findings.push({
        id: `${code}:${endpoint}:${expected}`,
        code,
        severity: "warning",
        confidence: 0.9,
        category,
        endpoint,
        backend: now?.sourceLocation ?? old.sourceLocation,
        expected,
        actual,
        explanation,
        remediation,
        evidence: [...old.evidence, ...(now?.evidence ?? [])],
      });
    }
    function compareFields(
      kind: "response" | "request",
      oldFields: Record<string, Field>,
      newFields: Record<string, Field>,
      endpoint: string,
      old: ApiContract,
      now: ApiContract,
      prefix = "",
    ): void {
      for (const [name, before] of Object.entries(oldFields)) {
        const label = prefix + name,
          after = newFields[name];
        if (kind === "response" && !after) {
          add(
            "CW702",
            "RESPONSE_FIELD_REMOVED",
            endpoint,
            old,
            now,
            label,
            "absent",
            `Response field ${label} was removed.`,
            `Restore ${label} or migrate consumers.`,
          );
          continue;
        }
        if (!after) continue;
        if (
          before.type !== after.type ||
          before.nullable !== after.nullable ||
          before.optional !== after.optional ||
          JSON.stringify(before.enumValues) !== JSON.stringify(after.enumValues)
        )
          add(
            kind === "response" ? "CW703" : "CW706",
            kind === "response"
              ? "RESPONSE_FIELD_CHANGED"
              : "REQUEST_FIELD_CHANGED",
            endpoint,
            old,
            now,
            `${label}: ${before.type}${before.nullable ? " | null" : ""}${before.optional ? " optional" : ""}`,
            `${label}: ${after.type}${after.nullable ? " | null" : ""}${after.optional ? " optional" : ""}`,
            `${kind} field ${label} changed.`,
            "Review consumer compatibility.",
          );
        if (before.fields && after.fields)
          compareFields(
            kind,
            before.fields,
            after.fields,
            endpoint,
            old,
            now,
            label + ".",
          );
        if (before.element?.fields && after.element?.fields)
          compareFields(
            kind,
            before.element.fields,
            after.element.fields,
            endpoint,
            old,
            now,
            label + "[].",
          );
      }
      if (kind === "request")
        for (const [name, after] of Object.entries(newFields)) {
          const before = oldFields[name];
          if (!after.optional && (!before || before.optional))
            add(
              "CW704",
              "REQUIRED_REQUEST_FIELD_ADDED",
              endpoint,
              old,
              now,
              prefix + name,
              "required",
              `Request field ${prefix + name} became required.`,
              "Update consumers or make the field optional.",
            );
        }
    }
    for (const [endpoint, old] of oldRoutes) {
      const now = newRoutes.get(endpoint);
      if (!now) {
        const samePath = current.backend.find((x) => x.path === old.path);
        add(
          samePath ? "CW705" : "CW701",
          samePath ? "HTTP_METHOD_CHANGED" : "ROUTE_REMOVED",
          endpoint,
          old,
          samePath,
          old.method ?? "unknown",
          samePath?.method ?? "removed",
          samePath ? "Route HTTP method changed." : "Route was removed.",
          "Update consumers or restore the previous route.",
        );
        continue;
      }
      compareFields(
        "response",
        old.response?.fields ?? {},
        now.response?.fields ?? {},
        endpoint,
        old,
        now,
      );
      compareFields(
        "request",
        old.request?.fields ?? {},
        now.request?.fields ?? {},
        endpoint,
        old,
        now,
      );
    }
    return { base, findings, current };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
