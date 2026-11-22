# ContractWatch

**Catch integration failures before they reach runtime.**

ContractWatch compares frontend API calls with backend routes found in source code. It reports missing routes, incompatible methods, and request/response model differences when there is enough static evidence. Analysis runs locally and does not execute the project being scanned, contact a server, or upload source code.

ContractWatch is currently **unpublished**. After publication, install with `npm install -D contractwatch` and run `npx contractwatch scan`. From this checkout:

```bash
npm ci
npm run build
node dist/cli.js scan
```

Node 20 or later is required for the package; repository tests use Node 22.12 or later. FastAPI analysis also requires a local Python 3 interpreter (`python3`, `python`, or the Windows `py` launcher). If Python is unavailable, the report includes a diagnostic and the CLI exits with code 1. JavaScript/TypeScript and Express analysis do not require Python.

## What it detects

- Static `fetch` calls, imported fetch aliases from common fetch packages, Axios method calls, Axios config-object calls, and Axios instances created in the same file.
- Bounded tracing of `fetch` wrappers whose path parameter flows through a literal prefix, including static cross-file imports.
- Literal URLs, constants, concatenation, static templates, and partially resolved template paths such as `/users/:id`. Partially resolved paths are informational and cannot produce definite missing-route errors.
- Inline JSON bodies, object literals, typed variables, shorthand fields, and spreads. Unknown or partial bodies do not produce definite missing-required-field errors.
- Express routes and static router mounts, including nested mounts and relative cross-file imports. TypeScript source imports ending in `.js` can resolve to `.ts` files.
- FastAPI routes and router prefixes using Python's standard AST, including statically resolved cross-file router and model imports, plus Pydantic model inheritance, nested fields, lists, unions, enums, defaults, and common field aliases.
- Response field absence, type, nullability and requiredness mismatches when an explicit frontend response type is linked to a call.
- Required request fields and known request field type mismatches.
- Git changes to routes, methods, response fields, request fields, and requiredness.

Example from the included broken fixture:

```text
ERROR CW202 RESPONSE_TYPE_MISMATCH
  GET /api/users/me
  Frontend: frontend/api.ts:4
  Backend: backend/main.py:11
  Expected: id: string
  Actual: id: number
  Confidence: 95%
```

## Analysis and reports

Discovery ignores symlinks, binary files, common build and vendor directories, and files over 1 MB. JavaScript and TypeScript are parsed with the TypeScript compiler API. FastAPI source is parsed by a bundled script using Python's standard `ast` module in isolated mode (`-I`); the script reads source text and never imports the target project. Express routes are resolved through static imports and mounts. Ambiguous or unresolved routes produce diagnostics instead of speculative schema comparisons.

`scan` prints a terminal report by default. `--json` is shorthand for `--format json`. `--format json` emits a versioned `ScanReport` object (`version: "1"`) containing discovery, analyzer diagnostics, frontend/backend contracts, matches, findings, and summary. `--format html --output report.html` writes a self-contained offline report with search and severity filters. Project-provided content is escaped in HTML. Reports contain file paths and contract details, so review them before sharing.

The health score starts at 100 and subtracts 20 for each error and 7 for each warning, capped at zero. Informational findings do not affect it. It is a triage indicator, not a correctness guarantee.

## CLI

```bash
contractwatch [scan]
contractwatch scan ./my-project
contractwatch scan --json
contractwatch scan --format json --output report.json
contractwatch scan --format html --output report.html
contractwatch scan --strict --verbose
contractwatch scan --quiet
contractwatch diff --base main
contractwatch diff --format json --base HEAD~1
contractwatch init
contractwatch doctor
contractwatch --version
contractwatch --help
```

Exit codes: **0** for a completed scan without blocking findings; **1** for an operational or analyzer error; **2** for findings at the strict threshold or Git diff candidates. `--strict` uses the configured threshold, `warning` by default. Informational findings are hidden in the terminal reporter unless `--verbose` is set; they remain in JSON and HTML. Output files must stay inside the project directory and cannot be symlinks.

`diff` compares the working tree against a local Git revision. It fails if the revision cannot be read or either side has blocking analyzer diagnostics. Git is optional for ordinary scans.

## Configuration and ignore rules

Run `contractwatch init` or create `contractwatch.config.json`:

```json
{
  "include": ["apps/**/src/**/*"],
  "exclude": ["**/generated/**"],
  "baseUrl": "/api",
  "strictThreshold": "warning",
  "severity": {
    "missingEndpoint": "error",
    "typeMismatch": "error",
    "nullabilityMismatch": "warning"
  }
}
```

`baseUrl` prefixes frontend paths that do not already start with it. Programmatic options override project JSON configuration. Invalid keys and values fail with an error. TypeScript configuration files are not loaded because doing so would execute repository code. `frontend.framework` and `backend.framework` currently accept only `"auto"`.

`.contractwatchignore` accepts one glob per line and `#` comments. Defaults skip `node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`, virtual environments, `generated`, and `vendor` directories.

## Programmatic API

```ts
import { scanProject } from "contractwatch";

const report = await scanProject({ cwd: process.cwd() });
console.log(report.summary, report.findings, report.diagnostics);
```

The package exports `ContractWatchConfig`, `ScanOptions`, `ScanReport`, `Finding`, `ApiContract`, `AnalyzerDiagnostic`, `Severity`, and `SourceLocation` types.

## CI

```yaml
- run: npm ci
- run: npm run typecheck && npm test && npm run lint && npm run build
- run: node dist/cli.js scan --strict --format json --output contractwatch.json
```

The committed `package-lock.json` is verified with `npm ci`; CI uses the same command.

## Limitations

Python 3 is needed for FastAPI scanning. Static cross-file FastAPI router imports are resolved when the target source is in the scanned project; dynamic imports and runtime-computed prefixes remain unresolved and produce diagnostics. Express resolves only static relative imports and mounts, and does not infer arbitrary controller types. Frontend response schemas require explicit type evidence (generic, cast, typed assignment, or enclosing return type); arbitrary property access on untyped JSON is not treated as proof. Custom wrappers are traced only when a path parameter flows directly into `fetch` through a literal prefix. Runtime URL construction, query/header compatibility, complex union semantics, and response transformations are not fully analyzed. Absolute external URLs are informational and never matched to local routes. Files with parser errors are skipped and reported. Git diff compares discovered contracts rather than runtime behavior.

## Architecture and contributing

`src/analyzers` extracts contracts; `src/core` handles discovery, normalization, matching, and findings; `src/reporters` renders reports; `src/git` compares revisions. The public API is in `src/index.ts`. See [CONTRIBUTING.md](CONTRIBUTING.md). The repository also contains audit, security, and real-world validation notes under `docs/`. Future work includes broader wrapper tracing, dynamic import handling, richer response inference, and a Node-only Python parser that removes the interpreter requirement.

## License

MIT. See [LICENSE](LICENSE).
