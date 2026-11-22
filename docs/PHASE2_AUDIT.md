# Phase 2 audit

## Existing architecture

`src/core/discovery.ts` walks the project; `frontend.ts` and `express.ts` use the TypeScript compiler AST; `fastapi.ts` uses line and regex matching. `matcher.ts` pairs routes, `findings.ts` compares schemas, `reporters` render terminal and HTML, and `git/diff.ts` scans a temporary Git snapshot. `src/index.ts` exposes the library and `src/cli.ts` the binary.

## Strengths

- Local scan with no source execution or telemetry.
- TypeScript AST for JavaScript/TypeScript syntax and explicit response types.
- Symlink skipping and file-size limit in discovery.
- Exact-path precedence in the matcher and cautious informational classification for unresolved URLs.
- HTML escaping is applied to report values.
- CLI has distinct operational and strict-mode exit codes.

## Highest-impact defects and risks found

1. **Python parser reliability:** line regexes can accept malformed Python, fail on multiline syntax, and silently omit routes/models. This can turn missing backend coverage into a false missing-endpoint error. A real Python AST parser is needed. Native Tree-sitter packages are unavailable in this offline environment and would need platform installation validation. A Python AST subprocess using `-I` is safer and more testable here; it parses source only and must report interpreter absence.
2. **Express false positives/negatives:** unmounted routers are treated as effective routes; nested and cross-file mounts are not resolved; unknown owners named `app` can be misclassified.
3. **Frontend false positives:** any `fetch` identifier is accepted, including a local function with that name; `api.get` is accepted based only on its variable name. Axios config calls, partial template paths, inline JSON bodies, and response usage are missed.
4. **Schema comparison:** missing request fields are reported even for partial/spread payloads; request field types are not compared; unknown types are treated as compatible without an uncertainty marker. Nested arrays and unions need better handling.
5. **Matching:** static segments are currently allowed to match parameter routes. Exact path wins, but an isolated `/users/settings` call can still match `/users/:id`; report confidence must reflect this inference. Ambiguous routes are not linked to backend locations.
6. **Config/discovery:** JSON is cast without validating fields. Ignore matchers are recompiled per entry. Backend Python files are read twice. Project classification is path-agnostic and may scan server fetch calls as frontend calls. Binary/invalid UTF-8 files are not diagnosed.
7. **Git diff:** `git show` failures per file are swallowed; malformed base paths can produce an incomplete scan. Only selected changes are detected. Temp snapshot omits package metadata/config, which may change discovery behavior.
8. **Packaging:** no lockfile; npm registry DNS is unavailable here, so a fresh install cannot yet be verified. CI uses `npm install` and is not reproducible. The declared dependency versions differ from locally borrowed versions used for initial checks.
9. **CLI/security:** output path checks reject known symlinks but have a race before write; existing output is overwritten without warning. Invalid `diff --format` is not rejected. Analysis errors are only free-text notes.

## False-positive controls to add

- Suppress definite missing endpoints when backend parsing is incomplete.
- Track payload knowledge and avoid definite missing-field findings for spreads/unknown values.
- Do not infer fetch/Axios APIs from unrelated local identifiers.
- Prefer exact routes and classify parameter matches with lower confidence.
- Require explicit response type evidence for schema mismatch findings.

## False-negative controls to add

- Python AST parsing, nested router prefixes, inheritance, typed parameters, and Pydantic defaults.
- Axios config calls and partial static template paths.
- Express nested and cross-file mounts where statically resolvable.
- Request field type comparison and nested/array comparison.

## Test gaps and priorities

The initial eight tests cover only two integration fixtures and a few isolated cases. Add parser failure, route ambiguity, typed/spread payload, security, CLI, diff, and larger repository tests. Prioritize parser correctness, mount resolution, matching and compatibility, then configuration, reporting, and packaging. All unsupported patterns must remain visible as diagnostics and documented limitations.

## Implemented follow-up

The Python subset parser was replaced with a bundled Python AST parser; syntax errors now produce structured diagnostics. Express mounts are followed across static imports, including `.js` specifiers pointing at TypeScript source. Frontend URL and payload certainty, Axios config calls, schema comparison direction, stable finding IDs, configuration validation, TypeScript parse diagnostics, output-path safety, and Git diff failures were addressed. The test suite was expanded from 8 tests to 48 tests. See `REAL_REPOSITORY_VALIDATION.md` for a read-only scan.

Remaining high-priority limitations are cross-file FastAPI imports, custom frontend wrappers, request/response transformations, and reproducible npm installation after registry connectivity returns. The absence of a lockfile keeps this package below public-release readiness.
