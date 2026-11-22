# Final completion audit

## Baseline inspected

The package has a TypeScript AST frontend analyzer, Python AST FastAPI analyzer, TypeScript AST Express analyzer, discovery/ignore layer, route matcher, compatibility findings, terminal/JSON/HTML reporting, Git diff, CLI, tests, fixtures, and npm metadata. The Phase 2 suite passes 48 tests. This checkout has no `.git` directory, so repository Git status cannot be inspected here.

## Strengths retained

- Static-only analysis; the Python helper uses `ast.parse` and never imports target modules.
- Explicit diagnostics for parser errors and unresolved mounts.
- Exact route precedence and conservative treatment of partial URLs and payloads.
- Escaped offline HTML and path-bounded output files.
- Public library export and working packed artifacts.

## Submission blockers found

1. No lockfile or fresh npm installation had been verified. The registry is now reachable, so this must be resolved with `npm ci` and a clean packed-tarball install.
2. The CLI does not accept `scan <project>` or `--json`, though both are common discovery paths requested for submission.
3. A real Next.js/Express project hides most calls behind a statically traceable `api(path, options)` wrapper. The analyzer currently emits an unresolved inner `fetch` and misses those call sites.
4. A second local React/FastAPI project uses cross-file router imports. The current per-file Python analyzer reports incomplete mounts and misses effective routes. This must be fixed or documented as a release limitation.
5. The frontend analyzer scans all JavaScript/TypeScript files, including backend files, creating potential false frontend findings.
6. Missing-route errors are still possible when only a subset of backend frameworks is recognized. They must remain conditional on backend coverage.
7. JSON output contains absolute project paths, which is documented but should be considered when sharing reports. HTML escaping and filesystem output boundaries need final regression verification.
8. The CLI lacks a direct test of the no-command path, positional paths, and `--json` alias.

## Lower-priority limitations

- Response access without explicit types remains informational, since arbitrary property reads are weak evidence.
- Dynamic routes and runtime configuration remain unresolved by design.
- Git diff compares discovered contracts, not semantic runtime behavior.
- No repository URL, homepage, bugs URL, or author can be filled accurately because the upstream repository is unknown.

## Planned fixes and validation

Use a lockfile and CI `npm ci`; add positional CLI paths and JSON alias; implement bounded wrapper tracing only where a static path parameter flows into `fetch` with a literal prefix; reduce backend-file frontend false positives; test two local projects read-only; run clean tarball install; document parser limits and security review. Prioritize any defects exposed by these tests before packaging.

## Resolution and final checks

- `npm install` and `npm ci` succeeded with a committed lockfile. GitHub Actions now uses `npm ci`.
- CLI accepts `scan [project]` and `--json` while preserving existing commands.
- Bounded static wrapper tracing increased one real project's discovered frontend calls from 2 to 16 and matches from 1 to 10. Dynamic method/path cases remain informational.
- Project-level Python AST resolution connects relative cross-file FastAPI routers and models. A second real project now yields 21 backend routes and no parser diagnostics.
- Backend source files are excluded from frontend call analysis; static absolute external URLs cannot be matched to local routes.
- Clean packed-tarball installation passed for CLI, JSON, HTML, programmatic import, and TypeScript consumer declarations.
- Output writes use a temporary file and rename to avoid truncating a hard-linked file outside the project.

Remaining limitations are runtime-computed wrappers, arbitrary imported Python modules, inferred response use without explicit typing, and the Python interpreter requirement. This checkout still has no `.git` directory, so Git working-tree status cannot be reviewed here; temporary Git repositories are used by diff tests.
