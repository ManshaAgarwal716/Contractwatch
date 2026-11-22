import { describe, it, expect } from "vitest";
import { field, isAssignable, compareType } from "../src/core/schema.js";
import { detectFindings } from "../src/core/findings.js";
import type { ApiContract, Field, Match } from "../src/types.js";
const loc = { file: "api.ts", line: 1, column: 1 };
function matched(
  front: Record<string, Field>,
  back: Record<string, Field>,
  request = false,
  knowledge: ApiContract["requestKnowledge"] = "fully_known",
): ReturnType<typeof detectFindings> {
  const f: ApiContract = {
    id: "f",
    source: "frontend",
    method: "POST",
    path: "/users",
    resolved: true,
    sourceLocation: loc,
    framework: "fetch",
    confidence: 1,
    evidence: [{ description: "typed call" }],
    ...(request
      ? { request: { fields: front }, requestKnowledge: knowledge }
      : { response: { fields: front } }),
  };
  const b: ApiContract = {
    ...f,
    id: "b",
    source: "backend",
    framework: "FastAPI",
    ...(request
      ? { request: { fields: back }, response: undefined }
      : { response: { fields: back } }),
  };
  const m: Match = {
    frontend: f,
    backend: b,
    confidence: 0.99,
    reasoning: "exact",
  };
  return detectFindings([m], [], [], [], [b], [f]);
}
describe("schema compatibility", () => {
  it("accepts identical primitive fields and compatible Python int", () => {
    expect(matched({ id: field("number") }, { id: field("int") })).toHaveLength(
      0,
    );
  });
  it("detects nested array element types", () => {
    expect(compareType(field("string[]"), field("list[int]"))).toBe(false);
  });
  it("accepts backend enum as frontend string", () => {
    expect(
      isAssignable(
        {
          type: "enum",
          optional: false,
          nullable: false,
          enumValues: ["a", "b"],
        },
        field("string"),
      ),
    ).toBe(true);
  });
  it("rejects a backend union wider than the frontend type", () => {
    const union: Field = {
      type: "union",
      optional: false,
      nullable: false,
      variants: [field("string"), field("number")],
    };
    expect(
      matched({ value: field("string") }, { value: union }).map(
        (x) => x.category,
      ),
    ).toContain("RESPONSE_TYPE_MISMATCH");
  });
  it("treats unknown types as uncertain and emits no mismatch", () => {
    expect(
      matched({ value: field("string") }, { value: field("unknown") }),
    ).toHaveLength(0);
  });
  it("reports missing, nullable and optional response fields", () => {
    const findings = matched(
      { name: field("string"), avatar: field("string") },
      { avatar: { ...field("string"), nullable: true, optional: true } },
    );
    expect(findings.map((x) => x.category)).toEqual(
      expect.arrayContaining([
        "RESPONSE_FIELD_MISSING",
        "NULLABILITY_MISMATCH",
        "REQUIRED_FIELD_MISMATCH",
      ]),
    );
  });
  it("reports a known request type mismatch", () => {
    expect(
      matched({ age: field("string") }, { age: field("number") }, true).map(
        (x) => x.category,
      ),
    ).toContain("REQUEST_TYPE_MISMATCH");
  });
  it("does not accuse partial or unknown bodies of omitting fields", () => {
    expect(
      matched(
        { name: field("string") },
        { name: field("string"), email: field("string") },
        true,
        "partially_known",
      ).map((x) => x.category),
    ).not.toContain("REQUEST_FIELD_MISSING");
  });
});

it("reports nullability without a duplicate type mismatch", () => {
  const findings = matched(
    { avatar: field("string") },
    { avatar: { ...field("string"), nullable: true } },
  );
  expect(findings.map((x) => x.category)).toContain("NULLABILITY_MISMATCH");
  expect(findings.map((x) => x.category)).not.toContain(
    "RESPONSE_TYPE_MISMATCH",
  );
});
