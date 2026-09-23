import { readFile, writeFile } from "node:fs/promises";
const keys = JSON.parse(await readFile(new URL("../public-env.json", import.meta.url), "utf8"));
if (!Array.isArray(keys) || keys.length > 50 || !keys.every(key => typeof key === "string" && /^[A-Z][A-Z0-9_]*$/.test(key))) {
  throw new Error("public-env.json must list public variable names only.");
}
const source = process.env.STUDIO_PUBLIC_ENV ? JSON.parse(process.env.STUDIO_PUBLIC_ENV) : process.env;
const values = Object.fromEntries(keys.map(key => [key, typeof source[key] === "string" ? source[key] : ""]));
// JSON encoding keeps quotes, newlines and other input as data, never source code.
const data = JSON.stringify(values).replace(/</g, "\\u003c");
await writeFile(new URL("../env.js", import.meta.url), "window.AQUA_CONFIG = Object.assign({}, window.AQUA_CONFIG, " + data + ");\n");
