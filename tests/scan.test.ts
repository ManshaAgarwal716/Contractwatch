import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../src/index.js";
import { sameRoute } from "../src/core/path.js";
import { field } from "../src/core/schema.js";
import { matchContracts } from "../src/core/matcher.js";
import type { ApiContract } from "../src/types.js";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);
describe("contract scanning", () => {
  it("matches a compatible React/FastAPI contract without findings", async () => {
    const r = await scanProject({ cwd: path.join(root, "compatible") });
    expect(r.summary.matched).toBe(1);
    expect(r.findings).toHaveLength(0);
    expect(r.summary.health).toBe(100);
  });
  it("detects concrete integration failures", async () => {
    const r = await scanProject({ cwd: path.join(root, "broken") });
    const kinds = r.findings.map((x) => x.category);
    expect(kinds).toContain("FRONTEND_ENDPOINT_NOT_FOUND");
    expect(kinds).toContain("RESPONSE_TYPE_MISMATCH");
    expect(kinds).toContain("NULLABILITY_MISMATCH");
    expect(kinds).toContain("REQUEST_FIELD_MISSING");
    expect(
      r.findings.every(
        (x) => x.evidence.length && x.confidence > 0 && x.remediation,
      ),
    ).toBe(true);
  });
  it("matches route parameters but not different static paths", () => {
    expect(sameRoute("/users/123", "/users/{id}")).toBe(true);
    expect(sameRoute("/api/users", "/api/v1/users")).toBe(false);
  });
  it("prefers an exact static route over a parameter route", () => {
    const location = { file: "api.ts", line: 1, column: 1 };
    const base = {
      method: "GET",
      resolved: true,
      sourceLocation: location,
      framework: "test",
      confidence: 1,
      evidence: [],
    } as const;
    const frontend = [
      { ...base, id: "f", source: "frontend", path: "/users/me" },
    ] as ApiContract[];
    const backend = [
      { ...base, id: "dynamic", source: "backend", path: "/users/{id}" },
      { ...base, id: "static", source: "backend", path: "/users/me" },
    ] as ApiContract[];
    expect(matchContracts(frontend, backend).matches[0].backend.id).toBe(
      "static",
    );
  });
  it("normalizes Python and TypeScript primitives", () => {
    expect(field("int").type).toBe("number");
    expect(field("str | None").nullable).toBe(true);
    expect(field("list[int]").element?.type).toBe("number");
  });
});
