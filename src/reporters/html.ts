import type { ScanReport } from "../types.js";
function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function htmlReport(r: ScanReport): string {
  const cards = r.findings
    .map(
      (f) =>
        `<details class="card ${esc(f.severity)}" data-text="${esc(`${f.code} ${f.category} ${f.endpoint} ${f.explanation}`.toLowerCase())}" data-severity="${esc(f.severity)}"><summary><strong>${esc(f.severity.toUpperCase())} ${esc(f.code)}</strong> ${esc(f.category)} <code>${esc(f.endpoint)}</code></summary><p>${esc(f.explanation)}</p><p><b>Expected:</b> ${esc(f.expected)}<br><b>Actual:</b> ${esc(f.actual)}</p><p><b>Confidence:</b> ${Math.round(f.confidence * 100)}%<br><b>Fix:</b> ${esc(f.remediation)}</p><small>${esc(f.frontend ? `${f.frontend.file}:${f.frontend.line}` : "")} ${esc(f.backend ? `${f.backend.file}:${f.backend.line}` : "")}</small><h3>Evidence</h3><ul>${f.evidence.map((e) => `<li>${esc(e.description)}${e.location ? ` — ${esc(e.location.file)}:${e.location.line}` : ""}</li>`).join("")}</ul></details>`,
    )
    .join("");
  const diagnostics = r.diagnostics
    .map(
      (d) =>
        `<li><strong>${esc(d.code)}</strong> ${esc(d.location.file)}:${d.location.line} — ${esc(d.message)}</li>`,
    )
    .join("");
  const routes = [...r.frontend, ...r.backend]
    .map(
      (c) =>
        `<tr><td>${esc(c.source)}</td><td>${esc(c.method)}</td><td><code>${esc(c.path)}</code></td><td>${esc(c.sourceLocation.file)}:${c.sourceLocation.line}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ContractWatch report</title><style>body{font:16px system-ui;background:#0d1117;color:#e6edf3;max-width:1000px;margin:40px auto;padding:0 20px}h1{margin-bottom:0}.muted,small{color:#8b949e}.stats{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.stat,.card{background:#161b22;border:1px solid #30363d;border-radius:9px;padding:16px}.stat{min-width:110px}.stat strong{display:block;font-size:28px}.card{margin:12px 0}.card.error{border-left:4px solid #f85149}.card.warning{border-left:4px solid #d29922}.card.info{border-left:4px solid #58a6ff}summary{cursor:pointer}code{color:#79c0ff}input,select{background:#161b22;color:#e6edf3;border:1px solid #30363d;padding:10px;border-radius:6px}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #30363d;padding:10px}section{margin:32px 0}</style></head><body><h1>ContractWatch</h1><p class="muted">${esc(r.cwd)}</p><div class="stats"><div class="stat"><strong>${r.summary.health}</strong>Health / 100</div><div class="stat"><strong>${r.summary.errors}</strong>Errors</div><div class="stat"><strong>${r.summary.warnings}</strong>Warnings</div><div class="stat"><strong>${r.summary.matched}</strong>Matches</div></div><section><h2>Findings</h2><input id="search" placeholder="Search findings" aria-label="Search findings"> <select id="severity" aria-label="Filter severity"><option value="">All severities</option><option>error</option><option>warning</option><option>info</option></select>${cards || "<p>No findings.</p>"}</section>${diagnostics ? `<section><h2>Analysis diagnostics</h2><ul>${diagnostics}</ul></section>` : ""}<section><h2>Discovered APIs</h2><table><thead><tr><th>Source</th><th>Method</th><th>Path</th><th>Location</th></tr></thead><tbody>${routes}</tbody></table></section><script>const q=document.querySelector('#search'),s=document.querySelector('#severity');function filter(){for(const c of document.querySelectorAll('.card'))c.hidden=!c.dataset.text.includes(q.value.toLowerCase())||!!s.value&&c.dataset.severity!==s.value}q.addEventListener('input',filter);s.addEventListener('change',filter)</script></body></html>`;
}
