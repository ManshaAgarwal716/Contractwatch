# Read-only real-project validation

ContractWatch scanned two existing local projects without changing or executing their source. Measurements are from the final build on Node 24.20.0. Counts are static-discovery observations, not usage or dead-code claims.

| Project | Stack | Files | Frontend calls | Backend routes | Matches | Info | Errors / warnings | Diagnostics | Time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Trellis | Next.js + Express | 147 | 16 | 33 | 10 | 29 | 0 / 0 | 0 | 235 ms |
| LearnTube | React + FastAPI | 91 | 5 | 21 | 0 | 26 | 0 / 0 | 0 | 1,044 ms |

## Manual sample review

Trellis defines `POST /api/auth/refresh` in Express and calls it with `fetch`; ContractWatch matched them. It also traces a statically defined `api(path, options)` wrapper with prefix `/api`, discovering calls such as `GET /api/state` and `POST /api/claims`. The wrapper used dynamic paths in several calls; those remain informational. The 23 unmatched backend routes are candidates consumed by other code or dynamic calls, not defects.

LearnTube mounts routers imported from sibling Python modules. Before the project-level resolver, these were reported as unresolved; the final scan discovers all 21 observed `@app` and `@router` HTTP decorators with no parser diagnostics. A manually inspected `request<Profile>('/api/me')` call goes through a custom request module that builds an absolute URL from runtime origin state. ContractWatch does not trace it, so zero matches here reflects frontend coverage limits, not backend incompatibility. Five raw or dynamic frontend fetches remain informational.

Both scans avoided `.test` and `.spec` source files, build output, virtual environments, and `node_modules`. Files under directories named `test` may still be scanned; this can be narrowed with `.contractwatchignore`. No target project files were modified or executed.
