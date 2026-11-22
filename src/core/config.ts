import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ContractWatchConfig, Severity } from "../types.js";
const severities = new Set<Severity>(["error", "warning", "info"]);
function stringArray(value: unknown, key: string): string[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((x) => typeof x === "string"))
    throw new Error(`${key} must be an array of strings`);
  return value;
}
export function validateConfig(value: unknown): ContractWatchConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Configuration must be an object");
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    "include",
    "exclude",
    "baseUrl",
    "frontend",
    "backend",
    "severity",
    "strictThreshold",
  ]);
  for (const key of Object.keys(raw))
    if (!allowed.has(key)) throw new Error(`Unknown configuration key: ${key}`);
  const include = stringArray(raw.include, "include"),
    exclude = stringArray(raw.exclude, "exclude");
  if (
    raw.baseUrl !== undefined &&
    (typeof raw.baseUrl !== "string" || !raw.baseUrl.startsWith("/"))
  )
    throw new Error("baseUrl must be a path starting with /");
  if (
    raw.strictThreshold !== undefined &&
    !severities.has(raw.strictThreshold as Severity)
  )
    throw new Error("strictThreshold must be error, warning, or info");
  for (const key of ["frontend", "backend"]) {
    const section = raw[key];
    if (section !== undefined) {
      if (!section || typeof section !== "object" || Array.isArray(section))
        throw new Error(`${key} must be an object`);
      const obj = section as Record<string, unknown>;
      if (
        Object.keys(obj).some((k) => k !== "framework") ||
        (obj.framework !== undefined && obj.framework !== "auto")
      )
        throw new Error(`${key}.framework only supports auto`);
    }
  }
  let severity: ContractWatchConfig["severity"];
  if (raw.severity !== undefined) {
    if (
      !raw.severity ||
      typeof raw.severity !== "object" ||
      Array.isArray(raw.severity)
    )
      throw new Error("severity must be an object");
    const obj = raw.severity as Record<string, unknown>;
    for (const [key, v] of Object.entries(obj))
      if (
        !["missingEndpoint", "typeMismatch", "nullabilityMismatch"].includes(
          key,
        ) ||
        !severities.has(v as Severity)
      )
        throw new Error(`Invalid severity.${key}`);
    severity = obj as ContractWatchConfig["severity"];
  }
  return {
    include,
    exclude,
    baseUrl: raw.baseUrl as string | undefined,
    frontend: raw.frontend as ContractWatchConfig["frontend"],
    backend: raw.backend as ContractWatchConfig["backend"],
    severity,
    strictThreshold:
      raw.strictThreshold as ContractWatchConfig["strictThreshold"],
  };
}
export async function loadConfig(cwd: string): Promise<ContractWatchConfig> {
  try {
    const raw = await readFile(
      path.join(cwd, "contractwatch.config.json"),
      "utf8",
    );
    return validateConfig(JSON.parse(raw));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      `Invalid contractwatch.config.json: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
