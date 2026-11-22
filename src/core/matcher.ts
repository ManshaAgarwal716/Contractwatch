import type { ApiContract, Match } from "../types.js";
import { sameRoute, normalizePath } from "./path.js";
export function matchContracts(
  frontend: ApiContract[],
  backend: ApiContract[],
): {
  matches: Match[];
  unmatchedFrontend: ApiContract[];
  unmatchedBackend: ApiContract[];
  ambiguous: ApiContract[];
} {
  const matches: Match[] = [],
    unmatchedFrontend: ApiContract[] = [],
    ambiguous: ApiContract[] = [];
  const used = new Set<string>();
  for (const f of frontend) {
    if (!f.resolved) continue;
    const compatible = backend.filter(
      (b) => f.method === b.method && sameRoute(f.path, b.path),
    );
    const exact = compatible.filter(
      (b) => normalizePath(f.path) === normalizePath(b.path),
    );
    const candidates = exact.length ? exact : compatible;
    if (candidates.length === 1) {
      const b = candidates[0];
      matches.push({
        frontend: f,
        backend: b,
        confidence:
          normalizePath(f.path) === normalizePath(b.path) ? 0.99 : 0.9,
        reasoning: "HTTP method and route segments match",
      });
      used.add(b.id);
    } else if (candidates.length > 1) ambiguous.push(f);
    else unmatchedFrontend.push(f);
  }
  return {
    matches,
    unmatchedFrontend,
    unmatchedBackend: backend.filter((b) => !used.has(b.id)),
    ambiguous,
  };
}
