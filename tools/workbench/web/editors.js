"use strict";

(() => {
  const bindings = new Map();
  const native = HTMLTextAreaElement.prototype;
  const valueProperty = Object.getOwnPropertyDescriptor(native, "value");
  const selectionProperties = Object.fromEntries(["selectionStart", "selectionEnd"].map(key =>
    [key, Object.getOwnPropertyDescriptor(native, key)]));
  let monaco;

  function languageForPath(path) {
    const extension = path.split(".").pop().toLowerCase();
    return { md: "hugo-markdown", markdown: "hugo-markdown", yaml: "yaml", yml: "yaml", json: "json",
      js: "javascript", ts: "typescript", html: "html", css: "css", scss: "scss",
      py: "python", ps1: "powershell", toml: "ini", sh: "shell", bat: "bat" }[extension] || "plaintext";
  }

  function mount(area) {
    if (bindings.has(area)) return;
    const host = document.createElement("div");
    host.className = "monaco-source";
    host.style.height = `${Math.max(160, Math.min(720, (area.rows || 8) * 22 + 32))}px`;
    const wrappingLabel = area.closest("label");
    // A wrapping label would redirect editor clicks to the hidden native field.
    (wrappingLabel || area).after(host);
    const model = monaco.editor.createModel(area.value, area.dataset.sourcePath ?
      languageForPath(area.dataset.sourcePath) : area.dataset.monacoLanguage);
    const editor = monaco.editor.create(host, {
      model, theme: "vs-dark", automaticLayout: true, wordWrap: "on",
      minimap: { enabled: false }, fontSize: 14, lineNumbersMinChars: 3,
      scrollBeyondLastLine: false, tabSize: 2, insertSpaces: true,
      accessibilitySupport: "auto", ariaLabel: area.getAttribute("aria-label") ||
        area.closest("label")?.textContent.trim() || document.querySelector(`label[for="${area.id}"]`)?.textContent || "Source editor",
      padding: { top: 12, bottom: 12 },
    });
    const disposables = [];
    for (const label of area.labels || []) {
      const focusEditor = event => {
        event.preventDefault();
        if (!area.matches(":disabled") && !area.closest("[inert]")) editor.focus();
      };
      label.addEventListener("click", focusEditor);
      disposables.push({ dispose: () => label.removeEventListener("click", focusEditor) });
    }
    let changing = false;
    let lastValue = area.value;
    const emit = type => area.dispatchEvent(new Event(type, { bubbles: true }));
    const syncSelection = () => {
      const selection = editor.getSelection();
      native.setSelectionRange.call(area, model.getOffsetAt(selection.getStartPosition()),
        model.getOffsetAt(selection.getEndPosition()));
      emit("select");
    };
    const setSelection = (start, end = start) => {
      const from = model.getPositionAt(start);
      const to = model.getPositionAt(Math.max(start, end));
      editor.setSelection(new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column));
      editor.revealPositionInCenterIfOutsideViewport(to);
      syncSelection();
    };
    Object.defineProperty(area, "value", {
      configurable: true, get() { return valueProperty.get.call(area); },
      set(value) {
        valueProperty.set.call(area, value);
        const normalized = valueProperty.get.call(area);
        if (model.getValue() !== normalized) {
          changing = true;
          model.setValue(normalized);
          changing = false;
        }
        lastValue = normalized;
      },
    });
    for (const key of ["selectionStart", "selectionEnd"]) Object.defineProperty(area, key, {
      configurable: true, get() { return selectionProperties[key].get.call(area); },
      set(value) {
        selectionProperties[key].set.call(area, value);
        setSelection(area.selectionStart, area.selectionEnd);
      },
    });
    area.setSelectionRange = setSelection;
    area.setRangeText = (text, start = area.selectionStart, end = area.selectionEnd, mode = "preserve") => {
      const oldStart = area.selectionStart, oldEnd = area.selectionEnd;
      const from = model.getPositionAt(start), to = model.getPositionAt(end);
      editor.pushUndoStop();
      editor.executeEdits("workbench-insert", [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text }]);
      editor.pushUndoStop();
      const next = start + text.length, delta = text.length - (end - start);
      if (mode === "end") setSelection(next);
      else if (mode === "start") setSelection(start);
      else if (mode === "select") setSelection(start, next);
      else setSelection(oldStart > end ? oldStart + delta : Math.min(oldStart, start),
        oldEnd > end ? oldEnd + delta : Math.max(oldEnd, next));
    };
    area.focus = () => editor.focus();
    area.classList.add("monaco-backing");
    area.setAttribute("aria-hidden", "true");
    area.tabIndex = -1;
    // Monaco's internal textarea must not be mistaken for a guided form field.
    for (const event of ["input", "change"]) host.addEventListener(event, e => e.stopPropagation());
    disposables.push(editor.onDidChangeModelContent(() => {
      if (changing) return;
      const value = model.getValue();
      if (area.maxLength >= 0 && value.length > area.maxLength) {
        changing = true;
        model.setValue(lastValue);
        changing = false;
        notify(`This field allows at most ${area.maxLength} characters. The edit was not accepted.`, "error");
        return;
      }
      valueProperty.set.call(area, value);
      lastValue = valueProperty.get.call(area);
      syncSelection();
      emit("input");
    }));
    disposables.push(editor.onDidChangeCursorSelection(syncSelection));
    disposables.push(editor.onDidBlurEditorText(() => { emit("change"); emit("blur"); }));
    bindings.set(area, { editor, model, host, dispose() {
      disposables.forEach(item => item.dispose());
      editor.dispose();
      model.dispose();
      host.remove();
      for (const key of ["value", "selectionStart", "selectionEnd", "setSelectionRange", "setRangeText", "focus"]) delete area[key];
      area.classList.remove("monaco-backing");
      area.removeAttribute("aria-hidden");
      area.removeAttribute("tabindex");
    } });
  }

  function refresh() {
    if (!monaco) return;
    for (const [area, binding] of bindings) if (!area.isConnected) {
      binding.dispose();
      bindings.delete(area);
    }
    document.querySelectorAll("textarea[data-monaco-language]").forEach(mount);
    for (const [area, { editor, model }] of bindings) {
      const readOnly = area.matches(":disabled") || area.readOnly || Boolean(area.closest("[inert]"));
      if (editor.getRawOptions().readOnly !== readOnly) editor.updateOptions({ readOnly });
      const language = area.dataset.sourcePath ? languageForPath(area.dataset.sourcePath) : area.dataset.monacoLanguage;
      if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
    }
  }

  window.workbenchEditors = {
    get: area => bindings.get(area)?.editor,
    refresh,
    languageForPath,
  };
  import("/workbench-editor/editor.js").then(module => {
    monaco = module.monaco;
    refresh();
    let scheduled = false;
    new MutationObserver(records => {
      if (records.every(record => record.target.closest?.(".monaco-source"))) return;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; refresh(); });
    }).observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["disabled", "readonly", "inert", "data-monaco-language", "data-source-path"] });
    document.addEventListener("reset", () => requestAnimationFrame(() => {
      for (const area of bindings.keys()) area.value = valueProperty.get.call(area);
    }));
    window.dispatchEvent(new Event("workbench-editors-ready"));
  }).catch(error => {
    notify(`Monaco could not start: ${error.message}. Run npm ci and npm run workbench:editors, then reload. Plain-text fields remain available.`, "error");
  });
})();
