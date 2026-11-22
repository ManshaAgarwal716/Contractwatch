import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanProject } from "../src/index.js";
async function project(
  files: Record<string, string>,
  check: (cwd: string) => Promise<void>,
) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cw-wrapper-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const target = path.join(cwd, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    await check(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
it("traces a static imported fetch wrapper and suppresses its inner call", async () =>
  project(
    {
      "frontend/api.ts":
        "export async function api(path: string, {method='GET',body}: {method?:string;body?:unknown}={}) { return fetch(`/api${path}`, {method,body:JSON.stringify(body)}); }",
      "frontend/service.ts":
        "import {api} from './api.js'; api('/users',{method:'POST',body:{name:'Ada'}});",
      "backend/main.py":
        "from fastapi import FastAPI\napp=FastAPI()\n@app.post('/api/users')\ndef create(): pass\n",
    },
    async (cwd) => {
      const r = await scanProject({ cwd });
      expect(r.frontend).toHaveLength(1);
      expect(r.frontend[0].path).toBe("/api/users");
      expect(r.frontend[0].method).toBe("POST");
      expect(r.frontend[0].request?.fields.name.type).toBe("string");
      expect(r.summary.matched).toBe(1);
      expect(r.diagnostics).toHaveLength(0);
    },
  ));
it("keeps dynamic wrapper methods and paths non-definitive", async () =>
  project(
    {
      "api.ts":
        "export function api(path:string,{method='GET'}={}){return fetch(`/api${path}`,{method})} api(`/users/${id}`,{method:verb});",
    },
    async (cwd) => {
      const r = await scanProject({ cwd });
      expect(r.frontend).toHaveLength(1);
      expect(r.frontend[0].resolved).toBe(false);
      expect(r.frontend[0].method).toBeUndefined();
      expect(r.findings.every((f) => f.severity === "info")).toBe(true);
    },
  ));
it("does not mistake backend fetches for frontend API calls", async () =>
  project(
    {
      "backend/server.ts":
        "import express from 'express'; const app=express(); app.get('/health',handler); fetch('/external');",
    },
    async (cwd) => {
      const r = await scanProject({ cwd });
      expect(r.frontend).toHaveLength(0);
      expect(r.backend.map((x) => x.path)).toEqual(["/health"]);
    },
  ));
