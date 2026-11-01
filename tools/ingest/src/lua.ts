// Converts the data tables in wiki Lua modules into plain JSON.
import luaparse from "luaparse";

type Node = any;

function unquote(raw: string): string {
  if (raw.startsWith("[[")) return raw.slice(2, -2);
  const body = raw.slice(1, -1);
  return body.replace(/\\(r|n|t|"|'|\\)/g, (_, c) => ({ r: "\r", n: "\n", t: "\t", '"': '"', "'": "'", "\\": "\\" })[c as string]!);
}

function value(n: Node): unknown {
  switch (n.type) {
    case "StringLiteral":
      return unquote(n.raw);
    case "NumericLiteral":
      return n.value;
    case "BooleanLiteral":
      return n.value;
    case "NilLiteral":
      return null;
    case "UnaryExpression":
      return n.operator === "-" && n.argument.type === "NumericLiteral" ? -n.argument.value : null;
    case "TableConstructorExpression":
      return table(n);
    default:
      return null;
  }
}

function table(n: Node): unknown {
  const arr: unknown[] = [];
  const obj: Record<string, unknown> = {};
  let hasKeys = false;
  for (const f of n.fields) {
    if (f.type === "TableValue") arr.push(value(f.value));
    else if (f.type === "TableKeyString") {
      obj[f.key.name] = value(f.value);
      hasKeys = true;
    } else if (f.type === "TableKey") {
      const k = value(f.key);
      obj[String(k)] = value(f.value);
      hasKeys = true;
    }
  }
  if (!hasKeys) return arr;
  if (arr.length) obj["__array"] = arr;
  return obj;
}

/** Find a table assigned to `local <name> = {...}`, or the module's returned table. */
export function luaTable(source: string, localName?: string): any {
  const ast = luaparse.parse(source, { comments: false, luaVersion: "5.1" });
  for (const st of ast.body) {
    if (localName && st.type === "LocalStatement" && st.variables[0]?.name === localName && st.init[0]?.type === "TableConstructorExpression") {
      return table(st.init[0]);
    }
    if (!localName && st.type === "ReturnStatement" && st.arguments[0]?.type === "TableConstructorExpression") {
      return table(st.arguments[0]);
    }
  }
  throw new Error(`table ${localName ?? "(return)"} not found`);
}
