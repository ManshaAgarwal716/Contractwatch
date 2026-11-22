# ContractWatch portfolio material

## Short description

ContractWatch is a local static analyzer that reconstructs API contracts from frontend calls and FastAPI or Express routes. It flags likely integration mismatches with source locations, evidence, and confidence, and exports terminal, JSON, and offline HTML reports.

## Resume bullets

- Built a TypeScript AST frontend analyzer and Python AST FastAPI analyzer to reconstruct API contracts without executing scanned code.
- Implemented route matching and request/response compatibility checks with confidence-aware findings and conservative handling of unresolved evidence.
- Shipped a CLI, programmatic API, Git diff workflow, and terminal, JSON, and self-contained HTML reporting.
- Validated the npm package with automated tests, typecheck, lint, build, pack, and clean consumer installation.

## GitHub description

Static frontend/backend API contract analyzer that catches likely integration mismatches before runtime.

## Tech stack

TypeScript, Node.js, TypeScript compiler API, Python standard AST, FastAPI and Express source analysis, Commander, Vitest, Prettier, npm, GitHub Actions.

## Interview explanation

Frontend and backend changes can drift before integration tests run. ContractWatch scans source locally, extracts calls and routes, normalizes paths and schemas, matches by method and route, and checks known request and response fields. The hard part is handling incomplete static evidence without overstating certainty, especially dynamic URLs, wrappers, imports, and optional model fields. It reports diagnostics and confidence rather than claiming runtime truth. Future work could broaden bounded wrapper analysis and response inference.

## Interview questions

1. **Why static analysis?** It catches likely drift without running the target app or server.
2. **What parses JavaScript?** The TypeScript compiler API.
3. **What parses Python?** A bundled helper using Python's standard `ast`.
4. **Does the Python helper import target modules?** No; it parses source text in isolated mode.
5. **How are routes discovered?** FastAPI decorators and Express route and router calls, including supported static mounts.
6. **How are calls discovered?** Supported fetch, Axios, and bounded wrapper patterns.
7. **How are contracts matched?** HTTP method and normalized path segments, preferring exact paths.
8. **What happens with multiple matches?** An ambiguous-route finding is emitted.
9. **How are false positives limited?** Dynamic or incomplete evidence is downgraded or diagnosed.
10. **What is confidence?** A per-finding score capped by source contracts and match confidence.
11. **Can dynamic URLs be fully traced?** No; unresolved URLs are informational.
12. **How are response types inferred?** From explicit frontend type evidence linked to a call.
13. **How are request fields checked?** Known payload fields are compared with backend model fields; fully known payloads can prove missing required fields.
14. **What reports exist?** Terminal, versioned JSON, and self-contained HTML.
15. **How is HTML kept safe?** Source-derived text is escaped before insertion.
16. **How is package quality checked?** Tests, typecheck, lint, build, dry-run pack, and clean tarball installation.
17. **What does Git diff compare?** Discovered contracts against a local Git revision, rather than runtime behavior.
18. **What is a key limitation?** Arbitrary runtime URL construction, imports, and transformations exceed bounded static analysis.
