# v0.1.0 local release audit

Performed 2026-11-22. The repository has Git metadata and `origin` points to `ManshaAgarwal716/Contractwatch`. No tag, commit, push, npm publication, or GitHub release was created.

- Version: `package.json`, lockfile, and CLI report 0.1.0.
- Installation: `npm ci` passed. Tests: 57 passed across 9 files. Typecheck, lint, and build passed.
- Package: `npm pack --dry-run` passed using a temporary npm cache after the default cache denied writes. The 54-file tarball contains compiled code, declarations, Python AST helper, and package documents; no demo, test, fixture, environment file, or secret was included.
- Clean consumer: tarball installed into a temporary directory. Installed CLI scanned the demo successfully; installed programmatic API returned 4 frontend calls and 3 errors.
- Demo: 4 frontend calls, 3 backend routes, 2 matches, 3 errors, 4 warnings, 1 info, no diagnostics. JSON and HTML reports were generated. Shared copies redact only the local absolute project path.
- Safety: no analyzer code or dependencies were added. The demo uses static declarations and does not run its FastAPI functions. No personal absolute paths or obvious credential strings appear in shared demo artifacts.
- Documentation: README demo commands use verified CLI syntax. Local links and report references resolve. Screenshots were not captured because no suitable browser capture path was available in this environment; real terminal, JSON, and HTML artifacts are provided.
- Git: existing user changes were preserved. No files were staged or committed.

The scanner's existing bounded static analysis limitations remain, including dynamic URLs, arbitrary wrappers/imports, runtime transformations, and the local Python requirement for FastAPI. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md).
