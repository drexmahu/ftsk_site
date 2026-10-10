"use strict";

let suggestionSequence = 0;

function attachSuggestions(input, { choices, select, render }) {
  const label = input.labels?.[0] || input.closest("label");
  if (!input.getAttribute("aria-label") && label) {
    input.setAttribute("aria-label", label.textContent.trim());
  }
  const host = document.createElement("div");
  host.className = "suggestion-picker";
  input.parentNode.insertBefore(host, input);
  host.append(input);
  const list = document.createElement("div");
  list.className = "suggestion-list";
  list.id = `workbench-suggestions-${++suggestionSequence}`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", `Suggestions for ${input.getAttribute("aria-label") || "this field"}`);
  list.hidden = true;
  host.append(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";
  let matches = [], active = -1, choosing = false;
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const highlight = index => {
    active = index;
    Array.from(list.children).forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === active));
      option.classList.toggle("active", i === active);
    });
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", list.children[active].id);
      list.children[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const choose = index => {
    const item = matches[index];
    if (!item || input.disabled) return;
    close();
    choosing = true;
    try { select(item); }
    finally { choosing = false; }
  };
  const refresh = (open = false) => {
    if (choosing) return;
    if (input.disabled || document.activeElement !== input) { close(); return; }
    if (list.hidden && !open) return;
    const term = input.value.normalize("NFC").trim().toLocaleLowerCase("hu");
    matches = choices().filter(item =>
      (item.search || item.label).normalize("NFC").toLocaleLowerCase("hu").includes(term));
    active = -1;
    input.removeAttribute("aria-activedescendant");
    list.replaceChildren();
    for (const [index, item] of matches.entries()) {
      const option = document.createElement("div");
      option.id = `${list.id}-${index}`;
      option.className = "suggestion-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      if (render) render(option, item);
      else option.textContent = item.label;
      option.addEventListener("mousedown", event => event.preventDefault());
      option.addEventListener("click", () => choose(index));
      list.append(option);
    }
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No matching saved choices. Change the search or filter.";
      empty.setAttribute("role", "status");
      list.append(empty);
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("input", () => refresh(true));
  input.addEventListener("focus", () => refresh(true));
  input.addEventListener("blur", close);
  input.addEventListener("keydown", event => {
    if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) refresh(true);
      if (matches.length) highlight(active < 0 ?
        (event.key === "ArrowDown" ? 0 : matches.length - 1) :
        (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter" && !list.hidden) {
      event.preventDefault();
      if (active >= 0) choose(active);
    } else if (event.key === "Tab") close();
  });
  return { refresh, close };
}

function searchableSelect(select, title, searchInput = null, keywords = () => "") {
  if (select.suggestions) return select.suggestions;
  if (!select.getAttribute("aria-label")) {
    select.setAttribute("aria-label", select.labels?.[0]?.firstChild?.textContent?.trim() || title);
  }
  if (!searchInput) {
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = `Type to find ${title.toLocaleLowerCase("hu")}`;
    searchInput.setAttribute("aria-label", `Search ${title}`);
    select.parentNode.insertBefore(searchInput, select);
  }
  searchInput.dataset.selectSearch = "true";
  const synchronize = () => {
    searchInput.disabled = select.disabled;
    if (select.disabled) select.suggestions?.close();
  };
  const suggestions = attachSuggestions(searchInput, {
    choices: () => Array.from(select.options).filter(option =>
      !option.disabled && !option.parentNode.disabled).map(option => ({
      value: option.value, label: option.textContent,
      search: `${option.textContent} ${option.value} ${keywords(option.value)}`,
    })),
    select: item => {
      if (select.disabled) return;
      select.value = item.value;
      searchInput.value = "";
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
  });
  select.suggestions = suggestions;
  new MutationObserver(() => { synchronize(); suggestions.refresh(); }).observe(select, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["disabled", "label", "value"],
  });
  synchronize();
  return suggestions;
}
