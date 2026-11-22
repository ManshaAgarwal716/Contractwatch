import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { diffProject } from "../src/git/diff.js";
const exec = promisify(execFile);
it("detects route removal and added required request fields from a Git base", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cw-diff-"));
  try {
    await exec("git", ["init", "-q"], { cwd });
    await exec("git", ["config", "user.email", "cw@example.invalid"], { cwd });
    await exec("git", ["config", "user.name", "ContractWatch"], { cwd });
    await mkdir(path.join(cwd, "backend"));
    const file = path.join(cwd, "backend", "main.py");
    await writeFile(
      file,
      `from fastapi import FastAPI\nfrom pydantic import BaseModel\napp=FastAPI()\nclass Payload(BaseModel):\n    name: str\n@app.post('/users')\ndef create(payload: Payload): pass\n@app.get('/old')\ndef old(): pass\n`,
    );
    await exec("git", ["add", "."], { cwd });
    await exec("git", ["commit", "-qm", "base"], { cwd });
    await writeFile(
      file,
      `from fastapi import FastAPI\nfrom pydantic import BaseModel\napp=FastAPI()\nclass Payload(BaseModel):\n    name: str\n    email: str\n@app.post('/users')\ndef create(payload: Payload): pass\n`,
    );
    const r = await diffProject(cwd, "HEAD");
    expect(r.findings.map((x) => x.category)).toContain("ROUTE_REMOVED");
    expect(r.findings.map((x) => x.category)).toContain(
      "REQUIRED_REQUEST_FIELD_ADDED",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
