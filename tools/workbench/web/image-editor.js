"use strict";

const imageGeometry = {
  fit(width, height, ratio, percent = 100, cx = width / 2, cy = height / 2) {
    let w = Math.round(Math.min(width, height * ratio) * percent / 100);
    w = Math.max(1, Math.min(width, w));
    const h = Math.max(1, Math.min(height, ratio === 1 ? w : Math.round(w / ratio)));
    const x = Math.max(0, Math.min(width - w, Math.round(cx - w / 2)));
    const y = Math.max(0, Math.min(height - h, Math.round(cy - h / 2)));
    return [x, y, x + w, y + h];
  },
  move(box, dx, dy, width, height) {
    const w = box[2] - box[0], h = box[3] - box[1];
    const x = Math.max(0, Math.min(width - w, Math.round(box[0] + dx)));
    const y = Math.max(0, Math.min(height - h, Math.round(box[1] + dy)));
    return [x, y, x + w, y + h];
  },
};

if (typeof module !== "undefined") module.exports = imageGeometry;

if (typeof document !== "undefined") {
  (() => {
    let model = null;
    const dialog = document.getElementById("image-editor");
    const get = id => document.getElementById("image-" + id);
    const currentPhoto = () => model?.photos[model.index];
    const currentVersion = () => currentPhoto()?.versions.find(version => version.key === model.version);
    const outputs = () => model.photos.flatMap(photo => photo.versions.filter(v => v.enabled).map(version => ({photo, version})));
    const error = message => { get("notice").textContent = message; get("notice").hidden = !message; };

    function version(photo, edited, recipe = null) {
      return {
        key: crypto.randomUUID(), sequence: 0, enabled: true, edited, saved: null,
        name: edited ? `${photo.versions[0]?.name || photo.entry.stem}-edit-${photo.versions.filter(v => v.edited).length + 1}` : model.settings.name || photo.entry.stem,
        width: model.settings.width, height: model.settings.height, quality: model.settings.quality,
        mode: "copy", ratio: "free", edit: recipe ? structuredClone(recipe) : {
          crop: [0, 0, photo.entry.width, photo.entry.height], shape: "rectangle",
          brightness: 100, contrast: 100, saturation: 100, warmth: 0,
        },
        waiting: true, error: "", cropError: "", saveError: "", ticket: null, timer: null, running: false, pending: null,
      };
    }

    function validate() {
      if (!state.git?.editable || state.git.branch !== model.branch) throw new Error("The working branch changed or editing is locked. Close and reopen the image editor.");
      if (state.jobState === "running") throw new Error("Wait for the current build/check before saving images.");
      model.options.validate?.();
    }

    function navigation() {
      const photo = currentPhoto();
      if (!photo) return;
      get("position").textContent = `${model.index + 1}/${model.photos.length} · ${photo.entry.name}`;
      get("previous").disabled = model.index === 0 || model.saving || model.closing;
      get("next").disabled = model.index === model.photos.length - 1 || model.saving || model.closing;
    }

    function modeControls() {
      const v = currentVersion();
      if (!v) return;
      const allowed = v.ticket?.can_overwrite === true;
      get("mode").disabled = model.saving || model.closing || Boolean(v.saved) || !allowed;
      get("overwrite-option").disabled = !allowed;
      get("mode-note").textContent = v.ticket?.overwrite_reason ||
        (allowed ? "Replacing this WebP changes every page using its URL. Approval is required in the output review." :
          "Preparing destination checks. New copies never replace existing files.");
    }

    function controls() {
      const photo = currentPhoto(), v = currentVersion();
      get("workspace").hidden = !photo;
      if (!photo || !v) { footer(); return; }
      navigation();
      get("keep").checked = photo.versions[0].enabled;
      get("keep").disabled = model.saving || Boolean(photo.versions[0].saved) || (!photo.versions[0].enabled && outputs().length >= 200);
      get("keep").title = "Up to 200 selected outputs per batch.";
      get("versions").replaceChildren(...photo.versions.map(item => new Option(
        `${item.edited ? item.name : "Unedited WebP"}${!item.enabled ? " (not saving)" : ""}${item.saved ? " (saved)" : ""}`, item.key)));
      get("versions").value = v.key;
      for (const key of ["name", "width", "height", "quality", "mode"]) get(key).value = v[key];
      for (const key of ["brightness", "contrast", "saturation", "warmth"]) {
        get(key).value = v.edit[key];
        get(key + "-value").textContent = key === "warmth" ? v.edit[key] : `${v.edit[key]}%`;
      }
      get("shape").value = v.edit.shape;
      get("ratio").value = v.edit.shape === "circle" ? "1" : v.ratio;
      get("ratio").disabled = !v.edited || model.saving || Boolean(v.saved) || v.edit.shape === "circle";
      for (const id of ["shape", "crop-x", "crop-y", "crop-width", "crop-height", "brightness", "contrast", "saturation", "warmth", "reset"]) {
        get(id).disabled = !v.edited || model.saving || Boolean(v.saved);
      }
      for (const id of ["name", "width", "height", "quality", "mode", "versions", "duplicate", "create"]) get(id).disabled = model.saving;
      for (const id of ["name", "width", "height", "quality", "mode"]) get(id).disabled ||= Boolean(v.saved);
      modeControls();
      get("name").disabled ||= v.mode === "overwrite";
      get("remove").disabled = !v.edited || model.saving || Boolean(v.saved);
      get("create").disabled ||= photo.versions.length >= 20 || outputs().length >= 200;
      get("duplicate").disabled ||= get("create").disabled;
      get("create").title = get("duplicate").title = "Up to 20 versions per photo and 200 selected outputs per batch. Remove a version or omit an unedited output to make room.";
      get("duplicate").disabled ||= !v.edited;
      get("crop-note").textContent = v.edited ? "Drag the selection to move it; drag a corner to resize. Coordinates are source pixels. The output preview shows the actual WebP." :
        "Unedited means no crop or tone changes, converted to WebP with the size limits below. Create an edited version to crop or adjust this photo.";
      if (v.cropError) for (const [id, value] of Object.entries(v.cropInputs)) get(id).value = value;
      else cropFields();
      get("canvas").style.touchAction = v.edited && !v.saved ? "none" : "pan-y";
      draw();
      previewView();
      footer();
    }

    function cropFields() {
      const v = currentVersion();
      if (!v) return;
      const box = v.edit.crop;
      get("crop-x").value = box[0]; get("crop-y").value = box[1];
      get("crop-width").value = box[2] - box[0]; get("crop-height").value = box[3] - box[1];
    }

    function footer() {
      if (!model) return;
      const planned = outputs(), remaining = planned.filter(item => !item.version.saved);
      const waiting = remaining.filter(item => item.version.waiting).length;
      const bad = remaining.some(item => item.version.error || item.version.cropError || !item.version.ticket);
      const replacing = remaining.some(item => item.version.mode === "overwrite");
      get("approval").hidden = !replacing || !model.review;
      get("save").disabled = model.closed || model.saving || model.staging || !planned.length || Boolean(waiting) || bad ||
        (model.review && replacing && !get("approve").checked);
      get("save").textContent = model.saving ? "Saving reviewed files…" :
        !model.review ? `Review ${planned.length} WebP output${planned.length === 1 ? "" : "s"}` :
          `${remaining.some(item => item.version.saveError) ? "Retry" : "Save"} ${remaining.length} remaining WebP${remaining.length === 1 ? "" : "s"}`;
      get("close").disabled = model.saving || model.closing;
      get("back").hidden = !model.review;
      get("back").disabled = model.saving;
      get("edit").inert = model.saving || model.closing;
      get("review").inert = model.saving || model.closing;
      get("activity").hidden = !model.staging && !waiting && !model.saving && !model.closing;
      get("status").textContent = model.saving ? model.saveStatus : model.closing ? "Finishing temporary work and closing. No new site files will be saved." :
        model.staging ? model.stageStatus : waiting ? `Preparing ${waiting} exact WebP preview${waiting === 1 ? "" : "s"}…` :
          !model.photos.length ? "No photos could be prepared. Close and choose supported image files; see the errors above." :
          `${planned.length}/200 outputs from ${model.photos.length} photo${model.photos.length === 1 ? "" : "s"}. ${model.results.length ? `${model.results.length} already saved; closing keeps them.` : "Nothing is written to the site before Save."}`;
    }

    function thumbnails(scroll = false) {
      const container = get("photos"), left = container.scrollLeft, top = container.scrollTop;
      container.replaceChildren();
      model.photos.forEach((photo, index) => {
        const button = node("button", "", `image-source${index === model.index ? " selected" : ""}`);
        button.type = "button";
        const img = node("img"); img.src = `/api/workbench/uploads/${photo.entry.id}`; img.alt = photo.entry.name;
        const count = photo.versions.filter(v => v.enabled).length;
        button.append(img, node("span", photo.entry.name), node("small", `${count} output${count === 1 ? "" : "s"}`));
        button.disabled = model.saving || model.closing;
        button.setAttribute("aria-pressed", String(index === model.index));
        button.addEventListener("click", () => select(index));
        get("photos").append(button);
      });
      container.scrollLeft = left; container.scrollTop = top;
      if (scroll) container.children[model.index]?.scrollIntoView({block: "nearest", inline: "nearest"});
    }

    async function select(index, key = null) {
      if (!model || model.saving || model.closing) return;
      finishDrag();
      const owner = model;
      model.index = index;
      const photo = currentPhoto();
      if (!photo) return;
      model.version = photo.versions.find(v => v.key === (key || photo.selectedKey))?.key ||
        photo.versions.find(v => v.edited && !v.saved)?.key || photo.versions[0].key;
      photo.selectedKey = model.version;
      thumbnails(true); controls();
      if (!photo.image) {
        const image = new Image();
        image.src = `/api/workbench/images/source/${photo.entry.id}`;
        try {
          await image.decode();
          if (model === owner && !owner.closed) { photo.image = image; if (currentPhoto() === photo) draw(); }
        } catch (failure) { if (model === owner && !owner.closed) error(`Cannot display the source photo: ${failure.message}`); }
      }
    }

    function draw() {
      const photo = currentPhoto(), v = currentVersion();
      const canvas = get("canvas"), ctx = canvas.getContext("2d");
      if (model.review) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!photo?.image || !v) return;
      const {width, height} = photo.entry;
      const scale = Math.min(canvas.width / width, canvas.height / height);
      const x = (canvas.width - width * scale) / 2, y = (canvas.height - height * scale) / 2;
      photo.geometry = {x, y, scale};
      ctx.drawImage(photo.image, x, y, width * scale, height * scale);
      if (!v.edited) return;
      const [l, t, r, b] = v.edit.crop, left = x + l * scale, top = y + t * scale, w = (r - l) * scale, h = (b - t) * scale;
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save(); ctx.beginPath();
      if (v.edit.shape === "rectangle") ctx.rect(left, top, w, h);
      else ctx.ellipse(left + w / 2, top + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.clip(); ctx.drawImage(photo.image, x, y, width * scale, height * scale); ctx.restore();
      ctx.strokeStyle = "#bea070"; ctx.lineWidth = 2; ctx.strokeRect(left, top, w, h);
      ctx.fillStyle = "#bea070";
      const handle = 7 * canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
      for (const [cx, cy] of [[left, top], [left+w, top], [left, top+h], [left+w, top+h]]) ctx.fillRect(cx-handle, cy-handle, handle*2, handle*2);
    }

    function previewView() {
      const v = currentVersion();
      get("preview").hidden = !v || !v.enabled || v.waiting || Boolean(v.error || v.cropError) || !v.ticket;
      get("refresh").disabled = !v || !v.enabled || Boolean(v.saved || v.cropError) || model.saving || model.closing || v.waiting;
      get("preview-detail").textContent = !v ? "" : v.cropError || (v.error ? `Preview failed: ${v.error}` : !v.enabled ? "Not selected for saving. Enable the unedited output to prepare its WebP preview." : v.waiting ? "Preparing the exact WebP…" :
        v.ticket ? `${v.ticket.width} × ${v.ticket.height} · ${(v.ticket.bytes / 1024).toFixed(1)} KiB · ${v.ticket.url}` : "Prepare a preview before saving.");
      if (v?.ticket && v.enabled && !v.waiting && !v.error && !v.cropError) get("preview").src = v.saved ? `${v.saved.url}?edited=${Date.now()}` : v.ticket.preview;
    }

    function invalidate(v) {
      clearTimeout(v.timer);
      v.pending = null;
      v.sequence++; v.waiting = v.enabled && !v.cropError; v.error = ""; get("approve").checked = false;
      footer(); if (v === currentVersion()) previewView();
    }

    function discardVersion(v) {
      invalidate(v); v.waiting = false;
      const ticket = v.ticket; v.ticket = null;
      if (!ticket) return;
      const owner = model;
      const request = api("/api/workbench/images/preview/" + ticket.token, {method: "DELETE"})
        .catch(failure => { if (model === owner && !owner.closed) error(`Could not discard a preview: ${failure.message}. Closing retries temporary cleanup.`); })
        .finally(() => owner.requests.delete(request));
      owner.requests.add(request);
    }

    function schedule(photo, v, immediate = false) {
      if (model.closed || v.saved) return;
      invalidate(v);
      if (!v.enabled || v.cropError) return;
      const owner = model, sequence = v.sequence;
      const run = () => {
        if (v.running) { v.pending = run; return; }
        v.running = true;
        const request = Promise.resolve().then(async () => {
          try {
            validate();
            const ticket = await api("/api/workbench/images/preview", {method: "POST", payload: {
              id: photo.entry.id, context: owner.context, key: v.key, sequence,
              name: v.name, width: v.width, height: v.height, quality: v.quality, mode: v.mode,
              edit: v.edited ? structuredClone(v.edit) : {},
            }});
            // Superseded requests must never re-enable saving an older recipe.
            if (!owner.closed && sequence === v.sequence && photo.versions.includes(v)) {
              v.ticket = ticket;
              if (owner.previewErrorKey === v.key) { owner.previewErrorKey = ""; error(owner.stageErrors.join("\n")); }
              if (v === currentVersion()) modeControls();
            } else if (!owner.closed) {
              try { await api("/api/workbench/images/preview/" + ticket.token, {method: "DELETE"}); }
              catch (failure) { error(`Could not discard an outdated preview: ${failure.message}. Closing retries temporary cleanup.`); }
            }
          } catch (failure) {
            if (!owner.closed && sequence === v.sequence) { v.error = failure.message; owner.previewErrorKey = v.key; error(failure.message); }
          } finally {
            if (sequence === v.sequence) v.waiting = false;
            owner.requests.delete(request);
            v.running = false;
            const pending = v.pending; v.pending = null;
            if (pending && !owner.closed && v.enabled && photo.versions.includes(v)) pending();
            if (model === owner && !owner.closed) {
              if (v === currentVersion()) previewView();
              footer(); if (owner.review) review();
            }
          }
        });
        owner.requests.add(request);
      };
      if (immediate) run(); else v.timer = setTimeout(run, 350);
    }

    function review() {
      finishDrag();
      model.review = true; get("edit").hidden = true; get("review").hidden = false;
      if (!outputs().some(item => item.version.key === model.primary)) model.primary = outputs()[0]?.version.key || "";
      get("outputs").replaceChildren();
      for (const {photo, version: v} of outputs()) {
        const card = node("section", "", "image-output");
        const img = node("img"); img.alt = `${photo.entry.name}: ${v.edited ? v.name : "unedited"}`;
        if (v.ticket && !v.waiting && !v.error) img.src = v.saved ? v.saved.url : v.ticket.preview;
        card.append(img, node("strong", v.edited ? v.name : "Unedited WebP"), node("small", photo.entry.name),
          node("code", v.ticket?.url || "Preview not ready"),
          node("p", v.saved ? "Saved" : v.cropError || v.error || (v.saveError ? `Save not confirmed: ${v.saveError}. Retry the same output.` : v.waiting ? "Preparing preview…" :
            `${v.ticket?.width} × ${v.ticket?.height} · ${((v.ticket?.bytes || 0) / 1024).toFixed(1)} KiB · ${v.mode === "overwrite" ? "REPLACES existing file" : "New file"}`), v.error || v.cropError || v.saveError ? "error" : "hint"));
        if (model.options.field) {
          const label = node("label", "", "image-check");
          const radio = node("input"); radio.type = "radio"; radio.name = "image-primary";
          radio.checked = model.primary === v.key;
          radio.disabled = model.saving;
          radio.addEventListener("change", () => { model.primary = v.key; });
          label.append(radio, node("span", `Use for ${model.options.field}`)); card.append(label);
        }
        get("outputs").append(card);
      }
      const skipped = model.photos.filter(photo => !photo.versions.some(v => v.enabled)).length;
      get("review-note").textContent = `${skipped ? `${skipped} photos skipped. ` : ""}${model.stageErrors.length ? `${model.stageErrors.length} source${model.stageErrors.length === 1 ? "" : "s"} could not be prepared; they will not be saved. See their names above. ` : ""}These are the exact files that will be saved.${model.options.field ? ` Choose one for ${model.options.field}; other outputs remain available in the image library.` : ""} Saving images does not save the page/person draft, commit or publish.`;
      footer();
    }

    async function close() {
      if (!model || model.saving || model.closing) return;
      const owner = model;
      owner.closed = true; owner.closing = true;
      drag = null;
      owner.photos.forEach(photo => photo.versions.forEach(v => clearTimeout(v.timer)));
      footer();
      await owner.stagingTask;
      await Promise.allSettled([...owner.requests]);
      const failures = [];
      const remove = new Set([...owner.owned, ...owner.completed]);
      if (owner.photos.length) {
        try { await api("/api/workbench/images/finish", {method: "POST", payload: {
          ids: owner.photos.map(photo => photo.entry.id), remove: [...remove],
        }}); }
        catch (failure) { failures.push(`Temporary photo cleanup failed: ${failure.message}`); }
      }
      dialog.close();
      model = null;
      owner.resolve({results: owner.results, completedIds: [...owner.completed], sourceErrors: [...owner.stageErrors],
        primary: owner.results.find(result => result.key === owner.primary)?.files[0].url || "",
        remainingFiles: (owner.options.files || []).filter(file => !owner.photos.some(photo => photo.file === file && owner.completed.has(photo.entry.id)))});
      if (failures.length) notify(`Images saved/cancelled, but temporary cleanup needs attention:\n${failures.join("\n")}`, "error");
    }

    async function save() {
      try {
        finishDrag();
        validate();
        if (outputs().some(item => !item.version.saved && (item.version.waiting || item.version.cropError || item.version.error || !item.version.ticket))) throw new Error("Wait for valid previews of every output before saving.");
        if (!model.review) {
          model.primary ||= outputs()[0]?.version.key;
          review(); return;
        }
        const owner = model, remaining = outputs().filter(item => !item.version.saved);
        if (remaining.some(item => item.version.mode === "overwrite") && !get("approve").checked) throw new Error("Approve the listed replacements before saving.");
        owner.saving = true; setBusy(true); error(owner.stageErrors.join("\n")); controls(); thumbnails(); review();
        try {
          for (const [index, {photo, version: v}] of remaining.entries()) {
            owner.saveStatus = `Saving ${index + 1}/${remaining.length}: ${v.ticket.url}`; footer();
            validate();
            let result;
            try {
              result = await api("/api/workbench/images/save", {method: "POST", payload: {
                token: v.ticket.token, confirm_overwrite: v.mode === "overwrite" && get("approve").checked,
              }});
            } catch (failure) { v.saveError = failure.message; throw failure; }
            v.saveError = "";
            v.saved = result.files[0]; owner.results.push({...result, id: photo.entry.id, key: v.key});
            if (photo.versions.filter(item => item.enabled).every(item => item.saved)) owner.completed.add(photo.entry.id);
            review();
          }
          for (const photo of owner.photos) if (!photo.versions.some(v => v.enabled)) owner.completed.add(photo.entry.id);
        } finally { owner.saving = false; setBusy(false); thumbnails(); footer(); }
        await close();
      } catch (failure) {
        const saved = model?.results.map(result => result.files[0].url) || [];
        error(`${failure.message}${saved.length ? `\nAlready saved: ${saved.join(", ")}. Retry saves only remaining outputs; closing does not undo saved files.` : "\nCheck the reviewed paths if the connection failed. Retrying the same prepared output does not create duplicates."}`);
        if (model?.review) get("notice").textContent += "\nFor an expired preview or changed path, use Back to editing → Refresh preview.";
        if (model) { controls(); if (model.review) review(); }
      }
    }

    async function open(options) {
      if (model) throw new Error("Finish the open image editor first.");
      if (state.busy || !state.git?.editable) throw new Error("Choose an editable branch and finish active image work first.");
      const owner = model = {options, context: structuredClone(options.context), settings: {...options.settings},
        folder: options.folder ?? options.context.folder, branch: state.git.branch, photos: [], index: 0, version: "",
        owned: new Set(), requests: new Set(), completed: new Set(), results: [],
        review: false, primary: "", staging: true, saving: false, closed: false, closing: false,
        stageStatus: "Preparing sources…", stageErrors: [], previewErrorKey: ""};
      const done = new Promise(resolve => { owner.resolve = resolve; });
      get("title").textContent = options.title || "Prepare site images";
      get("destination").textContent = `/images/${owner.folder ? owner.folder + "/" : ""}`;
      get("field-note").textContent = options.field ? `Select one reviewed output for ${options.field}.` : "Keep an unedited WebP, any edited versions, or both.";
      get("storage-note").textContent = owner.context.kind === "page" ?
        "This page owns the destination folder. Browsing another folder does not change where new images are saved; borrowed images are copied here." :
        owner.context.kind === "cv" ? "Images are saved only in the selected person's folder. Images borrowed from other folders are copied here, never replaced there." :
        options.url ? "New copies stay beside this existing image. To save in a different folder, use the Site photos upload workflow." :
        "This is your chosen Site photos folder. New copies receive a numeric suffix if their name already exists.";
      get("edit").hidden = false; get("review").hidden = true; get("workspace").hidden = true;
      get("approve").checked = false; error(""); get("photos").replaceChildren();
      dialog.showModal(); footer();
      owner.stagingTask = (async () => {
        const sources = options.entries || options.files || (options.url ? [options.url] : []);
        if (!sources.length || sources.length > 100) { owner.stageErrors.push("Choose between 1 and 100 photos."); error(owner.stageErrors.join("\n")); return; }
        for (const [index, source] of sources.entries()) {
          if (owner.closed) break;
          owner.stageStatus = `Reading ${index + 1}/${sources.length}: ${typeof source === "string" ? source : source.name}`; footer();
          try {
            validate();
            const external = Boolean(options.entries);
            const entry = external ? source : typeof source === "string" ?
              await api("/api/workbench/images/open", {method: "POST", payload: {url: source}}) :
              await api("/api/workbench/uploads", {method: "POST", raw: source, filename: source.name});
            if (!external) { owner.owned.add(entry.id); sessionStorage.setItem(`workbench-${entry.id}`, "image-editor"); }
            const photo = {entry, file: typeof source === "object" && !external ? source : null, versions: [], image: null};
            owner.photos.push(photo);
            photo.versions.push(version(photo, false));
            if (entry.source_url) {
              photo.versions[0].enabled = false;
              photo.versions.push(version(photo, true));
            }
            if (!owner.version) select(0);
            thumbnails();
            navigation();
            if (!owner.closed) for (const v of photo.versions) if (v.enabled) schedule(photo, v, true);
          } catch (failure) {
            if (!owner.closed) { owner.stageErrors.push(`Could not prepare ${source.name || source}: ${failure.message}`); error(owner.stageErrors.join("\n")); }
          }
        }
      })().finally(() => { owner.staging = false; if (model === owner && !owner.closed) controls(); });
      return done;
    }

    get("close").addEventListener("click", () => { close().catch(failure => error(failure.message)); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!model?.saving) close().catch(failure => error(failure.message)); });
    get("save").addEventListener("click", save);
    get("refresh").addEventListener("click", () => { const photo = currentPhoto(), v = currentVersion(); if (photo && v && !v.saved && !v.cropError) { schedule(photo, v, true); select(model.index, v.key); } });
    get("approve").addEventListener("change", footer);
    get("back").addEventListener("click", () => { model.review = false; get("edit").hidden = false; get("review").hidden = true; controls(); });
    get("previous").addEventListener("click", () => select(model.index - 1));
    get("next").addEventListener("click", () => select(model.index + 1));
    get("versions").addEventListener("change", () => select(model.index, get("versions").value));
    get("keep").addEventListener("change", () => {
      const photo = currentPhoto(), v = photo.versions[0]; v.enabled = get("keep").checked;
      if (v.enabled) schedule(photo, v, true); else discardVersion(v);
      thumbnails(); controls();
    });
    for (const id of ["create", "duplicate"]) get(id).addEventListener("click", () => {
      finishDrag();
      if (outputs().length >= 200 || currentPhoto().versions.length >= 20) { error("This batch allows 200 selected outputs and 20 versions per photo. Remove a version or omit an unedited output first."); return; }
      const photo = currentPhoto(), old = currentVersion(), v = version(photo, true, id === "duplicate" ? old.edit : null);
      if (id === "duplicate") Object.assign(v, {width: old.width, height: old.height, quality: old.quality, ratio: old.ratio});
      photo.versions.push(v); select(model.index, v.key); schedule(photo, v, true);
    });
    get("remove").addEventListener("click", () => {
      finishDrag();
      const photo = currentPhoto(), v = currentVersion(); discardVersion(v);
      photo.versions = photo.versions.filter(item => item !== v);
      select(model.index); footer();
    });
    for (const id of ["name", "width", "height", "quality", "mode", "brightness", "contrast", "saturation", "warmth"]) {
      get(id).addEventListener(id === "mode" ? "change" : "input", () => {
        const photo = currentPhoto(), v = currentVersion();
        if (!v || model.saving || v.saved) return;
        if (["brightness", "contrast", "saturation", "warmth"].includes(id)) {
          v.edit[id] = Number(get(id).value); get(id + "-value").textContent = id === "warmth" ? v.edit[id] : `${v.edit[id]}%`;
        } else v[id] = ["width", "height", "quality"].includes(id) ? Number(get(id).value) : get(id).value;
        if (id === "mode") controls();
        schedule(photo, v);
      });
    }
    function ratio() {
      const photo = currentPhoto(), v = currentVersion();
      if (v.edit.shape === "circle") return 1;
      return v.ratio === "source" ? photo.entry.width / photo.entry.height : v.ratio === "free" ? null : Number(v.ratio);
    }
    for (const id of ["shape", "ratio"]) get(id).addEventListener("change", () => {
      const photo = currentPhoto(), v = currentVersion(), b = v.edit.crop;
      v.cropError = "";
      if (id === "shape") v.edit.shape = get(id).value; else v.ratio = get(id).value;
      const r = ratio();
      if (r) {
        const width = Math.min(b[2]-b[0], (b[3]-b[1])*r);
        const percent = 100*width/Math.min(photo.entry.width, photo.entry.height*r);
        v.edit.crop = imageGeometry.fit(photo.entry.width, photo.entry.height, r, percent, (b[0]+b[2])/2, (b[1]+b[3])/2);
      }
      controls(); schedule(photo, v);
    });
    for (const id of ["crop-x", "crop-y", "crop-width", "crop-height"]) get(id).addEventListener("change", () => {
      const photo = currentPhoto(), v = currentVersion(), entry = photo.entry;
      let x = Math.round(Number(get("crop-x").value)), y = Math.round(Number(get("crop-y").value));
      let w = Math.round(Number(get("crop-width").value)), h = Math.round(Number(get("crop-height").value));
      if (["crop-x", "crop-y", "crop-width", "crop-height"].some(key => !String(get(key).value).trim()) || ![x,y,w,h].every(Number.isFinite) || w < 1 || h < 1) {
        v.cropError = "Enter valid pixel coordinates and positive crop dimensions.";
        v.cropInputs = Object.fromEntries(["crop-x", "crop-y", "crop-width", "crop-height"].map(key => [key, get(key).value]));
        model.previewErrorKey = v.key; error(v.cropError); invalidate(v); return;
      }
      v.cropError = "";
      const r = ratio();
      if (r) { if (id === "crop-height") w = Math.round(h*r); else h = Math.round(w/r); }
      w = Math.min(entry.width, w); h = Math.min(entry.height, h);
      if (r) { w = Math.min(w, Math.round(h*r)); h = r === 1 ? w : Math.max(1, Math.round(w/r)); }
      x = Math.max(0, Math.min(entry.width-w, x)); y = Math.max(0, Math.min(entry.height-h, y));
      v.edit.crop = [x,y,x+w,y+h]; cropFields(); draw(); schedule(photo,v);
    });
    get("reset").addEventListener("click", () => {
      const photo = currentPhoto(), v = currentVersion();
      v.edit = {crop: [0,0,photo.entry.width,photo.entry.height], shape:"rectangle",brightness:100,contrast:100,saturation:100,warmth:0};
      v.ratio = "free"; v.cropError = ""; controls(); schedule(photo,v);
    });
    let drag = null;
    function finishDrag() {
      if (!drag) return;
      const {photo, v, changed} = drag; drag = null;
      if (changed) schedule(photo, v);
    }
    function point(event) {
      const photo = currentPhoto(), canvas = get("canvas"), rect = canvas.getBoundingClientRect(), g = photo.geometry;
      return [( (event.clientX-rect.left)*canvas.width/rect.width-g.x)/g.scale,
              ( (event.clientY-rect.top)*canvas.height/rect.height-g.y)/g.scale];
    }
    get("canvas").addEventListener("pointerdown", event => {
      const photo = currentPhoto(), v = currentVersion();
      if (!v?.edited || v.saved || v.cropError || model.saving || model.closing || !photo.geometry) return;
      const p = point(event), box = v.edit.crop;
      const tolerance = 16 * get("canvas").width / get("canvas").getBoundingClientRect().width / photo.geometry.scale;
      const corners = [[box[0],box[1]], [box[2],box[1]], [box[0],box[3]], [box[2],box[3]]];
      const corner = corners.findIndex(c => Math.hypot(c[0]-p[0],c[1]-p[1]) < tolerance);
      drag = {photo,v,point:p,box:[...box],corner};
      get("canvas").setPointerCapture(event.pointerId); event.preventDefault();
    });
    get("canvas").addEventListener("pointermove", event => {
      if (!drag || model.saving) return;
      const p = point(event), {entry} = drag.photo, box = drag.box;
      if (drag.corner < 0) drag.v.edit.crop = imageGeometry.move(box,p[0]-drag.point[0],p[1]-drag.point[1],entry.width,entry.height);
      else {
        const left = drag.corner % 2 === 0, top = drag.corner < 2;
        const ax = left ? box[2] : box[0], ay = top ? box[3] : box[1];
        let w = Math.max(1, Math.min(Math.abs(p[0]-ax), left ? ax : entry.width-ax));
        let h = Math.max(1, Math.min(Math.abs(p[1]-ay), top ? ay : entry.height-ay));
        const r = ratio();
        if (r) { w = Math.min(w,h*r); h = w/r; }
        w = Math.max(1,Math.round(w)); h = r === 1 ? w : Math.max(1,Math.round(h));
        drag.v.edit.crop = [left ? ax-w : ax, top ? ay-h : ay, left ? ax : ax+w, top ? ay : ay+h];
      }
      if (drag.v.edit.crop.some((value, index) => value !== drag.box[index])) {
        if (!drag.changed) invalidate(drag.v);
        drag.changed = true;
      }
      cropFields(); draw();
    });
    for (const event of ["pointerup", "pointercancel"]) get("canvas").addEventListener(event, () => {
      finishDrag();
    });
    window.workbenchImages = {open, supports: url => /\.(?:jpe?g|png|webp)$/i.test(url),
      get pending() { return Boolean(model); }};
    window.addEventListener("workbench-before-git", event => {
      if (model) event.detail.busy.push("Finish or cancel the open image editor before Git operations or an editor restart.");
    });
    window.addEventListener("beforeunload", event => {
      if (model && !model.closed) { event.preventDefault(); event.returnValue = ""; }
    });
  })();
}
