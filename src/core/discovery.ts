import { readdir, readFile, lstat, realpath, open } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import type { ContractWatchConfig, Discovery } from "../types.js";
const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".turbo",
  "generated",
  "vendor",
  ".cache",
]);
export async function discover(
  cwd: string,
  config: ContractWatchConfig = {},
): Promise<Discovery> {
  const root = await realpath(cwd);
  const result: Discovery = {
    files: [],
    packageFiles: [],
    tsconfigFiles: [],
    frontend: [],
    backend: [],
    frameworks: [],
    monorepo: false,
    errors: [],
  };
  let patterns: string[] = [];
  try {
    patterns = (await readFile(path.join(root, ".contractwatchignore"), "utf8"))
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => !!x && !x.startsWith("#"));
  } catch {
    /* optional */
  }
  patterns.push(...(config.exclude ?? []));
  const ignoreMatchers = patterns.map((p) =>
    picomatch(p, { dot: true, basename: true }),
  );
  const includeMatchers = config.include?.map((p) =>
    picomatch(p, { dot: true }),
  );
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      result.errors.push(String(e));
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name),
        rel = path.relative(root, full).replaceAll(path.sep, "/");
      if (
        entry.isSymbolicLink() ||
        ignored.has(entry.name) ||
        ignoreMatchers.some((match) => match(rel) || match(rel + "/"))
      )
        continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === "package.json") result.packageFiles.push(rel);
      if (entry.name === "tsconfig.json") result.tsconfigFiles.push(rel);
      if (
        !/\.(?:tsx?|jsx?|py)$/.test(entry.name) ||
        /\.(?:test|spec|d|generated)\.[jt]sx?$/.test(entry.name)
      )
        continue;
      if (
        includeMatchers?.length &&
        !includeMatchers.some((match) => match(rel))
      )
        continue;
      try {
        if ((await lstat(full)).size > 1_000_000) {
          result.errors.push(`Skipped large file: ${rel}`);
          continue;
        }
      } catch {
        continue;
      }
      const handle = await open(full, "r");
      try {
        const sample = Buffer.alloc(512);
        const { bytesRead } = await handle.read(sample, 0, 512, 0);
        if (sample.subarray(0, bytesRead).includes(0)) {
          result.errors.push(`Skipped binary file: ${rel}`);
          continue;
        }
      } finally {
        await handle.close();
      }
      result.files.push(rel);
      if (/\.(?:tsx?|jsx?)$/.test(rel)) result.frontend.push(rel);
      if (rel.endsWith(".py")) result.backend.push(rel);
    }
  }
  await walk(root);
  for (const p of result.packageFiles) {
    try {
      const pkg = JSON.parse(
        await readFile(path.join(root, p), "utf8"),
      ) as Record<string, unknown>;
      const deps = JSON.stringify([pkg.dependencies, pkg.devDependencies]);
      if (/react|next/.test(deps))
        result.frameworks.push(/next/.test(deps) ? "Next.js" : "React");
      if (/express/.test(deps)) result.frameworks.push("Express");
      if (pkg.workspaces) result.monorepo = true;
    } catch (e) {
      result.errors.push(`Invalid ${p}: ${String(e)}`);
    }
  }
  for (const p of result.files.filter((x) => x.endsWith(".py"))) {
    try {
      const s = await readFile(path.join(root, p), "utf8");
      if (/\b(?:FastAPI|APIRouter)\s*\(/.test(s)) {
        result.frameworks.push("FastAPI");
        break;
      }
    } catch {
      /* reported during analysis */
    }
  }
  result.frameworks = [...new Set(result.frameworks)];
  result.monorepo ||= result.packageFiles.length > 1;
  return result;
}
