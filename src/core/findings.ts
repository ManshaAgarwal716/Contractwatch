import { createHash } from "node:crypto";
import type {
  ApiContract,
  ContractWatchConfig,
  Finding,
  Match,
} from "../types.js";
import { compareType, isAssignable } from "./schema.js";
import { sameRoute } from "./path.js";
export function detectFindings(
  matches: Match[],
  unmatchedFrontend: ApiContract[],
  unmatchedBackend: ApiContract[],
  ambiguous: ApiContract[],
  allBackend: ApiContract[],
  allFrontend: ApiContract[],
  config: ContractWatchConfig = {},
  backendComplete = true,
): Finding[] {
  const out: Finding[] = [];
  function add(
    code: string,
    severity: Finding["severity"],
    category: string,
    f: ApiContract | undefined,
    b: ApiContract | undefined,
    expected: string,
    actual: string,
    explanation: string,
    remediation: string,
    confidence: number,
  ): void {
    const identity = [
      code,
      f?.sourceLocation.file,
      f?.sourceLocation.line,
      b?.sourceLocation.file,
      b?.sourceLocation.line,
      expected,
      actual,
    ].join(":");
    const id = `${code}-${createHash("sha1").update(identity).digest("hex").slice(0, 10)}`;
    const match = matches.find((m) => m.frontend === f && m.backend === b);
    if (out.some((existing) => existing.id === id)) return;
    out.push({
      id,
      code,
      severity,
      confidence: Math.min(
        confidence,
        f?.confidence ?? 1,
        b?.confidence ?? 1,
        match?.confidence ?? 1,
      ),
      category,
      endpoint: `${f?.method ?? b?.method ?? "?"} ${f?.path ?? b?.path ?? ""}`,
      frontend: f?.sourceLocation,
      backend: b?.sourceLocation,
      expected,
      actual,
      explanation,
      remediation,
      evidence: [...(f?.evidence ?? []), ...(b?.evidence ?? [])],
    });
  }
  for (const f of unmatchedFrontend) {
    if (!f.method) {
      add(
        "CW002",
        "info",
        "UNKNOWN_HTTP_METHOD",
        f,
        undefined,
        "Known HTTP method",
        "Method unresolved",
        "The request method could not be determined statically.",
        "Review the method expression manually.",
        0.4,
      );
      continue;
    }
    const other = allBackend.filter((b) => sameRoute(f.path, b.path));
    if (other.length)
      add(
        "CW102",
        "warning",
        "HTTP_METHOD_MISMATCH",
        f,
        other[0],
        f.method ?? "unknown",
        other.map((x) => x.method).join(", "),
        "Route exists with a different HTTP method.",
        "Align the client method with the backend route.",
        0.9,
      );
    else
      add(
        backendComplete ? "CW101" : "CW104",
        backendComplete
          ? (config.severity?.missingEndpoint ?? "error")
          : "info",
        backendComplete
          ? "FRONTEND_ENDPOINT_NOT_FOUND"
          : "UNVERIFIED_FRONTEND_ENDPOINT",
        f,
        undefined,
        "Matching backend endpoint",
        "No matching route discovered",
        backendComplete
          ? "The frontend path and method have no discovered backend route."
          : "No route was found, but backend analysis was incomplete.",
        "Check route spelling, mounting, or analyzer coverage.",
        backendComplete ? 0.85 : 0.45,
      );
  }
  for (const f of allFrontend.filter((x) => x.external))
    add(
      "CW003",
      "info",
      "EXTERNAL_URL",
      f,
      undefined,
      "Local backend route",
      f.path,
      "The request targets an absolute URL outside the discovered project contract.",
      "Review this call separately if it targets your backend.",
      0.85,
    );
  for (const f of allFrontend.filter((x) => !x.resolved && !x.external))
    add(
      "CW001",
      "info",
      "DYNAMIC_URL",
      f,
      undefined,
      "Resolvable URL",
      f.path,
      "Static analysis could not resolve this URL.",
      "Use a static base URL or review this call manually.",
      0.5,
    );
  for (const f of ambiguous)
    add(
      "CW103",
      "warning",
      "AMBIGUOUS_ROUTE",
      f,
      undefined,
      "One matching route",
      "Multiple matching routes",
      "Several backend routes can handle this call.",
      "Inspect route ordering and parameters.",
      0.8,
    );
  for (const m of matches) {
    const { frontend: f, backend: b } = m;
    function compareFields(
      front: Record<string, import("../types.js").Field>,
      back: Record<string, import("../types.js").Field>,
      prefix = "",
    ): void {
      for (const [name, ff] of Object.entries(front)) {
        const label = prefix + name,
          bf = back[name];
        if (!bf) {
          if (!ff.optional)
            add(
              "CW201",
              "warning",
              "RESPONSE_FIELD_MISSING",
              f,
              b,
              `${label}: ${ff.type}`,
              "Field absent",
              `Frontend requires ${label}, but the response model omits it.`,
              "Add the field or update the frontend type.",
              0.9,
            );
          continue;
        }
        if (!compareType(ff, bf))
          add(
            "CW202",
            config.severity?.typeMismatch ?? "error",
            "RESPONSE_TYPE_MISMATCH",
            f,
            b,
            `${label}: ${ff.type}`,
            `${label}: ${bf.type}`,
            "Response field types differ.",
            "Align the frontend type and backend response.",
            0.95,
          );
        if (bf.nullable && !ff.nullable)
          add(
            "CW301",
            config.severity?.nullabilityMismatch ?? "warning",
            "NULLABILITY_MISMATCH",
            f,
            b,
            `${label} non-null`,
            `${label} nullable`,
            "Backend may return null where frontend requires a value.",
            "Handle null or change the backend model.",
            0.95,
          );
        if (bf.optional && !ff.optional)
          add(
            "CW302",
            "warning",
            "REQUIRED_FIELD_MISMATCH",
            f,
            b,
            `${label} required`,
            `${label} optional`,
            "Backend may omit a frontend-required field.",
            "Make the field required or optional on the client.",
            0.9,
          );
        if (ff.fields && bf.fields)
          compareFields(ff.fields, bf.fields, label + ".");
      }
    }
    if (f.response && b.response)
      compareFields(f.response.fields, b.response.fields);
    if (f.request && b.request)
      for (const [name, bf] of Object.entries(b.request.fields)) {
        const ff = f.request.fields[name];
        if (!ff) {
          if (!bf.optional && f.requestKnowledge === "fully_known")
            add(
              "CW401",
              "error",
              "REQUEST_FIELD_MISSING",
              f,
              b,
              `${name}: ${bf.type}`,
              "Field absent",
              "Backend requires a request field absent from the known frontend payload.",
              "Add the field to the payload.",
              0.9,
            );
          continue;
        }
        if (
          !isAssignable(ff, bf) &&
          ff.type !== "unknown" &&
          bf.type !== "unknown"
        )
          add(
            "CW402",
            f.requestKnowledge === "fully_known" ? "error" : "warning",
            "REQUEST_TYPE_MISMATCH",
            f,
            b,
            `${name}: ${bf.type}`,
            `${name}: ${ff.type}`,
            "Frontend sends a field type the backend request model does not accept.",
            "Align the payload with the backend request model.",
            f.requestKnowledge === "fully_known" ? 0.9 : 0.7,
          );
      }
  }
  for (const b of unmatchedBackend)
    add(
      "CW501",
      "info",
      "UNMATCHED_BACKEND_ENDPOINT",
      undefined,
      b,
      "Known frontend consumer",
      "No discovered consumer",
      "This route may serve mobile apps, external services, or dynamic requests.",
      "Review usage before removing it.",
      0.65,
    );
  const defs = allFrontend.filter((x) => x.definition);
  const groups = new Map<string, ApiContract[]>();
  for (const f of defs) {
    const key = `${f.method} ${f.path}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  for (const group of groups.values())
    if (group.length > 1)
      add(
        "CW601",
        "info",
        "DUPLICATE_API_WRAPPER",
        group[1],
        undefined,
        "One API wrapper",
        `${group.length} definitions`,
        "Multiple wrapper definitions target the same endpoint.",
        "Consolidate wrappers if they represent the same operation.",
        0.7,
      );
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
