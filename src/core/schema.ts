import type { Field, Schema } from "../types.js";
export function field(type: string, optional = false): Field {
  let t = type.trim().replace(/^typing\./, "");
  let nullable = /\bNone\b|\bnull\b|\bundefined\b/.test(t);
  t = t
    .replace(/\s*\|\s*(None|null|undefined)\b/g, "")
    .replace(/\b(None|null|undefined)\s*\|\s*/g, "")
    .trim();
  const opt = t.match(/^Optional\[(.*)\]$/);
  if (opt) {
    nullable = true;
    t = opt[1];
  }
  const list = t.match(/^(?:List|list|Array)\[(.+)\]$/);
  const tsArray = t.match(/^(.+)\[\]$/);
  const element = list?.[1] ?? tsArray?.[1];
  if (element)
    return { type: "array", optional, nullable, element: field(element) };
  const primitive: Record<string, string> = {
    int: "number",
    float: "number",
    str: "string",
    bool: "boolean",
    number: "number",
    string: "string",
    boolean: "boolean",
    dict: "object",
    Dict: "object",
    object: "object",
    Any: "unknown",
    any: "unknown",
  };
  return { type: primitive[t] ?? t, optional, nullable };
}
export function schema(fields: Record<string, Field>): Schema {
  return { fields };
}
export function isAssignable(source: Field, target: Field): boolean {
  if (source.type === "unknown" || target.type === "unknown") return true;
  if (source.nullable && !target.nullable) return false;
  if (source.type === "union" && source.variants)
    return source.variants.every((v) => isAssignable(v, target));
  if (target.type === "union" && target.variants)
    return target.variants.some((v) => isAssignable(source, v));
  if (source.type === "enum") {
    if (target.type === "enum")
      return (source.enumValues ?? []).every((v) =>
        (target.enumValues ?? []).includes(v),
      );
    return (source.enumValues ?? []).every((v) => typeof v === target.type);
  }
  if (source.type !== target.type) return false;
  if (source.type === "array")
    return (
      !!source.element &&
      !!target.element &&
      isAssignable(source.element, target.element)
    );
  return true;
}
export function compareType(frontend: Field, backend: Field): boolean {
  return isAssignable(
    { ...backend, nullable: false },
    { ...frontend, nullable: false },
  );
}
