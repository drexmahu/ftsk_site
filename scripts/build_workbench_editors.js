"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { build } = require("esbuild");
const root = path.resolve(__dirname, "..");

build({
  absWorkingDir: root,
  entryPoints: {
    editor: "tools/workbench/web/monaco-entry.js",
    "editor.worker": "node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
    "json.worker": "node_modules/monaco-editor/esm/vs/language/json/json.worker.js",
    "css.worker": "node_modules/monaco-editor/esm/vs/language/css/css.worker.js",
    "html.worker": "node_modules/monaco-editor/esm/vs/language/html/html.worker.js",
    "ts.worker": "node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js",
  },
  outdir: ".tools/workbench-editor",
  bundle: true,
  format: "esm",
  splitting: true,
  minify: true,
  loader: { ".ttf": "file" },
  logLevel: "info",
}).then(() => {
  const hashes = Object.fromEntries(["package-lock.json", "tools/workbench/web/monaco-entry.js", "scripts/build_workbench_editors.js"].map(file =>
    [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
  fs.writeFileSync(path.join(root, ".tools/workbench-editor/version.json"), JSON.stringify(hashes));
}).catch(error => {
  console.error("Workbench editor build failed:", error.message);
  process.exitCode = 1;
});
