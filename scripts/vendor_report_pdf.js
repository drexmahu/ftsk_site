"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const destination = path.join(root, "static", "vendor", "report-pdf");
const manifest = require(path.join(root, "package.json"));
fs.mkdirSync(destination, { recursive: true });
for (const [name, files] of Object.entries({
  pdfmake: ["build/pdfmake.min.js", "build/pdfmake.js", "build/vfs_fonts.js", "LICENSE"],
  "html-to-pdfmake": ["browser.js", "index.js", "LICENSE"],
})) {
  const source = path.join(root, "node_modules", name);
  const version = require(path.join(source, "package.json")).version;
  if (version !== manifest.devDependencies[name]) throw new Error(`Unexpected ${name} version: ${version}`);
  for (const file of files) {
    const target = file === "LICENSE" ? `${name}-LICENSE` : name === "html-to-pdfmake" ?
      (file === "index.js" ? "html-to-pdfmake.source.js" : "html-to-pdfmake.js") : path.basename(file);
    fs.copyFileSync(path.join(source, file), path.join(destination, target));
  }
  console.log(`Vendored ${name} ${version}`);
}
