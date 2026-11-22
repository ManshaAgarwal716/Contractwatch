import type { HttpMethod } from "../types.js";
export function normalizePath(input: string): string {
  let path = input.trim().replace(/^https?:\/\/[^/]+/i, "");
  path = path.split("?")[0]?.split("#")[0] ?? path;
  path = path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  return path.startsWith("/") ? path : "/" + path;
}
export function routeShape(path: string): string {
  return normalizePath(path)
    .split("/")
    .map((s) =>
      /^\{[^}]+\}$|^:[^/]+$|^\[[^\]]+\]$|^\d+$/.test(s) ? ":param" : s,
    )
    .join("/");
}
export function normalizeMethod(
  value: string | undefined,
): HttpMethod | undefined {
  const v = value?.toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(v ?? "")
    ? (v as HttpMethod)
    : undefined;
}
export function sameRoute(a: string, b: string): boolean {
  const x = normalizePath(a).split("/"),
    y = normalizePath(b).split("/");
  return (
    x.length === y.length &&
    x.every(
      (s, i) =>
        s === y[i] ||
        routeShape("/" + s) === "/:param" ||
        routeShape("/" + y[i]) === "/:param",
    )
  );
}
