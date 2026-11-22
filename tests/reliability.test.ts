import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanProject } from "../src/index.js";
import { htmlReport } from "../src/reporters/html.js";
import { matchContracts } from "../src/core/matcher.js";
import type { ApiContract } from "../src/types.js";
async function project(
  files: Record<string, string>,
  run: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cw-reliability-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const target = path.join(cwd, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
const py = `from fastapi import FastAPI\nfrom pydantic import BaseModel\napp=FastAPI()\nclass Payload(BaseModel):\n    name: str\n    age: int\n    email: str\n@app.post('/users', response_model=Payload)\nasync def create(payload: Payload):\n    pass\n`;
describe("frontend evidence", () => {
  it("resolves constants, static templates and partial dynamic templates", async () =>
    project(
      {
        "api.ts":
          "const BASE='/api'; fetch(BASE+'/users'); fetch(`${BASE}/users`); fetch(`${BASE}/users/${id}`);",
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(r.frontend.map((x) => x.path)).toEqual([
          "/api/users",
          "/api/users",
          "/api/users/:id",
        ]);
        expect(r.frontend[2].urlStatus).toBe("partially_resolved");
        expect(
          r.findings.filter(
            (x) =>
              x.category === "FRONTEND_ENDPOINT_NOT_FOUND" &&
              x.severity === "error",
          ),
        ).toHaveLength(0);
      },
    ));
  it("ignores a local function named fetch", async () =>
    project(
      { "api.ts": "function fetch(x: string){ return x; } fetch('/users');" },
      async (cwd) => {
        expect((await scanProject({ cwd })).frontend).toHaveLength(0);
      },
    ));
  it("recognizes imported Axios alias and config object calls", async () =>
    project(
      {
        "api.ts":
          "import http from 'axios'; http({url:'/users',method:'POST',data:{name:'Ada',age:'20'}}); http.request({url:'/users',method:'GET'});",
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(r.frontend.map((x) => x.method)).toEqual(["POST", "GET"]);
        expect(r.frontend[0].request?.fields.age.type).toBe("string");
      },
    ));
  it("uses Axios instance baseURL and query parameters", async () =>
    project(
      {
        "api.ts":
          "import axios from 'axios'; const client=axios.create({baseURL:'/api'}); client.get('/users',{params:{page:1},headers:{Authorization:'token'}});",
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(r.frontend[0].path).toBe("/api/users");
        expect(r.frontend[0].query?.fields.page.type).toBe("number");
        expect(r.frontend[0].headers?.fields.Authorization.type).toBe("string");
      },
    ));
  it("compares known inline JSON body and does not accuse spreads of missing fields", async () =>
    project(
      {
        "api.ts":
          "fetch('/users',{method:'POST',body:JSON.stringify({name:'Ada',age:'20'})}); fetch('/users',{method:'POST',body:JSON.stringify({name:'Ada',...extra})});",
        "main.py": py,
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(
          r.findings.some((x) => x.category === "REQUEST_TYPE_MISMATCH"),
        ).toBe(true);
        expect(
          r.findings.filter((x) => x.category === "REQUEST_FIELD_MISSING"),
        ).toHaveLength(1);
        expect(r.frontend[1].requestKnowledge).toBe("partially_known");
      },
    ));
});
describe("Python AST reliability", () => {
  it("handles multiline decorators, nested router prefixes and inherited models", async () =>
    project(
      {
        "main.py": `from fastapi import FastAPI, APIRouter\nfrom pydantic import BaseModel\napp=FastAPI()\nouter=APIRouter(prefix='/api')\ninner=APIRouter(prefix='/users')\nclass Base(BaseModel):\n    id: int\nclass User(Base):\n    name: str\n@inner.get(\n    '/{id}',\n    response_model=User,\n)\nasync def get(id: int): pass\nouter.include_router(inner, prefix='/v1')\napp.include_router(outer)\n`,
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(r.backend.map((x) => x.path)).toEqual(["/api/v1/users/{id}"]);
        expect(r.backend[0].response?.fields.id.type).toBe("number");
        expect(r.diagnostics).toHaveLength(0);
      },
    ));
  it("reports invalid Python and suppresses definite missing-endpoint errors", async () =>
    project(
      {
        "api.ts": "fetch('/users')",
        "main.py":
          "from fastapi import FastAPI\napp=FastAPI()\n@app.get('/users')\ndef broken(:\n",
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(r.diagnostics[0].code).toBe("PYTHON_SYNTAX_ERROR");
        expect(
          r.findings.find((x) => x.category === "UNVERIFIED_FRONTEND_ENDPOINT")
            ?.severity,
        ).toBe("info");
      },
    ));
  it("does not expose unmounted router routes as live endpoints", async () =>
    project(
      {
        "main.py":
          "from fastapi import APIRouter\nrouter=APIRouter()\n@router.get('/users')\ndef get(): pass\n",
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(r.backend).toHaveLength(0);
        expect(r.diagnostics[0].code).toBe("UNMOUNTED_ROUTER");
      },
    ));
  it("extracts enum, list, alias and nullable defaults", async () =>
    project(
      {
        "main.py": `from enum import Enum\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel, Field\napp=FastAPI()\nclass Role(str,Enum):\n    ADMIN='admin'\n    USER='user'\nclass User(BaseModel):\n    role: Role\n    tags: list[str]\n    name: str | None = None\n    identity: int = Field(alias='id')\n@app.get('/user',response_model=User)\ndef get(): pass\n`,
      },
      async (cwd) => {
        const fields = (await scanProject({ cwd })).backend[0].response!.fields;
        expect(fields.role.enumValues).toEqual(["admin", "user"]);
        expect(fields.tags.element?.type).toBe("string");
        expect(fields.name.nullable).toBe(true);
        expect(fields.name.optional).toBe(true);
        expect(fields.id.type).toBe("number");
      },
    ));
});
describe("Express mounting", () => {
  it("resolves nested cross-file router mounts", async () =>
    project(
      {
        "app.ts":
          "import express from 'express'; import userRouter from './users.js'; const app=express(); const api=express.Router(); app.use(otherMiddleware); api.use('/users',userRouter); app.use('/api/v1',api);",
        "users.ts":
          "import express from 'express'; const router=express.Router(); router.get('/',handler); router.get('/:id',handler); export default router;",
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(r.backend.map((x) => x.path)).toEqual([
          "/api/v1/users",
          "/api/v1/users/:id",
        ]);
        expect(r.diagnostics).toHaveLength(0);
      },
    ));
  it("reports unresolved mounts and unmounted routes", async () =>
    project(
      {
        "app.ts":
          "import express from 'express'; import users from './missing'; const app=express(); app.use('/users',users);",
        "routes.ts":
          "import express from 'express'; const router=express.Router(); router.get('/',handler);",
      },
      async (cwd) => {
        const r = await scanProject({ cwd });
        expect(r.backend).toHaveLength(0);
        expect(r.diagnostics.map((x) => x.code)).toContain(
          "EXPRESS_UNRESOLVED_MOUNT",
        );
        expect(r.diagnostics.map((x) => x.code)).toContain(
          "EXPRESS_UNMOUNTED_ROUTER",
        );
      },
    ));
});
describe("safety and configuration", () => {
  it("escapes route and filename content in HTML", async () =>
    project(
      { "api.ts": "fetch('/<script>alert(1)</script>')" },
      async (cwd) => {
        const report = await scanProject({ cwd });
        const html = htmlReport(report);
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      },
    ));
  it("validates configuration values", async () =>
    project(
      {
        "api.ts": "fetch('/x')",
        "contractwatch.config.json": '{"strictThreshold":"urgent"}',
      },
      async (cwd) => {
        await expect(scanProject({ cwd })).rejects.toThrow("strictThreshold");
      },
    ));
  it("skips ignored, symlinked and oversized files", async () =>
    project(
      {
        "api.ts": "fetch('/a')",
        "ignore.ts": "fetch('/ignored')",
        "huge.ts": "fetch('/huge')" + " ".repeat(1_000_001),
        ".contractwatchignore": "ignore.ts",
      },
      async (cwd) => {
        await symlink(path.join(cwd, "api.ts"), path.join(cwd, "link.ts"));
        const r = await scanProject({ cwd });
        expect(r.discovery.files).toEqual(["api.ts"]);
        expect(
          r.discovery.errors.some((x) => x.includes("Skipped large file")),
        ).toBe(true);
      },
    ));
});
it("reports TypeScript syntax errors instead of extracting partial calls", async () =>
  project(
    {
      "api.ts": "fetch('/users';",
      "main.py":
        "from fastapi import FastAPI\napp=FastAPI()\n@app.get('/users')\ndef get(): pass\n",
    },
    async (cwd) => {
      const r = await scanProject({ cwd });
      expect(
        r.diagnostics.some((d) => d.code === "TYPESCRIPT_SYNTAX_ERROR"),
      ).toBe(true);
      expect(r.frontend).toHaveLength(0);
    },
  ));
it("skips a binary source file", async () =>
  project(
    { "api.ts": "fetch('/users')", "binary.ts": "\0fetch('/hidden')" },
    async (cwd) => {
      const r = await scanProject({ cwd });
      expect(r.discovery.files).toEqual(["api.ts"]);
      expect(
        r.discovery.errors.some((x) => x.includes("Skipped binary file")),
      ).toBe(true);
    },
  ));
it("applies programmatic config after project config", async () =>
  project(
    {
      "api.ts": "fetch('/users')",
      "contractwatch.config.json": '{"baseUrl":"/old"}',
    },
    async (cwd) => {
      const r = await scanProject({ cwd, config: { baseUrl: "/api" } });
      expect(r.frontend[0].path).toBe("/api/users");
    },
  ));
it("does not match absolute external URLs against local routes", async () =>
  project(
    {
      "api.ts": "fetch('https://example.invalid/users')",
      "main.py":
        "from fastapi import FastAPI\napp=FastAPI()\n@app.get('/users')\ndef users(): pass\n",
    },
    async (cwd) => {
      const r = await scanProject({ cwd });
      expect(r.summary.matched).toBe(0);
      expect(r.findings.map((x) => x.category)).toContain("EXTERNAL_URL");
      expect(r.findings.some((x) => x.severity === "error")).toBe(false);
    },
  ));

it("escapes finding evidence in HTML", async () =>
  project(
    {
      "api.ts": "fetch('/missing')",
      "main.py":
        "from fastapi import FastAPI\napp=FastAPI()\n@app.get('/other')\ndef other(): pass\n",
    },
    async (cwd) => {
      const report = await scanProject({ cwd });
      report.findings[0].evidence.push({
        description: "<img src=x onerror=alert(1)>",
      });
      const html = htmlReport(report);
      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    },
  ));
