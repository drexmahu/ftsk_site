"use strict";

window.workbenchContentLibrary = (() => {
  const names = {
    turak: ["Trips", "Trip reports, research and expeditions.", "TR"],
    tanfolyamok: ["Courses", "Announcements, participants and course reports.", "CR"],
    pages: ["Site pages", "Homepage, section pages and other site information.", "PG"],
    tagok: ["People documents", "CVs and memorial pages linked to the people registry.", "PE"],
  };
  const normalize = value => String(value || "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu");
  function categories(catalog) {
    const ids = new Set(["turak", "tanfolyamok", ...(catalog.pages || []).map(page => page.section),
      ...(catalog.templates || []).map(template => template.section).filter(Boolean)]);
    return [...ids].map(id => {
      const pages = (catalog.pages || []).filter(page => page.section === id);
      const index = pages.find(page => page.path === `${id}/_index.md`);
      const folder = id.replaceAll("-", " ").replaceAll("_", " ");
      const fallback = folder.charAt(0).toLocaleUpperCase("hu") + folder.slice(1);
      const [label, description, icon] = names[id] || [index?.title && index.title !== "_index" ? index.title : fallback, "Pages in this content section.", "PG"];
      return {id, label, description, icon, count: pages.length, href: `#content/${encodeURIComponent(id)}`};
    }).sort((first, second) => {
      const order = id => id === "turak" ? 0 : id === "tanfolyamok" ? 1 : 2;
      return order(first.id) - order(second.id) || first.label.localeCompare(second.label, "hu");
    });
  }
  function filter(pages, {section = "", search = "", status = "", sort = "date"} = {}) {
    const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
    return pages.filter(page => (!section || page.section === section) &&
      terms.every(term => normalize(`${page.title} ${page.path} ${page.date}`).includes(term)) &&
      (!status || (status === "draft" ? page.draft : status === "attention" ? page.error : !page.draft)))
      .sort((first, second) => sort === "date" ?
        String(second.date).localeCompare(String(first.date)) || first.title.localeCompare(second.title, "hu") :
        String(first[sort]).localeCompare(String(second[sort]), "hu"));
  }
  function slug(title) {
    return normalize(title).replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function folderTrail(folder, label) {
    const parts = folder.split("/").filter(Boolean);
    return [{label, folder: ""}, ...parts.map((part, index) => ({label: part, folder: parts.slice(0, index + 1).join("/")}))];
  }
  function findTextRange(text, query, nearLine = 1) {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return null;
    const expression = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
    const folded = normalize(text), lines = text.split("\n");
    let match, line = 1, position = 0, best = null;
    while ((match = expression.exec(folded))) {
      line += folded.slice(position, match.index).split("\n").length - 1;
      position = match.index;
      const span = match[0].split("\n").length;
      if (!best || Math.abs(line - nearLine) < Math.abs(best.line - nearLine)) best = {line, span};
      if (line >= nearLine) break;
    }
    if (!best) return null;
    const start = lines.slice(0, best.line - 1).reduce((sum, value) => sum + value.length + 1, 0);
    return {start, end: start + lines.slice(best.line - 1, best.line - 1 + best.span).join("\n").length, line: best.line};
  }
  return {categories, filter, slug, folderTrail, findTextRange};
})();
