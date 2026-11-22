# Security review

ContractWatch analyzes potentially untrusted repositories. This review describes safeguards and remaining risk; it is not a guarantee of security.

## Source execution and data movement

The scanner reads source files only. JavaScript/TypeScript parsing uses the TypeScript compiler API. FastAPI parsing starts a local Python interpreter in isolated mode (`-I`) and passes source text to `ast.parse`; it never imports the target module or calls `eval`, `exec`, or target functions. Scanning has no telemetry, upload, or network request. Installation and `npm audit` may access npm separately from scanning.

The Python executable is selected from the user's `PATH` (`python3`, `python`, or Windows `py`). A trusted interpreter installation is assumed. If it is missing or parsing fails, a blocking diagnostic is emitted and the CLI exits with code 1.

## Filesystem boundaries

Discovery skips symlinks, known build/vendor directories, binary-looking source files, and source files over 1 MB. It scans only `.js`, `.jsx`, `.ts`, `.tsx`, and `.py` candidates and never reads `.env` as source. The selected project root is canonicalized. Output paths must stay under that root; existing symlinks are rejected. Reports are written to a new file in the output directory and renamed into place, avoiding truncation through hard links. A concurrent attacker able to replace parent directories during the write could still race path checks; users should scan untrusted repositories from a directory they control.

## Reports and commands

HTML report values, including route names, filenames, messages, and evidence, are escaped before insertion. The report has no CDN dependency. JSON is serialized with `JSON.stringify`. Git operations use `execFile` with argument arrays, never a shell; base revisions and tree paths are checked. Git diff fails if either revision has blocking analyzer diagnostics.

## Configuration and malformed input

Configuration is JSON only, schema-validated, and never executed. TypeScript and Python parser failures become structured diagnostics. The Python subprocess has a 10-second timeout and bounded output. Per-source size limits reduce memory exposure. Malformed source can degrade coverage, but incomplete analysis is reported and missing-route findings are not promoted to errors.

## Dependency check

`npm audit` reported 0 advisories during final validation. This is a point-in-time check. The package publishes compiled code, declarations, README, changelog, license, and the bundled AST helper; tests, fixtures, `.env` files, local paths, and temporary files are excluded from the tarball.
