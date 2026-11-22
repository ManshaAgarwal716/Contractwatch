import { describe, it, expect } from "vitest";
import { matchContracts } from "../src/core/matcher.js";
import { detectFindings } from "../src/core/findings.js";
import type { ApiContract } from "../src/types.js";
const loc = { file: "api.ts", line: 1, column: 1 };
function contract(
  source: "frontend" | "backend",
  method: ApiContract["method"],
  path: string,
  id = path,
): ApiContract {
  return {
    id,
    source,
    method,
    path,
    resolved: true,
    sourceLocation: loc,
    framework: "test",
    confidence: 1,
    evidence: [{ description: "test", location: loc }],
  };
}
describe("route matching", () => {
  it("matches exact paths and ignores query/trailing slash", () => {
    const f = contract("frontend", "GET", "/users?active=1"),
      b = contract("backend", "GET", "/users/");
    const r = matchContracts([f], [b]);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].confidence).toBe(0.99);
  });
  it("matches parameter syntax and numeric segments", () => {
    const f = contract("frontend", "GET", "/users/123"),
      b = contract("backend", "GET", "/users/{user_id}");
    expect(matchContracts([f], [b]).matches[0].confidence).toBe(0.9);
  });
  it("does not collapse prefixes or segment counts", () => {
    const f = contract("frontend", "GET", "/api/users"),
      b = [
        contract("backend", "GET", "/api/v1/users"),
        contract("backend", "GET", "/api/users/me"),
      ];
    expect(matchContracts([f], b).unmatchedFrontend).toHaveLength(1);
  });
  it("prefers static path over parameter route", () => {
    const f = contract("frontend", "GET", "/users/settings"),
      b = [
        contract("backend", "GET", "/users/:id", "param"),
        contract("backend", "GET", "/users/settings", "static"),
      ];
    expect(matchContracts([f], b).matches[0].backend.id).toBe("static");
  });
  it("reports ambiguous parameter routes without selecting a schema", () => {
    const f = contract("frontend", "GET", "/users/7"),
      b = [
        contract("backend", "GET", "/users/:id", "one"),
        contract("backend", "GET", "/users/{name}", "two"),
      ];
    const m = matchContracts([f], b);
    expect(m.matches).toHaveLength(0);
    expect(m.ambiguous).toHaveLength(1);
    expect(
      detectFindings(
        m.matches,
        m.unmatchedFrontend,
        m.unmatchedBackend,
        m.ambiguous,
        b,
        [f],
      ).map((x) => x.category),
    ).toContain("AMBIGUOUS_ROUTE");
  });
  it("separates method mismatch from missing route", () => {
    const f = contract("frontend", "POST", "/users"),
      b = [contract("backend", "GET", "/users")];
    const m = matchContracts([f], b);
    const findings = detectFindings(
      m.matches,
      m.unmatchedFrontend,
      m.unmatchedBackend,
      m.ambiguous,
      b,
      [f],
    );
    expect(findings.map((x) => x.category)).toContain("HTTP_METHOD_MISMATCH");
    expect(findings.map((x) => x.category)).not.toContain(
      "FRONTEND_ENDPOINT_NOT_FOUND",
    );
  });
  it("keeps stable finding identifiers across unrelated additions", () => {
    const f = contract("frontend", "GET", "/missing"),
      b = [contract("backend", "GET", "/other")];
    const m = matchContracts([f], b);
    const one = detectFindings(
      m.matches,
      m.unmatchedFrontend,
      m.unmatchedBackend,
      m.ambiguous,
      b,
      [f],
    ).find((x) => x.category === "FRONTEND_ENDPOINT_NOT_FOUND")!.id;
    const extra = contract("backend", "GET", "/extra");
    const two = detectFindings(
      m.matches,
      m.unmatchedFrontend,
      [...m.unmatchedBackend, extra],
      m.ambiguous,
      [...b, extra],
      [f],
    ).find((x) => x.category === "FRONTEND_ENDPOINT_NOT_FOUND")!.id;
    expect(two).toBe(one);
  });
});
