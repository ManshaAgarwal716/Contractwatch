# Reproducible demo

From the repository root, run `npm ci`, `npm run build`, then:

```bash
node dist/cli.js scan examples/demo-project --verbose
node dist/cli.js scan examples/demo-project --format json --output reports/report.json
node dist/cli.js scan examples/demo-project --format html --output reports/report.html
```

The CLI writes files inside the scanned project. The checked-in copies in `docs/demo/` were produced from these commands with the local absolute project root replaced by `examples/demo-project` for sharing. Durations vary by machine.

The demo has four frontend calls and three FastAPI routes. The valid `GET /api/users/me` route matches, but its declared response type intentionally conflicts with the backend. `GET /api/users/missing` yields CW101; `POST /api/users/list` yields CW102; `POST /api/users` yields CW401 for required `email`. The response also yields CW201, CW202, CW301, and CW302. CW501 marks the unconsumed GET list route. There are no analyzer diagnostics. The current summary is 3 errors, 4 warnings, 1 info, and health 12. See [terminal output](demo/terminal.txt), [JSON](demo/report.json), and [HTML](demo/report.html).

A static scan cannot prove runtime responses or trace arbitrary dynamic URLs, imports, and wrappers. The backend functions are deliberately skeletal: the scanner reads declarations and does not execute them.
