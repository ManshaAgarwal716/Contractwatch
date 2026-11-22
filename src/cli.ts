#!/usr/bin/env node
import { Command } from "commander";
import {
  writeFile,
  access,
  realpath,
  lstat,
  open,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { scanProject } from "./index.js";
import { diffProject } from "./git/diff.js";
import { terminalReport } from "./reporters/terminal.js";
import { htmlReport } from "./reporters/html.js";
import { loadConfig } from "./core/config.js";
const program = new Command();
program
  .name("contractwatch")
  .description("Catch integration failures before they reach runtime.")
  .version("0.1.0");
function fail(e: unknown): never {
  console.error(`ContractWatch: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
function blocking(
  report: Awaited<ReturnType<typeof scanProject>>,
  strict: boolean,
  threshold: string,
): boolean {
  if (!strict) return false;
  const rank: Record<string, number> = { info: 1, warning: 2, error: 3 };
  return report.findings.some((f) => rank[f.severity] >= rank[threshold]);
}
program
  .command("scan", { isDefault: true })
  .description("Analyze frontend and backend contracts")
  .argument("[project]", "project directory", ".")
  .option("--json", "emit JSON report")
  .option("--format <format>", "terminal, json, or html", "terminal")
  .option("--output <file>", "write report")
  .option("--verbose", "show informational findings")
  .option("--quiet", "suppress terminal output")
  .option("--strict", "fail on findings at configured threshold")
  .action(
    async (
      project: string,
      o: {
        json?: boolean;
        format: string;
        output?: string;
        verbose?: boolean;
        quiet?: boolean;
        strict?: boolean;
      },
    ) => {
      try {
        const format = o.json ? "json" : o.format;
        if (!["terminal", "json", "html"].includes(format))
          throw new Error("Format must be terminal, json, or html");
        const cwd = await realpath(path.resolve(process.cwd(), project));
        const report = await scanProject({ cwd });
        const content =
          format === "json"
            ? JSON.stringify(report, null, 2)
            : format === "html"
              ? htmlReport(report)
              : terminalReport(report, !!o.verbose);
        if (o.output) {
          const dest = path.resolve(cwd, o.output);
          if (!dest.startsWith(cwd + path.sep))
            throw new Error("Output path must stay inside the project");
          const parent = await realpath(path.dirname(dest));
          if (parent !== cwd && !parent.startsWith(cwd + path.sep))
            throw new Error("Output parent resolves outside the project");
          try {
            if ((await lstat(dest)).isSymbolicLink())
              throw new Error("Output cannot be a symlink");
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
          const temp = path.join(parent, `.contractwatch-${randomUUID()}.tmp`);
          const handle = await open(temp, "wx", 0o600);
          try {
            await handle.writeFile(content + "\n");
            await handle.close();
            await rename(temp, dest);
          } catch (e) {
            await handle.close().catch(() => {});
            throw e;
          } finally {
            await rm(temp, { force: true }).catch(() => {});
          }
        } else if (!o.quiet) console.log(content);
        if (report.diagnostics.some((d) => d.blocking)) {
          console.error(
            `ContractWatch: ${report.diagnostics.length} analyzer diagnostic(s); scan incomplete`,
          );
          process.exitCode = 1;
        } else if (report.discovery.files.length === 0) {
          console.error("ContractWatch: no source files found");
          process.exitCode = 1;
        } else {
          const config = await loadConfig(cwd);
          if (blocking(report, !!o.strict, config.strictThreshold ?? "warning"))
            process.exitCode = 2;
        }
      } catch (e) {
        fail(e);
      }
    },
  );
program
  .command("diff")
  .description("Compare backend contracts with a Git base branch")
  .option("--base <branch>", "base branch", "main")
  .option("--format <format>", "terminal or json", "terminal")
  .action(async (o: { base: string; format: string }) => {
    try {
      if (!["terminal", "json"].includes(o.format))
        throw new Error("Diff format must be terminal or json");
      const result = await diffProject(process.cwd(), o.base);
      if (o.format === "json") console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`ContractWatch diff against ${o.base}`);
        for (const f of result.findings)
          console.log(
            `${f.severity.toUpperCase()} ${f.code} ${f.endpoint}: ${f.explanation}`,
          );
        console.log(`${result.findings.length} breaking-change candidates`);
      }
      if (result.findings.length) process.exitCode = 2;
    } catch (e) {
      fail(e);
    }
  });
program
  .command("init")
  .description("Create optional JSON configuration")
  .action(async () => {
    const file = path.resolve("contractwatch.config.json");
    try {
      await access(file);
      throw new Error("Configuration already exists");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") fail(e);
    }
    await writeFile(
      file,
      JSON.stringify(
        { exclude: ["**/generated/**"], strictThreshold: "warning" },
        null,
        2,
      ) + "\n",
    );
    console.log(`Created ${file}`);
  });
program
  .command("doctor")
  .description("Inspect project compatibility")
  .action(async () => {
    try {
      const r = await scanProject();
      console.log(
        `Node ${process.version}\nFiles ${r.discovery.files.length}\nFrameworks ${r.discovery.frameworks.join(", ") || "unknown"}\nFrontend calls ${r.frontend.length}\nBackend routes ${r.backend.length}`,
      );
      for (const e of r.discovery.errors) console.log(`Note: ${e}`);
    } catch (e) {
      fail(e);
    }
  });
if (
  process.argv[2] &&
  !process.argv[2].startsWith("-") &&
  !["scan", "diff", "init", "doctor"].includes(process.argv[2])
)
  fail(new Error(`Unknown command: ${process.argv[2]}`));
program.parseAsync(process.argv).catch(fail);
