import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanProject } from "../src/index.js";
it("discovers Express router mounts and custom Axios clients", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cw-test-"));
  try {
    await writeFile(
      path.join(root, "api.ts"),
      `import axios from 'axios'; const client=axios.create(); client.get('/api/widgets/1');`,
    );
    await writeFile(
      path.join(root, "server.ts"),
      `import express from 'express'; const app=express(); const router=express.Router(); router.get('/:id', handler); app.use('/api/widgets', router);`,
    );
    const r = await scanProject({ cwd: root });
    expect(r.summary.matched).toBe(1);
    expect(r.backend[0].path).toBe("/api/widgets/:id");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("keeps dynamic URLs informational", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cw-test-"));
  try {
    await writeFile(
      path.join(root, "api.ts"),
      `function load(url: string){ return fetch(url); }`,
    );
    const r = await scanProject({ cwd: root });
    expect(r.findings.map((x) => x.category)).toContain("DYNAMIC_URL");
    expect(r.findings.map((x) => x.category)).not.toContain(
      "FRONTEND_ENDPOINT_NOT_FOUND",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("compares nested Pydantic and TypeScript fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cw-test-"));
  try {
    await writeFile(
      path.join(root, "api.ts"),
      `interface Profile { age: string } interface User { profile: Profile } const user = fetch('/me') as Promise<User>;`,
    );
    await writeFile(
      path.join(root, "main.py"),
      `from fastapi import FastAPI\nfrom pydantic import BaseModel\napp = FastAPI()\nclass Profile(BaseModel):\n    age: int\nclass User(BaseModel):\n    profile: Profile\n@app.get('/me', response_model=User)\ndef me():\n    pass\n`,
    );
    const r = await scanProject({ cwd: root });
    expect(
      r.findings.some(
        (x) =>
          x.category === "RESPONSE_TYPE_MISMATCH" &&
          x.expected.includes("profile.age"),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
