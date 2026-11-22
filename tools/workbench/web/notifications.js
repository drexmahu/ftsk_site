"use strict";

// One notification system for every Workbench tool: toasts for what just happened,
// a notification center for everything that happened, and no banners pushed into pages.
(function (root) {
  const STORAGE_KEY = "ftsk-workbench-notifications";
  const MAX_HISTORY = 60;
  const MAX_TOASTS = 4;
  const DUPLICATE_WINDOW = 1500;
  const TITLES = { error: "Problem", warning: "Check this", success: "Done", info: "Note", busy: "Working…" };
  const ICONS = { error: "✕", warning: "!", success: "✓", info: "i", busy: "" };
  const SUCCESS = /^(saved|deleted|copied|created|exported|merged|reloaded|stopped|started|queued|applied|removed|portrait exported|photos queued|person (saved|id changed|permanently deleted)|identities merged|people registry reloaded|membership category hint saved|custom category saved|role saved|empty custom category deleted|unused role deleted|owned preview stopped|check started|new draft loaded)\b/i;

  function normalizeKind(kind, message = "") {
    if (kind === true || kind === "error") return "error";
    if (["warning", "success", "info", "busy"].includes(kind)) return kind;
    return SUCCESS.test(String(message).trim()) ? "success" : "info";
  }

  const isProblem = item => item.kind === "error" || item.kind === "warning";
  const clockTime = time => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const describe = item => `[${clockTime(item.time)}] ${TITLES[item.kind]}${item.area ? ` · ${item.area}` : ""}\n${item.message}`;

  function createStore(options = {}) {
    const now = options.now || Date.now;
    const storage = options.storage || null;
    const listeners = new Set();
    let counter = 0;
    let items = [];

    function restore() {
      try {
        const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]");
        if (!Array.isArray(saved)) return;
        items = saved.filter(entry => entry && typeof entry.message === "string" && TITLES[entry.kind] && entry.kind !== "busy")
          .slice(0, MAX_HISTORY).map(entry => ({
            id: `n${++counter}`, key: "", kind: entry.kind, message: entry.message, area: String(entry.area || ""),
            time: Number(entry.time) || now(), read: true, toast: false, sticky: true, duration: 0, actions: [] }));
      } catch { items = []; }
    }
    function persist() {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(items.filter(item => item.kind !== "busy").slice(0, MAX_HISTORY)
          .map(({ kind, message, area, time }) => ({ kind, message, area, time }))));
      } catch { /* Session storage may be unavailable; history then lasts until the page closes. */ }
    }
    function emit() {
      persist();
      const snapshot = api.snapshot();
      listeners.forEach(listener => listener(snapshot));
    }
    function hideWhere(test) {
      let changed = false;
      for (const item of [...items]) {
        if (!test(item)) continue;
        changed = true;
        item.read = true;
        if (item.kind === "busy") items.splice(items.indexOf(item), 1);
        else item.toast = false;
      }
      return changed;
    }
    function duration(item) {
      return Math.min(20000, 6000 + Math.max(0, item.message.length - 80) * 45);
    }

    const api = {
      add(message, kind = "", settings = {}) {
        const text = String(message ?? "").trim();
        let key = settings.key || "";
        const resolved = normalizeKind(kind, text);
        if (!text) {
          if (hideWhere(item => key ? item.key === key : !item.key || item.key === "busy")) emit();
          return null;
        }
        if (resolved === "busy" && !key) key = "busy";
        let changed = false;
        if (resolved !== "busy") changed = hideWhere(item => item.kind === "busy" && item.key === "busy");
        const existing = key ? items.find(item => item.key === key) : null;
        if (existing && settings.dedupe && existing.kind === resolved && existing.message === text) {
          if (changed) emit();
          return existing.id;
        }
        // The same report arriving twice at once (a tool and the shared error handler) is one event.
        const twin = items.find(item => item.kind === resolved && item.message === text && now() - item.time < DUPLICATE_WINDOW);
        if (twin && twin !== existing) {
          if (changed) emit();
          return twin.id;
        }
        if (existing) items.splice(items.indexOf(existing), 1);
        const sticky = Boolean(settings.sticky) || resolved !== "success" && resolved !== "info";
        const item = {
          id: `n${++counter}`, key, kind: resolved, message: text, area: settings.area || "", time: now(),
          read: !isProblem({ kind: resolved }), toast: settings.toast !== false, sticky, duration: 0,
          actions: Array.isArray(settings.actions) ? settings.actions : [],
        };
        item.duration = settings.duration || (sticky ? 0 : duration(item));
        items.unshift(item);
        items = items.slice(0, MAX_HISTORY);
        emit();
        return item.id;
      },
      dismiss(id) { if (hideWhere(item => item.id === id)) emit(); },
      dismissKey(key) { if (hideWhere(item => item.key === key)) emit(); },
      remove(id) {
        const before = items.length;
        items = items.filter(item => item.id !== id);
        if (items.length !== before) emit();
      },
      clear() {
        items = items.filter(item => item.kind === "busy");
        emit();
      },
      markRead() {
        let changed = false;
        for (const item of items) if (!item.read) { item.read = true; changed = true; }
        if (changed) emit();
      },
      snapshot() {
        const visible = items.filter(item => item.toast);
        return {
          items: items.map(item => ({ ...item })),
          toasts: visible.slice(0, MAX_TOASTS).reverse().map(item => ({ ...item })),
          hidden: Math.max(0, visible.length - MAX_TOASTS),
          attention: items.filter(item => isProblem(item) && !item.read).length,
          problems: items.filter(isProblem).length,
        };
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    restore();
    return api;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { createStore, normalizeKind, describe, TITLES };
  if (!root.document) return;

  const doc = root.document;
  const store = createStore({ storage: (() => { try { return root.sessionStorage; } catch { return null; } })() });
  const reducedMotion = () => root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const make = (tag, className = "", text = "") => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const button = (label, className, handler) => {
    const control = make("button", className, label);
    control.type = "button";
    control.addEventListener("click", handler);
    return control;
  };
  async function copy(item, control) {
    try { await root.navigator.clipboard.writeText(describe(item)); control.textContent = "Copied"; }
    catch { control.textContent = "Copy failed"; }
    root.setTimeout(() => { control.textContent = "Copy details"; }, 2000);
  }

  const region = make("section", "notify-region");
  region.id = "notification-region";
  region.setAttribute("aria-label", "Notifications");
  const stack = make("ol", "notify-stack");
  stack.setAttribute("aria-live", "polite");
  stack.setAttribute("aria-relevant", "additions");
  const overflow = button("", "notify-overflow secondary", () => openCenter());
  overflow.hidden = true;
  region.append(stack, overflow);
  doc.body.append(region);

  // Modal dialogs make the page behind them unreachable, so toasts live inside the open one.
  function placeRegion() {
    const host = [...doc.querySelectorAll("dialog[open]")].at(-1) || doc.body;
    if (region.parentNode !== host) host.append(region);
  }
  new MutationObserver(placeRegion).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
  doc.addEventListener("close", placeRegion, true);

  const nodes = new Map();
  const timers = new Map();
  function stopTimer(id) { root.clearTimeout(timers.get(id)); timers.delete(id); }
  function startTimer(item, milliseconds) {
    stopTimer(item.id);
    timers.set(item.id, root.setTimeout(() => store.dismiss(item.id), milliseconds));
  }

  function toastNode(item) {
    const toast = make("li", `notify-toast notify-${item.kind}`);
    toast.dataset.id = item.id;
    toast.setAttribute("role", item.kind === "error" ? "alert" : "status");
    const icon = make("span", "notify-icon", ICONS[item.kind]);
    icon.setAttribute("aria-hidden", "true");
    const body = make("div", "notify-body");
    const head = make("div", "notify-head");
    head.append(make("strong", "notify-title", TITLES[item.kind]));
    if (item.area) head.append(make("span", "notify-area", item.area));
    const close = button("×", "notify-close secondary", () => store.dismiss(item.id));
    close.setAttribute("aria-label", `Dismiss notification: ${item.message.slice(0, 60)}`);
    const text = make("p", "notify-message", item.message);
    body.append(head, text);
    const actions = make("div", "notify-actions");
    if (item.message.length > 220 || item.message.split("\n").length > 4) {
      const more = button("Show more", "notify-link", () => {
        const open = text.classList.toggle("expanded");
        more.textContent = open ? "Show less" : "Show more";
        more.setAttribute("aria-expanded", String(open));
      });
      more.setAttribute("aria-expanded", "false");
      actions.append(more);
    }
    for (const action of item.actions) actions.append(button(action.label, "notify-link", () => { action.run?.(); store.dismiss(item.id); }));
    if (item.kind === "error" || item.kind === "warning") {
      const copier = button("Copy details", "notify-link", () => copy(item, copier));
      actions.append(copier);
    }
    if (actions.children.length) body.append(actions);
    if (!item.sticky && item.duration) {
      const bar = make("span", "notify-timer");
      bar.style.animationDuration = `${item.duration}ms`;
      toast.append(bar);
      toast.addEventListener("mouseenter", () => { stopTimer(item.id); bar.style.animationPlayState = "paused"; });
      toast.addEventListener("focusin", () => { stopTimer(item.id); bar.style.animationPlayState = "paused"; });
      const resume = () => {
        if (toast.matches(":hover, :focus-within")) return;
        bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
        bar.style.animationDuration = "4000ms"; startTimer(item, 4000);
      };
      toast.addEventListener("mouseleave", resume);
      toast.addEventListener("focusout", () => root.setTimeout(resume));
      startTimer(item, item.duration);
    }
    toast.prepend(icon, body, close);
    return toast;
  }

  const bell = doc.getElementById("notification-center-toggle");
  const badge = bell?.querySelector(".notify-badge");
  const center = make("section", "notify-center");
  center.id = "notification-center";
  center.setAttribute("role", "dialog");
  center.setAttribute("aria-label", "Notifications");
  center.hidden = true;
  let filter = "all";
  const heading = make("h2", "", "Notifications");
  heading.tabIndex = -1;
  const tabs = make("div", "notify-tabs");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Filter notifications");
  const tabAll = button("", "secondary", () => { filter = "all"; render(store.snapshot()); });
  const tabProblems = button("", "secondary", () => { filter = "problems"; render(store.snapshot()); });
  tabs.append(tabAll, tabProblems);
  const clear = button("Clear all", "secondary", () => store.clear());
  const closeCenter = button("Close", "secondary", () => closeCenterPanel(true));
  const list = make("ol", "notify-list");
  const header = make("div", "notify-center-header");
  header.append(heading, make("span", "notify-spacer"), clear, closeCenter);
  center.append(header, tabs, list);
  doc.body.append(center);

  function historyNode(item) {
    const row = make("li", `notify-entry notify-${item.kind}`);
    const icon = make("span", "notify-icon", ICONS[item.kind]);
    icon.setAttribute("aria-hidden", "true");
    const body = make("div", "notify-body");
    const meta = make("div", "notify-head");
    meta.append(make("strong", "notify-title", TITLES[item.kind]), make("span", "notify-area", [item.area, clockTime(item.time)].filter(Boolean).join(" · ")));
    const text = make("p", "notify-message expanded", item.message);
    const actions = make("div", "notify-actions");
    const copier = button("Copy details", "notify-link", () => copy(item, copier));
    actions.append(copier, button("Remove", "notify-link", () => store.remove(item.id)));
    body.append(meta, text, actions);
    row.append(icon, body);
    return row;
  }

  function render(snapshot) {
    placeRegion();
    const wanted = new Set(snapshot.toasts.map(item => item.id));
    for (const [id, node] of nodes) {
      if (wanted.has(id)) continue;
      stopTimer(id);
      nodes.delete(id);
      if (reducedMotion()) node.remove();
      else { node.classList.add("leaving"); root.setTimeout(() => node.remove(), 180); }
    }
    for (const [index, item] of snapshot.toasts.entries()) {
      if (nodes.has(item.id)) continue;
      const node = toastNode(item);
      nodes.set(item.id, node);
      const next = snapshot.toasts.slice(index + 1).map(later => nodes.get(later.id)).find(Boolean);
      if (next) stack.insertBefore(node, next); else stack.append(node);
    }
    overflow.hidden = !snapshot.hidden;
    overflow.textContent = `${snapshot.hidden} more in Notifications`;
    if (bell) {
      badge.hidden = !snapshot.attention;
      badge.textContent = snapshot.attention > 9 ? "9+" : String(snapshot.attention);
      bell.classList.toggle("has-problem", snapshot.attention > 0);
      bell.setAttribute("aria-label", snapshot.attention ?
        `Notifications, ${snapshot.attention} problem${snapshot.attention === 1 ? "" : "s"} need attention` : "Notifications");
    }
    tabAll.textContent = `All (${snapshot.items.filter(item => item.kind !== "busy").length})`;
    tabProblems.textContent = `Problems (${snapshot.problems})`;
    tabAll.setAttribute("aria-pressed", String(filter === "all"));
    tabProblems.setAttribute("aria-pressed", String(filter === "problems"));
    clear.disabled = !snapshot.items.some(item => item.kind !== "busy");
    if (center.hidden) return;
    const shown = snapshot.items.filter(item => item.kind !== "busy" && (filter === "all" || item.kind === "error" || item.kind === "warning"));
    list.replaceChildren(...(shown.length ? shown.map(historyNode) : [make("li", "notify-empty", filter === "problems" ?
      "No problems recorded in this session." : "Nothing yet. Results of saves, checks and problems will be listed here.")]));
    store.markRead();
  }

  function openCenter() {
    center.hidden = false;
    region.dataset.centerOpen = "true";
    bell?.setAttribute("aria-expanded", "true");
    render(store.snapshot());
    heading.focus();
  }
  function closeCenterPanel(restoreFocus = false) {
    if (center.hidden) return;
    center.hidden = true;
    delete region.dataset.centerOpen;
    bell?.setAttribute("aria-expanded", "false");
    if (restoreFocus) bell?.focus();
  }
  bell?.addEventListener("click", () => (center.hidden ? openCenter() : closeCenterPanel(true)));
  doc.addEventListener("keydown", event => {
    if (event.key === "Escape" && !center.hidden && !doc.querySelector("dialog[open]")) { event.preventDefault(); closeCenterPanel(true); }
  });
  doc.addEventListener("click", event => {
    if (!center.hidden && !center.contains(event.target) && !bell?.contains(event.target)) closeCenterPanel(false);
  });

  store.subscribe(render);
  render(store.snapshot());

  root.workbenchNotifications = {
    notify: (message, kind, settings) => store.add(message, kind, settings),
    dismiss: id => store.dismiss(id),
    dismissKey: key => store.dismissKey(key),
    open: openCenter,
    snapshot: () => store.snapshot(),
  };
}(typeof window !== "undefined" ? window : globalThis));
