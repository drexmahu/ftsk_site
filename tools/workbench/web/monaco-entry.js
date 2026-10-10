import * as monaco from "monaco-editor";
import { conf, language } from "monaco-editor/languages/definitions/markdown/markdown.js";

const workers = { json: "json", css: "css", scss: "css", less: "css",
  html: "html", handlebars: "html", razor: "html", typescript: "ts", javascript: "ts" };
globalThis.MonacoEnvironment = {
  getWorker(_module, label) {
    return new Worker(`/workbench-editor/${workers[label] || "editor"}.worker.js`, { type: "module" });
  },
};

monaco.languages.register({ id: "hugo-markdown" });
monaco.languages.setLanguageConfiguration("hugo-markdown", conf);
monaco.languages.setMonarchTokensProvider("hugo-markdown", {
  ...language,
  tokenizer: {
    ...language.tokenizer,
    root: [
      [/^---\s*$/, { token: "meta.separator", switchTo: "@frontmatter", nextEmbedded: "yaml" }],
      [/./, { token: "@rematch", switchTo: "@body" }],
      [/^$/, { token: "@rematch", switchTo: "@body" }],
    ],
    frontmatter: [
      [/^---\s*$/, { token: "meta.separator", switchTo: "@body", nextEmbedded: "@pop" }],
      [/./, ""],
    ],
    body: [
      [/\{\{[<%].*?[%>]\}\}/, "metatag"],
      ...language.tokenizer.root,
    ],
  },
});

export { monaco };
