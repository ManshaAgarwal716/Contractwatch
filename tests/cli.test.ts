import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  symlink,
  link,
  realpath,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
const cli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/cli.js",
);
async function run(cwd: string, ...args: string[]) {
  try {
    const r = await exec(process.execPath, [cli, ...args], { cwd });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const x = e as Error & { code: number; stdout: string; stderr: string };
    return { code: x.code, stdout: x.stdout, stderr: x.stderr };
  }
}
async function fixture(fn: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cw-cli-"));
  try {
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
describe("CLI", () => {
  it("prints version, help, and rejects unknown commands", async () =>
    fixture(async (cwd) => {
      expect((await run(cwd, "--version")).stdout.trim()).toBe("0.1.0");
      expect((await run(cwd, "--help")).stdout).toContain("scan");
      expect((await run(cwd, "unknown")).code).toBe(1);
    }));
  it("produces valid JSON and offline HTML", async () =>
    fixture(async (cwd) => {
      await writeFile(path.join(cwd, "api.ts"), "fetch('/users')");
      const json = await run(cwd, "scan", "--format", "json");
      expect(json.code).toBe(0);
      expect(JSON.parse(json.stdout).version).toBe("1");
      expect(
        JSON.parse((await run(cwd, "scan", "--json")).stdout).version,
      ).toBe("1");
      expect((await run(cwd)).stdout).toContain("ContractWatch v0.1.0");
      const html = await run(
        cwd,
        "scan",
        "--format",
        "html",
        "--output",
        "report.html",
      );
      expect(html.code).toBe(0);
      expect(await readFile(path.join(cwd, "report.html"), "utf8")).toContain(
        "<!doctype html>",
      );
    }));
  it("uses strict exit 2 and operational exit 1", async () =>
    fixture(async (cwd) => {
      await writeFile(path.join(cwd, "api.ts"), "fetch('/missing')");
      await writeFile(
        path.join(cwd, "main.py"),
        "from fastapi import FastAPI\napp=FastAPI()\n@app.get('/other')\ndef other(): pass\n",
      );
      expect((await run(cwd, "scan", "--strict", "--quiet")).code).toBe(2);
      expect((await run(cwd, "scan", "--format", "xml")).code).toBe(1);
      await writeFile(path.join(cwd, "main.py"), "def broken(:\n");
      expect((await run(cwd, "scan", "--quiet")).code).toBe(1);
    }));
  it("creates config once and reports project compatibility", async () =>
    fixture(async (cwd) => {
      await writeFile(path.join(cwd, "api.ts"), "fetch('/users')");
      expect((await run(cwd, "init")).code).toBe(0);
      expect(
        JSON.parse(
          await readFile(path.join(cwd, "contractwatch.config.json"), "utf8"),
        ).strictThreshold,
      ).toBe("warning");
      expect((await run(cwd, "init")).code).toBe(1);
      expect((await run(cwd, "doctor")).stdout).toContain("Frontend calls 1");
    }));
  it("rejects output traversal and a source-free project", async () =>
    fixture(async (cwd) => {
      expect((await run(cwd, "scan", "--quiet")).code).toBe(1);
      await writeFile(path.join(cwd, "api.ts"), "fetch('/users')");
      expect((await run(cwd, "scan", "--output", "../escape.html")).code).toBe(
        1,
      );
    }));
  it("reports invalid Git base revisions", async () =>
    fixture(async (cwd) => {
      await writeFile(path.join(cwd, "api.ts"), "fetch('/users')");
      expect((await run(cwd, "diff", "--base", "not-a-branch")).code).toBe(1);
    }));
});

it("rejects an output file symlink", async () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "api.ts"), "fetch('/x')");
    const outside = path.join(os.tmpdir(), "cw-outside-" + Date.now());
    await writeFile(outside, "safe");
    try {
      await symlink(outside, path.join(cwd, "report.json"));
      expect((await run(cwd, "scan", "--output", "report.json")).code).toBe(1);
      expect(await readFile(outside, "utf8")).toBe("safe");
    } finally {
      await rm(outside, { force: true });
    }
  }));

it("scans an explicit project path", async () =>
  fixture(async (cwd) => {
    await mkdir(path.join(cwd, "app"));
    await writeFile(path.join(cwd, "app", "api.ts"), "fetch('/users')");
    const r = await run(cwd, "scan", "./app", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).cwd).toBe(
      await realpath(path.join(cwd, "app")),
    );
  }));

it("does not truncate a hard-linked file outside the project", async () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "api.ts"), "fetch('/x')");
    const outside = path.join(os.tmpdir(), `cw-hardlink-${Date.now()}`);
    await writeFile(outside, "untouched");
    try {
      await link(outside, path.join(cwd, "report.json"));
      expect(
        (await run(cwd, "scan", "--output", "report.json", "--json")).code,
      ).toBe(0);
      expect(await readFile(outside, "utf8")).toBe("untouched");
      expect(
        JSON.parse(await readFile(path.join(cwd, "report.json"), "utf8"))
          .version,
      ).toBe("1");
    } finally {
      await rm(outside, { force: true });
    }
  }));
