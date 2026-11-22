"""Parse FastAPI source with Python's AST. Never imports or evaluates target code."""
import ast
import json
import sys


def dotted(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        left = dotted(node.value)
        return f"{left}.{node.attr}" if left else node.attr
    return ""


def literal(node):
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return None


def kw(call, name):
    return next((entry.value for entry in call.keywords if entry.arg == name), None)


def normalized_type(node, seen=None):
    seen = seen or set()
    if node is None:
        return {"type": "unknown", "optional": False, "nullable": False}
    if isinstance(node, ast.Constant):
        if node.value is None:
            return {"type": "null", "optional": False, "nullable": True}
        if isinstance(node.value, str):
            try:
                return normalized_type(ast.parse(node.value, mode="eval").body, seen)
            except SyntaxError:
                return {"type": "unknown", "optional": False, "nullable": False}
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        parts = union_parts(node)
        non_null = [part for part in parts if not (isinstance(part, ast.Constant) and part.value is None)]
        if len(non_null) == 1:
            result = normalized_type(non_null[0], seen)
            result["nullable"] = len(non_null) != len(parts)
            return result
        return {"type": "union", "optional": False, "nullable": len(non_null) != len(parts), "variants": [normalized_type(x, seen) for x in non_null]}
    if isinstance(node, ast.Subscript):
        name = dotted(node.value).split(".")[-1]
        args = list(node.slice.elts) if isinstance(node.slice, ast.Tuple) else [node.slice]
        if name == "Annotated":
            return normalized_type(args[0], seen)
        if name == "Optional":
            result = normalized_type(args[0], seen)
            result["nullable"] = True
            return result
        if name == "Union":
            non_null = [x for x in args if not (isinstance(x, ast.Constant) and x.value is None)]
            if len(non_null) == 1:
                result = normalized_type(non_null[0], seen)
                result["nullable"] = len(non_null) != len(args)
                return result
            return {"type": "union", "optional": False, "nullable": len(non_null) != len(args), "variants": [normalized_type(x, seen) for x in non_null]}
        if name in ("List", "list", "Sequence"):
            return {"type": "array", "optional": False, "nullable": False, "element": normalized_type(args[0], seen)}
        if name in ("Dict", "dict", "Mapping"):
            return {"type": "object", "optional": False, "nullable": False}
    name = dotted(node).split(".")[-1]
    primitives = {"int": "number", "float": "number", "str": "string", "bool": "boolean", "dict": "object", "Any": "unknown"}
    return {"type": primitives.get(name, name or "unknown"), "optional": False, "nullable": False}


def union_parts(node):
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return union_parts(node.left) + union_parts(node.right)
    return [node]


def parse(payload):
    source = payload["source"]
    try:
        tree = ast.parse(source, filename=payload["file"], type_comments=True)
    except SyntaxError as exc:
        return {"routes": [], "diagnostics": [{"code": "PYTHON_SYNTAX_ERROR", "message": exc.msg, "line": exc.lineno or 1, "column": exc.offset or 1}]}
    classes = {}
    enums = {}
    imports = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module is not None:
            for item in node.names:
                imports[item.asname or item.name] = {"module": node.module, "level": node.level, "name": item.name}
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            bases = [dotted(base).split(".")[-1] for base in node.bases]
            classes[node.name] = (node, bases)
            if "Enum" in bases or "StrEnum" in bases:
                values = [literal(stmt.value) for stmt in node.body if isinstance(stmt, ast.Assign)]
                enums[node.name] = [value for value in values if isinstance(value, (str, int, float, bool))]
    def expand(spec, visiting=None):
        visiting = visiting or set()
        if spec.get("element"):
            spec = {**spec, "element": expand(spec["element"], visiting)}
        if spec.get("variants"):
            spec = {**spec, "variants": [expand(part, visiting) for part in spec["variants"]]}
        name = spec["type"]
        if name in enums:
            return {**spec, "type": "enum", "enumValues": enums[name]}
        if name not in classes or name in visiting:
            return spec
        node, bases = classes[name]
        if "BaseModel" not in bases and not any(base in classes for base in bases):
            return spec
        fields = {}
        next_visiting = visiting | {name}
        for base in bases:
            if base in classes:
                inherited = expand({"type": base, "optional": False, "nullable": False}, next_visiting)
                fields.update(inherited.get("fields", {}))
        for stmt in node.body:
            target = None
            annotation = None
            default = None
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                target, annotation, default = stmt.target.id, stmt.annotation, stmt.value
            if target is None or target.startswith("_"):
                continue
            field = expand(normalized_type(annotation), next_visiting)
            field["optional"] = default is not None and literal(default) is not Ellipsis
            if isinstance(default, ast.Call) and dotted(default.func).split(".")[-1] == "Field":
                positional = default.args[0] if default.args else None
                explicit = kw(default, "default") or positional
                field["optional"] = (explicit is not None and literal(explicit) is not Ellipsis) or kw(default, "default_factory") is not None
                alias = literal(kw(default, "alias"))
                if isinstance(alias, str):
                    target = alias
            fields[target] = field
        return {**spec, "type": "object", "fields": fields}

    roots = set()
    router_prefix = {}
    includes = []
    route_nodes = []
    diagnostics = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            target = node.targets[0] if isinstance(node, ast.Assign) and node.targets else node.target if isinstance(node, ast.AnnAssign) else None
            value = node.value
            if isinstance(target, ast.Name) and isinstance(value, ast.Call):
                kind = dotted(value.func).split(".")[-1]
                if kind == "FastAPI":
                    roots.add(target.id)
                    router_prefix[target.id] = ""
                if kind == "APIRouter":
                    prefix = literal(kw(value, "prefix"))
                    if prefix is not None and not isinstance(prefix, str):
                        diagnostics.append({"code": "DYNAMIC_ROUTER_PREFIX", "message": "Router prefix is not a static string", "line": node.lineno, "column": node.col_offset + 1})
                    router_prefix[target.id] = prefix if isinstance(prefix, str) else ""
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "include_router":
            owner = dotted(node.func.value)
            child = dotted(node.args[0]) if node.args else ""
            prefix = literal(kw(node, "prefix"))
            if owner and child:
                includes.append((owner, child, prefix if isinstance(prefix, str) else "", node.lineno))
            if prefix is not None and not isinstance(prefix, str):
                diagnostics.append({"code": "DYNAMIC_ROUTER_PREFIX", "message": "Included router prefix is not static", "line": node.lineno, "column": node.col_offset + 1})
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
                    owner, method = dotted(decorator.func.value), decorator.func.attr.upper()
                    if owner not in router_prefix or method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "API_ROUTE"):
                        continue
                    route = literal(decorator.args[0]) if decorator.args else literal(kw(decorator, "path"))
                    if not isinstance(route, str):
                        diagnostics.append({"code": "DYNAMIC_ROUTE_PATH", "message": "Route path is not a static string", "line": decorator.lineno, "column": decorator.col_offset + 1})
                        continue
                    methods = [method]
                    if method == "API_ROUTE":
                        raw = literal(kw(decorator, "methods"))
                        methods = [m.upper() for m in raw] if isinstance(raw, (list, tuple, set)) and all(isinstance(m, str) for m in raw) else []
                    response_node = kw(decorator, "response_model") or node.returns
                    response = expand(normalized_type(response_node)) if response_node else None
                    response = {"fields": response["fields"]} if response and response.get("fields") else None
                    request = None
                    request_name = None
                    for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
                        if arg.arg in ("self", "cls") or arg.annotation is None:
                            continue
                        candidate = expand(normalized_type(arg.annotation))
                        if candidate.get("fields"):
                            request = {"fields": candidate["fields"]}
                            request_name = dotted(arg.annotation)
                        elif dotted(arg.annotation) in imports:
                            request_name = dotted(arg.annotation)
                    route_nodes.append((owner, route, methods, response, request, dotted(response_node), request_name, decorator.lineno, decorator.col_offset + 1))
    edges = {}
    for parent, child, prefix, line in includes:
        if child not in router_prefix:
            diagnostics.append({"code": "UNRESOLVED_ROUTER", "message": f"Router {child} cannot be resolved in this file", "line": line, "column": 1})
        edges.setdefault(parent, []).append((child, prefix))
    routes = []
    local_routes = [{"owner": owner, "path": route, "methods": methods, "response": response, "request": request, "responseName": response_name, "requestName": request_name, "line": line, "column": column} for owner, route, methods, response, request, response_name, request_name, line, column in route_nodes]
    for owner, route, methods, response, request, response_name, request_name, line, column in route_nodes:
        prefixes = []
        def descend(current, prefix, visiting):
            if current == owner:
                prefixes.append(prefix + router_prefix.get(owner, ""))
            if current in visiting:
                return
            for child, extra in edges.get(current, []):
                if child in router_prefix:
                    descend(child, prefix + router_prefix.get(current, "") + extra, visiting | {current})
        for root in roots:
            descend(root, "", set())
        if owner in roots and not prefixes:
            prefixes = [""]
        if not prefixes:
            diagnostics.append({"code": "UNMOUNTED_ROUTER", "message": f"Route on {owner} has no resolvable application mount", "line": line, "column": column})
            continue
        for prefix in sorted(set(prefixes)):
            for method in methods:
                if method in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                    routes.append({"method": method, "path": prefix + route, "response": response, "request": request, "line": line, "column": column})
    models = {}
    for name in classes:
        expanded = expand({"type": name, "optional": False, "nullable": False})
        if expanded.get("fields"):
            models[name] = {"fields": expanded["fields"]}
    return {"routes": routes, "diagnostics": diagnostics, "roots": sorted(roots), "routerPrefixes": router_prefix, "includes": [{"owner": parent, "child": child, "prefix": prefix, "line": line} for parent, child, prefix, line in includes], "imports": imports, "localRoutes": local_routes, "models": models}


try:
    payload = json.load(sys.stdin)
    print(json.dumps(parse(payload), separators=(",", ":")))
except Exception as exc:
    print(json.dumps({"routes": [], "diagnostics": [{"code": "PYTHON_ANALYZER_ERROR", "message": str(exc), "line": 1, "column": 1}]}))
