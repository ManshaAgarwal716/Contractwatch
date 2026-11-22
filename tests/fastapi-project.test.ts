import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanProject } from "../src/index.js";
it("resolves imported FastAPI routers and request/response models across files", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cw-fastapi-project-"));
  try {
    await mkdir(path.join(cwd, "backend", "app"), { recursive: true });
    await writeFile(
      path.join(cwd, "backend", "app", "main.py"),
      "from fastapi import FastAPI\nfrom .users import router as user_router\napp=FastAPI()\napp.include_router(user_router, prefix='/api')\n",
    );
    await writeFile(
      path.join(cwd, "backend", "app", "users.py"),
      "from fastapi import APIRouter\nfrom .schemas import User, CreateUser\nrouter=APIRouter(prefix='/users')\n@router.post('/',response_model=User)\ndef create(payload:CreateUser): pass\n",
    );
    await writeFile(
      path.join(cwd, "backend", "app", "schemas.py"),
      "from pydantic import BaseModel\nclass User(BaseModel):\n    id: int\n    name: str\nclass CreateUser(BaseModel):\n    name: str\n",
    );
    await mkdir(path.join(cwd, "frontend"), { recursive: true });
    await writeFile(
      path.join(cwd, "frontend", "api.ts"),
      "interface User { id: string; name: string }; interface CreateUser { name: string }; const payload: CreateUser = {name:'Ada'}; const user = fetch('/api/users',{method:'POST',body:JSON.stringify(payload)}) as Promise<User>;",
    );
    const r = await scanProject({ cwd });
    expect(r.backend.map((x) => x.path)).toEqual(["/api/users"]);
    expect(r.backend[0].request?.fields.name.type).toBe("string");
    expect(r.backend[0].response?.fields.id.type).toBe("number");
    expect(r.diagnostics).toHaveLength(0);
    expect(r.findings.map((x) => x.category)).toContain(
      "RESPONSE_TYPE_MISMATCH",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
