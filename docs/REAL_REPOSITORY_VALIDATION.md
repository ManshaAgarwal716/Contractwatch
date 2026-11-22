# Read-only repository validation

ContractWatch was run against a local Next.js and Express repository in read-only mode. No source files in that repository were modified or executed.

- Files analyzed: 147
- Frameworks detected: Next.js, Express
- Frontend calls discovered: 2
- Backend routes discovered: 33
- Matched contracts: 1
- Analyzer diagnostics after `.js`-to-`.ts` import resolution: 0
- Informational unmatched backend routes: 32
- Informational dynamic frontend URL: 1

An earlier scan reported 32 unresolved or unmounted router diagnostics because the repository's TypeScript source imported sibling routers with `.js` suffixes. Static source resolution was corrected and covered by a regression test. The current scan showed no definite errors. Most frontend requests in that repository use a custom wrapper; ContractWatch does not yet trace that wrapper, so the 32 unmatched routes are not evidence of unused APIs. This validation is an integration observation, not proof of complete coverage.
