"use strict";

// Pure helpers for media pages. They never touch the DOM so tests can load this file on its own.
window.workbenchMediaModel = (() => {
  const LAYOUTS = [
    ["reel", "Reel", "One scrolling row; every photo keeps its own shape"],
    ["rows", "Rows", "Justified rows that fill the page width"],
    ["grid", "Grid", "Equal cards in columns"],
    ["showcase", "Showcase", "One large player with a playlist"],
  ];
  const RANGES = { height: [120, 900], height_mobile: [100, 700], columns: [1, 6], columns_mobile: [1, 3], gap: [0, 48] };
  const clone = value => JSON.parse(JSON.stringify(value));
  const fold = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu");

  function youtubeId(text) {
    const value = String(text ?? "").trim();
    const match = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/i.exec(value);
    if (match) return match[1];
    return /^[A-Za-z0-9_-]{11}$/.test(value) ? value : "";
  }

  // Same rules as the site: "3:2", "16:9" or a decimal; 0 when empty or invalid.
  function parseRatio(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return 0;
    const text = String(value).trim();
    let ratio = 0;
    const pair = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(text);
    if (pair && Number(pair[2]) > 0) ratio = Number(pair[1]) / Number(pair[2]);
    else if (/^\d+(?:\.\d+)?$/.test(text)) ratio = Number(text);
    return ratio > 0 ? Math.min(5, Math.max(0.2, ratio)) : 0;
  }

  function sentenceCount(text) {
    const plain = String(text ?? "").replace(/[*_`>#[\]()]/g, "");
    return plain.trim().split(/(?<=[.!?…])\s+/).filter(part => /[\p{L}\p{N}]/u.test(part)).length;
  }

  function slugify(text) {
    return fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function uniqueId(base, taken) {
    const root = base || "section";
    let id = root, number = 2;
    while (taken.includes(id)) id = `${root}-${number++}`;
    return id;
  }

  // Classifies what an editor typed into the video field.
  function videoSource(text) {
    const raw = String(text ?? "").trim();
    if (!raw) return { kind: "", value: "", message: "" };
    const id = youtubeId(raw);
    if (id) return { kind: "youtube", id, value: `https://www.youtube.com/watch?v=${id}`, message: "" };
    if (/^(?:\/(?!\/)|https?:\/\/)\S+$/i.test(raw)) {
      if (/\.(?:mp4|m4v|webm|ogv|mov)$/i.test(raw.split(/[?#]/)[0])) return { kind: "file", value: raw, message: "" };
      return { kind: "", value: raw, message: "Video files must be MP4, WebM, OGV or MOV. Other video sites are not supported." };
    }
    return { kind: "", value: raw, message: "Paste a YouTube link, or a video file such as /videos/clip.mp4." };
  }

  function newSection(layout = "reel") {
    return { layout, items: [] };
  }

  function newPhoto(src) {
    return { type: "photo", src };
  }

  function newVideo(source) {
    return { type: "video", video: source };
  }

  // Moves an item and returns where it landed. Positions are indexes after removal.
  function moveItem(sections, from, to) {
    const [item] = sections[from.s].items.splice(from.i, 1);
    sections[to.s].items = sections[to.s].items || [];
    const target = sections[to.s].items;
    const index = Math.max(0, Math.min(to.i, target.length));
    target.splice(index, 0, item);
    return { s: to.s, i: index };
  }

  function moveSection(sections, from, to) {
    const index = Math.max(0, Math.min(to, sections.length - 1));
    const [section] = sections.splice(from, 1);
    sections.splice(index, 0, section);
    return index;
  }

  // Index to pass to moveItem when dropping next to the tile at `index` of section `s`.
  function dropIndex(from, s, index, after) {
    let target = index + (after ? 1 : 0);
    if (from.s === s && from.i < target) target -= 1;
    return target;
  }

  function itemIssues(item) {
    const issues = [];
    const video = item.type === "video";
    const sentences = sentenceCount(item.text);
    if (!sentences) issues.push("Add a short description (3–4 sentences).");
    else if (sentences > 4) issues.push("The description is longer than 4 sentences.");
    if (!String(item.credit ?? "").trim()) issues.push(video ? "Add the author's name." : "Add the photographer's name.");
    if (!video && !String(item.alt || item.title || "").trim()) issues.push("Add alt text or a title for screen readers.");
    return issues;
  }

  function sectionStats(section) {
    const items = Array.isArray(section?.items) ? section.items : [];
    return {
      photos: items.filter(item => item.type !== "video").length,
      videos: items.filter(item => item.type === "video").length,
      attention: items.filter(item => itemIssues(item).length).length,
    };
  }

  function setOrDelete(target, key, value) {
    if (value === "" || value === null || value === undefined || Number.isNaN(value)) delete target[key];
    else target[key] = value;
  }

  function clamp(value, key) {
    const [low, high] = RANGES[key];
    return Math.min(high, Math.max(low, Math.round(value)));
  }

  function idProblem(sections, index, value) {
    if (!value) return "";
    if (!/^[\w-]{1,80}$/.test(value)) return "Use letters, numbers, - and _ only.";
    return sections.some((section, other) => other !== index && section.id === value) ? "Another section already uses this link name." : "";
  }

  // Finds where text lives so a site-wide search result can open the right field.
  function findText(meta, query) {
    const needle = fold(query);
    if (!needle) return null;
    const has = value => typeof value === "string" && fold(value).includes(needle);
    for (const field of ["title", "description"]) if (has(meta[field])) return { kind: "page", field };
    const sections = Array.isArray(meta.media_sections) ? meta.media_sections : [];
    for (const [s, section] of sections.entries()) {
      for (const field of ["title", "subtitle"]) if (has(section?.[field])) return { kind: "section", field, s };
      for (const [i, item] of (Array.isArray(section?.items) ? section.items : []).entries()) {
        for (const field of ["title", "credit", "text", "alt", "video", "src"]) if (has(item?.[field])) return { kind: "item", field, s, i };
      }
    }
    return null;
  }

  return { LAYOUTS, RANGES, clone, fold, youtubeId, parseRatio, sentenceCount, slugify, uniqueId, videoSource, newSection,
    newPhoto, newVideo, moveItem, moveSection, dropIndex, itemIssues, sectionStats, setOrDelete, clamp, idProblem, findText };
})();

// The Galleries panel of the page editor. The host (content.js) owns saving, previews and the
// image library; this module only edits `media_sections` and a few page-level fields.
window.workbenchMediaEditor = (() => {
  const Model = window.workbenchMediaModel;
  const ui = { path: "", section: 0, item: -1, video: -1, undo: null, pageOpen: null, look: new Set(), drag: null, host: null };
  const LABELS = { reel: "photo reel", rows: "justified rows", grid: "grid", showcase: "video showcase" };
  const RATIO_PRESETS = ["16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"];
  const PAGE_WIDTHS = [["contained", "Standard", "Comfortable reading width"], ["wide", "Wide", "Roomier galleries"], ["full", "Full width", "Edge to edge"]];

  const sections = host => (Array.isArray(host.meta().media_sections) ? host.meta().media_sections : []);

  function el(tag, className = "", text = "", attributes = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    for (const [name, value] of Object.entries(attributes)) {
      if (value === false || value === undefined || value === null) continue;
      element.setAttribute(name, value === true ? "" : value);
    }
    return element;
  }

  function button(label, handler, { secondary = true, className = "", title = "", disabled = false, aria } = {}) {
    const control = el("button", `${secondary ? "secondary " : ""}${className}`.trim(), label, { type: "button", title, "aria-label": aria });
    control.disabled = disabled;
    control.addEventListener("click", event => { event.stopPropagation(); handler(event); });
    return control;
  }

  // Works on a fresh copy so a picker callback opened earlier can never write stale data.
  function edit(host, mutate, { draw = true, undo = "" } = {}) {
    const next = Model.clone(sections(host));
    const before = undo ? Model.clone(sections(host)) : null;
    const result = mutate(next);
    host.change("media_sections", next);
    if (undo) ui.undo = { label: undo, sections: before };
    if (draw) render(host);
    return result;
  }

  function reveal(selector) {
    requestAnimationFrame(() => {
      const target = $(`#gallery-editor ${selector}`);
      if (target) target.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }

  // The workbench never loads remote images (its CSP forbids it), so YouTube videos get a labelled placeholder.
  function thumbnail(item) {
    if (item.type !== "video") return item.src || "";
    return typeof item.poster === "string" && item.poster.startsWith("/") ? item.poster : "";
  }

  function videoKind(item) {
    return Model.videoSource(item.video || item.src).kind === "youtube" ? "YouTube" : "Video file";
  }

  function image(url, alt = "", className = "") {
    // Files replaced in place keep their address, so they carry a stamp to bypass the browser cache.
    return el("img", className, "", { src: ui.host?.stamp ? ui.host.stamp(url) : url, alt, loading: "lazy", decoding: "async" });
  }

  // Opens a local photo in the shared photo editor, where it can be cropped, rotated, toned,
  // then saved as a copy or replaced in place.
  function editButton(host, title, url, assign, label = "Edit photo…") {
    const supported = typeof url === "string" && url.startsWith("/images/") && window.workbenchImages?.supports(url);
    return button(label, () => host.edit(title, url, assign), {
      secondary: false, disabled: !supported,
      title: supported ? "Crop, rotate and adjust, then save a copy or replace the original" : "Only local JPG, PNG and WebP photos can be edited" });
  }

  /* ---------- page settings ---------- */

  function textField(label, value, onInput, { rows = 0, placeholder = "", hint = "", field = "", list = "", type = "text" } = {}) {
    const wrapper = el("label", "gallery-field");
    wrapper.append(el("span", "gallery-field-label", label));
    const input = rows ? el("textarea", "", "", { rows }) : el("input", "", "", { type, list });
    input.value = value ?? "";
    if (placeholder) input.placeholder = placeholder;
    if (field) input.dataset.field = field;
    input.addEventListener("input", () => onInput(input.value, input));
    wrapper.append(input);
    if (hint) wrapper.append(el("small", "hint", hint));
    return wrapper;
  }

  function checkField(label, checked, onChange, hint = "") {
    const wrapper = el("label", "gallery-check");
    const input = el("input", "", "", { type: "checkbox" });
    input.checked = Boolean(checked);
    input.addEventListener("change", () => onChange(input.checked));
    const text = el("span");
    text.append(el("strong", "", label));
    if (hint) text.append(el("small", "hint", hint));
    wrapper.append(input, text);
    return wrapper;
  }

  function segmented(label, options, value, onPick) {
    const group = el("div", "gallery-segmented", "", { role: "radiogroup", "aria-label": label });
    for (const [id, title, hint] of options) {
      const choice = el("button", "", "", { type: "button", role: "radio", "aria-checked": String(id === value), title: hint });
      choice.append(el("strong", "", title));
      choice.addEventListener("click", () => {
        for (const sibling of group.children) sibling.setAttribute("aria-checked", String(sibling === choice));
        onPick(id);
      });
      group.append(choice);
    }
    return group;
  }

  function pageCard(host, list) {
    const meta = host.meta();
    const empty = !list.some(section => section.items?.length);
    const card = el("details", "gallery-page panel");
    card.open = ui.pageOpen ?? empty;
    card.addEventListener("toggle", () => { ui.pageOpen = card.open; });
    const summary = el("summary");
    summary.append(el("strong", "", "Page settings"), el("span", "hint", "Title, intro, menu position, width and cover"));
    card.append(summary);
    const grid = el("div", "gallery-grid");
    grid.append(
      textField("Page title", meta.title, value => host.change("title", value), { field: "title" }),
      textField("Intro line under the title", meta.description, value => host.change("description", value || null),
        { rows: 2, field: "description", hint: "A sentence or two shown in the page header and in the Média overview." }),
    );
    const width = el("div", "gallery-field");
    width.append(el("span", "gallery-field-label", "Page width"),
      segmented("Page width", PAGE_WIDTHS, meta.media_page?.width || "contained", value => host.change("media_page.width", value)));
    const credit = textField("Credit label", meta.media_page?.credit_label, value => host.change("media_page.credit_label", value || null),
      { placeholder: "Fotó / Videó", hint: "Shown before the name, for example “Fotó: Name”. Blank uses Fotó or Videó." });
    const order = textField("Menu position", meta.weight, value => host.change("weight", value === "" ? null : Math.round(Number(value))),
      { type: "number", hint: "Smaller numbers come first in the Média menu." });
    order.querySelector("input").step = "1";
    grid.append(width, credit, order,
      checkField("Hide from the Média menu", meta.hide_from_menu, value => host.change("hide_from_menu", value),
        "The page stays reachable by its address."),
      checkField("Draft — not published", meta.draft, value => host.change("draft", value),
        "Drafts are left out of the live site."));
    const cover = el("div", "gallery-field gallery-cover");
    cover.append(el("span", "gallery-field-label", "Overview cover (optional)"));
    const coverUrl = meta.thumbImg?.image_path || "";
    const row = el("div", "gallery-cover-row");
    if (coverUrl) row.append(image(coverUrl, "Current cover", "gallery-cover-image"));
    const actions = el("div", "gallery-actions");
    actions.append(button(coverUrl ? "Change cover…" : "Choose cover…", () =>
      host.pick("Media overview cover", coverUrl, url => host.change("thumbImg.image_path", url))));
    if (coverUrl) actions.append(editButton(host, "Media overview cover", coverUrl, url => host.change("thumbImg.image_path", url), "Edit…"),
      button("Remove", () => { host.change("thumbImg.image_path", ""); render(host); }));
    row.append(actions);
    cover.append(row, el("small", "hint", coverUrl || "Without a cover, the overview uses the first photo of the page."));
    grid.append(cover);
    card.append(grid);
    return card;
  }

  /* ---------- section cards ---------- */

  function rangeField(host, si, section, key, label, defaults, step = 1) {
    const [low, high] = Model.RANGES[key];
    const fallback = defaults[key];
    const wrapper = el("div", "gallery-range");
    const head = el("label", "gallery-field");
    head.append(el("span", "gallery-field-label", label));
    const slider = el("input", "", "", { type: "range", min: low, max: high, step, "aria-label": label });
    const number = el("input", "", "", { type: "number", min: low, max: high, step, "aria-label": `${label} — exact value` });
    const value = section[key];
    slider.value = value ?? fallback;
    number.value = value ?? "";
    number.placeholder = `${fallback} (default)`;
    const apply = raw => {
      if (raw === "") {
        edit(host, next => Model.setOrDelete(next[si], key, undefined), { draw: false });
        slider.value = fallback;
        return;
      }
      const clamped = Model.clamp(Number(raw), key);
      edit(host, next => { next[si][key] = clamped; }, { draw: false });
      slider.value = clamped;
    };
    slider.addEventListener("input", () => { number.value = slider.value; apply(slider.value); });
    number.addEventListener("input", () => {
      const typed = Number(number.value);
      if (number.value === "" || (Number.isFinite(typed) && typed >= low && typed <= high)) apply(number.value);
    });
    number.addEventListener("change", () => {
      if (number.value === "") return;
      number.value = String(Model.clamp(Number(number.value), key));
      apply(number.value);
    });
    head.append(slider);
    wrapper.append(head, number);
    return wrapper;
  }

  function selectField(label, options, value, onChange, hint = "") {
    const wrapper = el("label", "gallery-field");
    wrapper.append(el("span", "gallery-field-label", label));
    const select = el("select");
    for (const [id, title] of options) {
      const option = el("option", "", title, { value: id });
      option.selected = id === value;
      select.append(option);
    }
    select.addEventListener("change", () => onChange(select.value));
    wrapper.append(select);
    if (hint) wrapper.append(el("small", "hint", hint));
    return wrapper;
  }

  function lookFields(host, si, section) {
    const layout = section.layout || "reel";
    const stats = Model.sectionStats(section);
    const mostlyVideo = stats.videos * 2 > stats.photos + stats.videos;
    const defaults = { height: mostlyVideo ? 300 : 360, height_mobile: 240, columns: 3, columns_mobile: mostlyVideo ? 1 : 2, gap: 14 };
    const grid = el("div", "gallery-look-grid");
    if (layout === "reel" || layout === "rows") {
      grid.append(rangeField(host, si, section, "height", "Row height (px)", defaults, 10),
        rangeField(host, si, section, "height_mobile", "Row height on phones (px)", defaults, 10));
    }
    if (layout === "grid") {
      grid.append(rangeField(host, si, section, "columns", "Columns", defaults),
        rangeField(host, si, section, "columns_mobile", "Columns on phones", defaults));
      const ratio = section.ratio ?? "";
      const known = RATIO_PRESETS.includes(String(ratio));
      grid.append(selectField("Card shape", [["", "Automatic"], ...RATIO_PRESETS.map(item => [item, item]), ...(ratio && !known ? [[String(ratio), String(ratio)]] : [])],
        String(ratio), value => edit(host, next => Model.setOrDelete(next[si], "ratio", value), { draw: false }),
        "Width : height of every card."));
    }
    if (layout !== "showcase") {
      grid.append(selectField("Captions", [["", "Automatic"], ["none", "None"], ["hover", "On hover"], ["below", "Below the picture"]],
        section.caption ?? "", value => edit(host, next => Model.setOrDelete(next[si], "caption", value), { draw: false }),
        "Title and credit shown on each card."));
    }
    grid.append(rangeField(host, si, section, "gap", "Space between items (px)", defaults));
    if (layout === "showcase") grid.append(el("p", "hint gallery-showcase-note",
      "The first item plays in the large player. The others form the playlist beside it."));
    const link = textField("Link name (advanced)", section.id, (value, input) => {
      const problem = Model.idProblem(sections(host), si, value.trim());
      input.setCustomValidity(problem);
      input.closest("label").querySelector(".gallery-problem")?.remove();
      if (problem) input.closest("label").append(el("small", "gallery-problem", problem));
      else edit(host, next => Model.setOrDelete(next[si], "id", value.trim()), { draw: false });
    }, { hint: "Part of the address when someone shares a photo (…/#link-name-3). Changing it breaks older shared links." });
    grid.append(link);
    return grid;
  }

  function sectionCard(host, list, section, si) {
    const card = el("article", `gallery-section panel${ui.section === si ? " is-active" : ""}`, "", { "data-section": si });
    const head = el("header", "gallery-section-head");
    const title = el("input", "gallery-section-title", "", { type: "text", "aria-label": `Section ${si + 1} title`, placeholder: "Section title, shown centered above the photos" });
    title.value = section.title ?? "";
    title.dataset.field = "section-title";
    title.addEventListener("input", () => {
      edit(host, next => Model.setOrDelete(next[si], "title", title.value), { draw: false });
      stats();
    });
    title.addEventListener("change", () => {
      if (!sections(host)[si]?.id && title.value.trim()) {
        const taken = sections(host).map(other => other.id).filter(Boolean);
        edit(host, next => { next[si].id = Model.uniqueId(Model.slugify(title.value), taken); }, { draw: false });
      }
    });
    title.addEventListener("focus", () => { ui.section = si; });
    const tools = el("div", "gallery-section-tools");
    tools.append(
      button("↑", () => edit(host, next => { ui.section = Model.moveSection(next, si, si - 1); }), { disabled: si === 0, aria: "Move section up", title: "Move section up" }),
      button("↓", () => edit(host, next => { ui.section = Model.moveSection(next, si, si + 1); }), { disabled: si === list.length - 1, aria: "Move section down", title: "Move section down" }),
      button("Remove section", () => {
        edit(host, next => { next.splice(si, 1); ui.section = Math.max(0, Math.min(ui.section, next.length - 1)); ui.item = -1; },
          { undo: `Removed section “${section.title || `Section ${si + 1}`}”` });
      }, { className: "danger-quiet" }));
    head.append(title, tools);

    const layouts = Model.LAYOUTS.map(([id, label, hint]) => [id, label, hint]);
    const picker = segmented(`Layout of section ${si + 1}`, layouts, section.layout || "reel", value => {
      edit(host, next => { next[si].layout = value; });
    });
    const subtitle = textField("Subtitle (optional)", section.subtitle, value => edit(host, next => Model.setOrDelete(next[si], "subtitle", value), { draw: false }),
      { placeholder: "A short line under the title" });
    const summary = el("p", "gallery-stats hint", "", { role: "status" });
    const stats = () => {
      const current = sections(host)[si] || section;
      const { photos, videos, attention } = Model.sectionStats(current);
      const parts = [];
      if (photos) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
      if (videos) parts.push(`${videos} video${videos === 1 ? "" : "s"}`);
      summary.textContent = `${parts.join(" · ") || "No items yet"}${attention ? ` · ${attention} need${attention === 1 ? "s" : ""} details` : parts.length ? " · all described" : ""}`;
      summary.classList.toggle("needs-attention", attention > 0);
    };
    stats();

    const look = el("details", "gallery-look");
    look.open = ui.look.has(si);
    look.addEventListener("toggle", () => { ui.look[look.open ? "add" : "delete"](si); });
    look.append(el("summary", "", `Look & sizes — ${LABELS[section.layout || "reel"]}`), lookFields(host, si, section));

    const strip = el("div", "gallery-strip", "", { role: "group", "aria-label": `Items of section ${si + 1}. Drag to reorder; Alt plus arrow keys also moves the selected item.` });
    const items = Array.isArray(section.items) ? section.items : [];
    items.forEach((item, ii) => strip.append(tile(host, list, item, si, ii, stats)));
    strip.append(addTile(host, si));
    wireDrop(host, strip, si);

    card.append(head);
    const body = el("div", "gallery-section-body");
    card.append(body);
    body.append(picker, subtitle, summary, look, strip);
    if (ui.section === si && ui.item >= 0 && items[ui.item]) body.append(inspector(host, list, si, ui.item, stats));
    if (ui.video === si) body.append(videoForm(host, si));
    body.append(footer(host, si));
    return card;
  }

  function tile(host, list, item, si, ii, stats) {
    const selected = ui.section === si && ui.item === ii;
    const video = item.type === "video";
    const control = el("button", `gallery-tile${selected ? " is-selected" : ""}${video ? " is-video" : ""}`, "", {
      type: "button", draggable: "true", "aria-pressed": String(selected), "data-i": ii,
      "aria-label": `${video ? "Video" : "Photo"} ${ii + 1}: ${item.title || (item.src || item.video || "untitled").split("/").pop()}`,
    });
    const ratio = Model.parseRatio(item.ratio) || (video ? 16 / 9 : 1.5);
    control.style.setProperty("--r", ratio);
    const url = thumbnail(item);
    if (url) {
      const picture = image(url, "");
      picture.addEventListener("load", () => { if (!video && picture.naturalHeight) control.style.setProperty("--r", picture.naturalWidth / picture.naturalHeight); });
      picture.addEventListener("error", () => { picture.remove(); control.classList.add("no-image"); });
      control.append(picture);
    } else control.classList.add("no-image");
    if (video && !url) control.append(el("span", "gallery-tile-kind", videoKind(item)));
    control.append(el("span", "gallery-tile-number", String(ii + 1)));
    if (video) control.append(el("span", "gallery-tile-play", "▶", { "aria-hidden": "true" }));
    const issues = Model.itemIssues(item);
    if (issues.length) {
      control.append(el("span", "gallery-tile-flag", "!", { "aria-hidden": "true" }));
      control.title = issues.join("\n");
    }
    control.addEventListener("click", () => {
      ui.section = si;
      ui.item = selected ? -1 : ii;
      render(host);
      if (!selected) reveal(`[data-section="${si}"] .gallery-inspector`);
    });
    control.addEventListener("keydown", event => {
      if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const to = ii + (event.key === "ArrowLeft" ? -1 : 1);
      if (to < 0 || to >= (sections(host)[si]?.items?.length || 0)) return;
      edit(host, next => Model.moveItem(next, { s: si, i: ii }, { s: si, i: to }), { draw: false });
      ui.section = si; ui.item = to;
      render(host);
      $(`#gallery-editor [data-section="${si}"] .gallery-tile[data-i="${to}"]`)?.focus();
    });
    control.addEventListener("dragstart", event => {
      ui.drag = { s: si, i: ii };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-ftsk-media", JSON.stringify(ui.drag));
      control.classList.add("is-dragging");
    });
    control.addEventListener("dragend", () => {
      ui.drag = null;
      control.classList.remove("is-dragging");
      document.querySelectorAll("#gallery-editor .drop-before, #gallery-editor .drop-after").forEach(node => node.classList.remove("drop-before", "drop-after"));
    });
    return control;
  }

  function addTile(host, si) {
    const control = el("button", "gallery-add-tile", "", { type: "button", "aria-label": "Upload photos to this section" });
    control.append(el("strong", "", "+"), el("span", "", "Add photos"));
    control.addEventListener("click", () => chooseFiles(host, si));
    return control;
  }

  function wireDrop(host, strip, si) {
    const clear = () => strip.querySelectorAll(".drop-before, .drop-after").forEach(node => node.classList.remove("drop-before", "drop-after"));
    strip.addEventListener("dragover", event => {
      const files = event.dataTransfer.types.includes("Files");
      if (!ui.drag && !files) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = files ? "copy" : "move";
      clear();
      const target = event.target.closest(".gallery-tile");
      if (!target || !ui.drag) { strip.classList.toggle("is-file-target", files); return; }
      const box = target.getBoundingClientRect();
      target.classList.add(event.clientX > box.left + box.width / 2 ? "drop-after" : "drop-before");
    });
    strip.addEventListener("dragleave", event => {
      if (!strip.contains(event.relatedTarget)) { clear(); strip.classList.remove("is-file-target"); }
    });
    strip.addEventListener("drop", event => {
      event.preventDefault();
      clear();
      strip.classList.remove("is-file-target");
      if (!ui.drag && event.dataTransfer.files.length) {
        const files = [...event.dataTransfer.files].filter(file => /^image\//.test(file.type) || /\.(?:jpe?g|png|webp|heic|heif)$/i.test(file.name));
        if (files.length) uploadPhotos(host, si, files);
        else host.notify("Drop photos (JPG, PNG, WebP or HEIC). Videos are added with “Add video”.", "error");
        return;
      }
      const from = ui.drag;
      if (!from) return;
      const items = sections(host)[si]?.items || [];
      const target = event.target.closest(".gallery-tile");
      let index = items.length;
      if (target) {
        const box = target.getBoundingClientRect();
        index = Model.dropIndex(from, si, Number(target.dataset.i), event.clientX > box.left + box.width / 2);
      } else if (from.s === si) index = items.length - 1;
      ui.drag = null;
      const landed = edit(host, next => Model.moveItem(next, from, { s: si, i: index }), { draw: false });
      ui.section = landed.s; ui.item = landed.i;
      render(host);
    });
  }

  /* ---------- inspector ---------- */

  function inspector(host, list, si, ii, stats) {
    const item = list[si].items[ii];
    const video = item.type === "video";
    const box = el("section", "gallery-inspector", "", { "aria-label": `${video ? "Video" : "Photo"} ${ii + 1} details` });
    const preview = el("div", "gallery-preview");
    const url = thumbnail(item);
    const frame = el("div", "gallery-preview-frame");
    frame.style.setProperty("--r", Model.parseRatio(item.ratio) || (video ? 16 / 9 : 1.5));
    if (url) frame.append(image(url, ""));
    else frame.append(el("span", "hint", video ? `${videoKind(item)} · no cover image` : "No photo"));
    if (video) frame.append(el("span", "gallery-tile-play", "▶", { "aria-hidden": "true" }));
    preview.append(frame);
    const refresh = () => {
      const now = sections(host)[si]?.items?.[ii];
      if (!now) return;
      stats();
      const tileNode = $(`#gallery-editor [data-section="${si}"] .gallery-tile[data-i="${ii}"]`);
      const issues = Model.itemIssues(now);
      if (tileNode) {
        tileNode.title = issues.join("\n");
        tileNode.querySelector(".gallery-tile-flag")?.remove();
        if (issues.length) tileNode.append(el("span", "gallery-tile-flag", "!", { "aria-hidden": "true" }));
      }
      checklist.replaceChildren(...issues.map(issue => el("li", "", issue)));
      checklist.hidden = !issues.length;
    };
    const checklist = el("ul", "gallery-checklist");
    const set = (key, value, redraw = false) => {
      edit(host, next => Model.setOrDelete(next[si].items[ii], key, value), { draw: redraw });
      if (!redraw) refresh();
    };

    const source = el("div", "gallery-source");
    if (video) source.append(videoSourceField(host, si, ii, item, set));
    else {
      source.append(el("code", "gallery-path", item.src || ""));
      const row = el("div", "gallery-actions");
      row.append(editButton(host, `Photo ${ii + 1}`, item.src, picked => {
        edit(host, next => { next[si].items[ii].src = picked; }, { draw: false });
      }), button("Replace photo…", () => host.pick(`Photo ${ii + 1}`, item.src, picked => {
        edit(host, next => { next[si].items[ii].src = picked; }, { draw: false });
      })));
      source.append(row);
    }
    preview.append(source);

    const fields = el("div", "gallery-item-fields");
    fields.append(
      textField("Title", item.title, value => { set("title", value); tileLabel(si, ii, value); }, { field: "item-title", placeholder: "Shown on the card and above the text" }),
      textField(video ? "Author" : "Photographer", item.credit, value => set("credit", value),
        { field: "item-credit", list: "gallery-credits", placeholder: "Name shown under the title" }));
    const description = textField("Description", item.text, (value, input) => { set("text", value); counter(input, value); },
      { rows: 5, field: "item-text", hint: "" });
    const note = el("small", "gallery-counter hint");
    description.append(note);
    const counter = (input, value) => {
      const count = Model.sentenceCount(value);
      note.textContent = count ? `${count} sentence${count === 1 ? "" : "s"} · aim for 3–4` : "Aim for 3–4 sentences. Markdown works: **bold**, *italic*, [link](https://…).";
      note.classList.toggle("needs-attention", count > 4);
    };
    counter(null, item.text);
    fields.append(description);
    if (!video) {
      fields.append(textField("Alt text (for screen readers)", item.alt, value => set("alt", value), { field: "item-alt",
        hint: "Optional: describes the picture. Blank uses the title." }));
    } else {
      fields.append(selectField("Video shape", [["", "Wide 16:9 (default)"], ...RATIO_PRESETS.filter(value => value !== "16:9").map(value => [value, value])],
        String(item.ratio ?? ""), value => set("ratio", value, true), "Use 9:16 for vertical phone videos."));
      const cover = el("div", "gallery-field");
      cover.append(el("span", "gallery-field-label", "Cover image"));
      const row = el("div", "gallery-actions");
      row.append(button(item.poster ? "Change cover…" : "Choose cover…", () => host.pick("Video cover", item.poster, picked => {
        edit(host, next => { next[si].items[ii].poster = picked; }, { draw: false });
      })));
      if (item.poster) row.append(editButton(host, "Video cover", item.poster, picked => {
        edit(host, next => { next[si].items[ii].poster = picked; }, { draw: false });
      }, "Edit…"), button("Remove", () => set("poster", "", true)));
      cover.append(row, el("small", "hint", Model.videoSource(item.video || item.src).kind === "youtube"
        ? "Optional. Without one the cover comes from YouTube; a local cover avoids contacting YouTube before the visitor presses play."
        : "Recommended for video files; shown until the visitor presses play."));
      fields.append(cover);
    }
    const count = list[si].items.length;
    const actions = el("div", "gallery-item-actions");
    actions.append(
      button("← Earlier", () => moveSelected(host, si, ii, ii - 1), { disabled: ii === 0 }),
      button("Later →", () => moveSelected(host, si, ii, ii + 1), { disabled: ii === count - 1 }));
    if (list.length > 1) {
      const target = el("select", "", "", { "aria-label": "Move to another section" });
      target.append(el("option", "", "Move to section…", { value: "" }));
      list.forEach((section, other) => { if (other !== si) target.append(el("option", "", section.title || `Section ${other + 1}`, { value: other })); });
      target.addEventListener("change", () => {
        if (target.value === "") return;
        const to = Number(target.value);
        const landed = edit(host, next => Model.moveItem(next, { s: si, i: ii }, { s: to, i: (next[to].items || []).length }), { draw: false });
        ui.section = landed.s; ui.item = landed.i;
        render(host);
        reveal(`[data-section="${to}"] .gallery-inspector`);
      });
      actions.append(target);
    }
    actions.append(button("Remove", () => {
      edit(host, next => { next[si].items.splice(ii, 1); ui.item = -1; },
        { undo: `Removed ${video ? "video" : "photo"} “${item.title || (item.src || item.video || "").split("/").pop()}”` });
    }, { className: "danger-quiet" }), button("Done", () => { ui.item = -1; render(host); }));
    box.append(preview, fields, checklist, actions);
    refresh();
    return box;
  }

  function tileLabel(si, ii, value) {
    const tileNode = $(`#gallery-editor [data-section="${si}"] .gallery-tile[data-i="${ii}"]`);
    if (tileNode) tileNode.setAttribute("aria-label", `Item ${ii + 1}: ${value || "untitled"}`);
  }

  function moveSelected(host, si, from, to) {
    const landed = edit(host, next => Model.moveItem(next, { s: si, i: from }, { s: si, i: to }), { draw: false });
    ui.section = si; ui.item = landed.i;
    render(host);
  }

  function videoSourceField(host, si, ii, item, set) {
    const wrapper = el("div", "gallery-video-source");
    const check = el("a", "gallery-video-check", "Check this video on YouTube ↗", { target: "_blank", rel: "noopener noreferrer" });
    const describe = parsed => {
      status.textContent = parsed.kind === "youtube" ? `YouTube video ${parsed.id}` : parsed.kind === "file" ? "Video file" : parsed.message;
      status.className = `gallery-video-status ${parsed.kind ? "ok" : "problem"}`;
      check.hidden = parsed.kind !== "youtube";
      if (!check.hidden) check.href = parsed.value;
    };
    const field = textField("YouTube link or video file", item.video || item.src || "", (value, input) => {
      const parsed = Model.videoSource(value);
      describe(parsed);
      input.setCustomValidity(parsed.kind ? "" : parsed.message || "Add a video.");
      if (parsed.kind) {
        edit(host, next => { delete next[si].items[ii].src; next[si].items[ii].video = parsed.value; }, { draw: false });
      }
    }, { field: "item-video", hint: "Files live in the site's static/videos folder, e.g. /videos/clip.mp4." });
    const status = el("small", "gallery-video-status", "", { role: "status" });
    describe(Model.videoSource(item.video || item.src));
    wrapper.append(field, status, check);
    return wrapper;
  }

  /* ---------- adding things ---------- */

  function videoForm(host, si) {
    const form = el("form", "gallery-video-form");
    const input = el("input", "", "", { type: "text", "aria-label": "YouTube link or video file", placeholder: "https://www.youtube.com/watch?v=…  or  /videos/clip.mp4" });
    const status = el("small", "gallery-video-status", "Paste a YouTube link (watch, youtu.be, shorts or embed) or the path of a video file.");
    const add = el("button", "", "Add video", { type: "submit" });
    add.disabled = true;
    const preview = el("div", "gallery-video-preview");
    input.addEventListener("input", () => {
      const parsed = Model.videoSource(input.value);
      add.disabled = !parsed.kind;
      status.textContent = parsed.kind === "youtube" ? `Found YouTube video ${parsed.id}.` : parsed.kind === "file" ? "Video file found." : parsed.message || "Paste a YouTube link or the path of a video file.";
      status.className = `gallery-video-status ${parsed.kind ? "ok" : input.value ? "problem" : ""}`;
      preview.replaceChildren();
      if (parsed.kind === "youtube") preview.append(el("a", "", "Check this video on YouTube ↗", { href: parsed.value, target: "_blank", rel: "noopener noreferrer" }));
    });
    form.append(input, add, button("Cancel", () => { ui.video = -1; render(host); }), status, preview);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const parsed = Model.videoSource(input.value);
      if (!parsed.kind) return;
      let index = 0;
      edit(host, next => { next[si].items = next[si].items || []; next[si].items.push(Model.newVideo(parsed.value)); index = next[si].items.length - 1; }, { draw: false });
      ui.video = -1; ui.section = si; ui.item = index;
      render(host);
      reveal(`[data-section="${si}"] .gallery-inspector`);
    });
    requestAnimationFrame(() => input.focus());
    return form;
  }

  function footer(host, si) {
    const actions = el("div", "gallery-section-footer");
    actions.append(
      button("Upload photos…", () => chooseFiles(host, si), { secondary: false }),
      button("Choose from library…", () => host.pick("Gallery photo", "", url => addPhotos(host, si, [url]))),
      button("Add video…", () => { ui.video = ui.video === si ? -1 : si; render(host); }));
    return actions;
  }

  function addPhotos(host, si, urls) {
    if (!urls.length) return;
    let first = 0;
    edit(host, next => {
      next[si].items = next[si].items || [];
      first = next[si].items.length;
      for (const url of urls) next[si].items.push(Model.newPhoto(url));
    }, { draw: false });
    ui.section = si; ui.item = first;
    render(host);
    reveal(`[data-section="${si}"] .gallery-inspector`);
  }

  function chooseFiles(host, si) {
    const input = el("input", "", "", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp,image/heif,image/heic,.heif,.heic" });
    input.addEventListener("change", () => { if (input.files.length) uploadPhotos(host, si, [...input.files]); });
    input.click();
  }

  async function uploadPhotos(host, si, files) {
    try {
      const urls = await host.upload(files);
      if (urls.length) addPhotos(host, si, urls);
    } catch (error) { host.notify(error.message, "error"); }
  }

  function addSection(host, layout) {
    let index = 0;
    edit(host, next => { next.push(Model.newSection(layout)); index = next.length - 1; }, { draw: false });
    ui.section = index; ui.item = -1;
    render(host);
    requestAnimationFrame(() => {
      const title = $(`#gallery-editor [data-section="${index}"] .gallery-section-title`);
      title?.scrollIntoView({ block: "center" });
      title?.focus();
    });
  }

  /* ---------- panel ---------- */

  function render(host) {
    ui.host = host;
    const root = $("#gallery-editor");
    if (!root) return;
    const path = host.path();
    if (ui.path !== path) Object.assign(ui, { path, section: 0, item: -1, video: -1, undo: null, pageOpen: null, drag: null }, { look: new Set() });
    const list = sections(host);
    if (ui.section >= list.length) { ui.section = Math.max(0, list.length - 1); ui.item = -1; }
    if (ui.item >= (list[ui.section]?.items?.length || 0)) ui.item = -1;
    const pieces = [];
    if (ui.undo) {
      const bar = el("div", "gallery-undo notice", "", { role: "status" });
      bar.append(el("span", "", ui.undo.label), button("Undo", () => {
        const restore = ui.undo.sections;
        ui.undo = null;
        host.change("media_sections", restore);
        render(host);
      }), button("Dismiss", () => { ui.undo = null; render(host); }));
      pieces.push(bar);
    }
    pieces.push(pageCard(host, list));
    if (!list.length) {
      const empty = el("div", "gallery-empty panel");
      empty.append(el("h3", "", "Start your first gallery"),
        el("p", "hint", "A page is made of sections. Each section has a centered title and a row of photos or videos. Visitors open any item to see it large with its description."));
      const row = el("div", "gallery-actions");
      row.append(button("＋ Photo reel", () => addSection(host, "reel"), { secondary: false }), button("＋ Video grid", () => addSection(host, "grid")));
      empty.append(row);
      pieces.push(empty);
    }
    list.forEach((section, index) => pieces.push(sectionCard(host, list, section, index)));
    if (list.length) {
      const add = el("div", "gallery-add-section panel");
      add.append(el("strong", "", "Add another section"));
      const row = el("div", "gallery-actions");
      for (const [id, label, hint] of Model.LAYOUTS) row.append(button(`＋ ${label}`, () => addSection(host, id), { title: hint }));
      add.append(row);
      pieces.push(add);
    }
    const credits = el("datalist", "", "", { id: "gallery-credits" });
    for (const name of new Set(list.flatMap(section => (section.items || []).map(item => item.credit).filter(Boolean)))) credits.append(el("option", "", "", { value: name }));
    pieces.push(credits);
    root.replaceChildren(...pieces);
  }

  // Opens the field that holds `query`, for results coming from the site-wide text search.
  function locate(host, query) {
    const hit = Model.findText(host.meta(), query);
    if (!hit) return null;
    if (hit.kind === "page") ui.pageOpen = true;
    else { ui.section = hit.s; ui.item = hit.kind === "item" ? hit.i : -1; }
    render(host);
    const names = { page: { title: "title", description: "description" }, section: { title: "section-title" },
      item: { title: "item-title", credit: "item-credit", text: "item-text", alt: "item-alt", video: "item-video" } };
    const name = names[hit.kind][hit.field];
    const scope = hit.kind === "page" ? ".gallery-page" : `[data-section="${hit.s}"]`;
    return name ? $(`#gallery-editor ${scope} [data-field="${name}"]`) : null;
  }

  return { render, locate };
})();
