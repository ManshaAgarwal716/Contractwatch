export type Severity = "error" | "warning" | "info";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}
export interface Field {
  type: string;
  optional: boolean;
  nullable: boolean;
  fields?: Record<string, Field>;
  element?: Field;
  variants?: Field[];
  enumValues?: Array<string | number | boolean>;
}
export interface Schema {
  fields: Record<string, Field>;
  type?: string;
}
export interface Evidence {
  description: string;
  location?: SourceLocation;
}
export interface ApiContract {
  id: string;
  source: "frontend" | "backend";
  method?: HttpMethod;
  path: string;
  resolved: boolean;
  external?: boolean;
  request?: Schema;
  requestKnowledge?: "fully_known" | "partially_known" | "unknown";
  query?: Schema;
  headers?: Schema;
  urlStatus?: "static" | "partially_resolved" | "unresolved";
  response?: Schema;
  sourceLocation: SourceLocation;
  framework: string;
  confidence: number;
  evidence: Evidence[];
  context?: string;
  definition?: boolean;
}
export interface Finding {
  id: string;
  code: string;
  severity: Severity;
  confidence: number;
  category: string;
  endpoint: string;
  frontend?: SourceLocation;
  backend?: SourceLocation;
  expected: string;
  actual: string;
  explanation: string;
  remediation: string;
  evidence: Evidence[];
}
export interface Match {
  frontend: ApiContract;
  backend: ApiContract;
  confidence: number;
  reasoning: string;
}
export interface Discovery {
  files: string[];
  packageFiles: string[];
  tsconfigFiles: string[];
  frontend: string[];
  backend: string[];
  frameworks: string[];
  monorepo: boolean;
  errors: string[];
}
export interface ScanSummary {
  frontendCalls: number;
  backendEndpoints: number;
  matched: number;
  compatible: number;
  errors: number;
  warnings: number;
  info: number;
  health: number;
  durationMs: number;
}
export interface AnalyzerDiagnostic {
  code: string;
  message: string;
  location: SourceLocation;
  blocking: boolean;
}
export interface ScanReport {
  diagnostics: AnalyzerDiagnostic[];
  version: "1";
  cwd: string;
  discovery: Discovery;
  frontend: ApiContract[];
  backend: ApiContract[];
  matches: Match[];
  findings: Finding[];
  summary: ScanSummary;
}
export interface ContractWatchConfig {
  include?: string[];
  exclude?: string[];
  baseUrl?: string;
  frontend?: { framework?: "auto" };
  backend?: { framework?: "auto" };
  severity?: {
    missingEndpoint?: Severity;
    typeMismatch?: Severity;
    nullabilityMismatch?: Severity;
  };
  strictThreshold?: "error" | "warning" | "info";
}
export interface ScanOptions {
  cwd?: string;
  config?: ContractWatchConfig;
  baseBranch?: string;
}
