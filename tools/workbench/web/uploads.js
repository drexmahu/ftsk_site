"use strict";

const uploadPreviewBindings = new Map();

function renderUploadPreviews(input, entries = null, remove = null) {
  let binding = uploadPreviewBindings.get(input);
  if (!binding) {
    const label = input.closest(".dropzone");
    label.closest(".panel, .media-converter")?.classList.add("converter-panel");
    const shell = node("div", "", "upload-drop-area");
    label.before(shell);
    shell.append(label);
    const gallery = node("div", "", "upload-previews");
    gallery.setAttribute("aria-label", "Pending photos");
    shell.append(gallery);
    binding = { gallery, urls: [] };
    uploadPreviewBindings.set(input, binding);
  }
  binding.urls.forEach(url => URL.revokeObjectURL(url));
  binding.urls = [];
  binding.gallery.replaceChildren();
  const files = Array.from(input.files || []);
  const previews = entries || files.map(file => {
    const url = URL.createObjectURL(file);
    binding.urls.push(url);
    return { name: file.name, url };
  });
  binding.gallery.hidden = !previews.length;
  for (const [index, entry] of previews.entries()) {
    const card = node("div", "", "upload-preview");
    card.classList.toggle("selected", Boolean(entry.selected));
    const image = node("img");
    image.src = entry.url;
    image.alt = entry.name;
    image.addEventListener("error", () => {
      image.hidden = true;
      card.classList.add("preview-unavailable");
      image.after(node("small", "Preview unavailable for this format"));
    }, { once: true });
    const name = node("span", entry.name, "upload-preview-name");
    name.title = entry.name;
    const cancel = node("button", "\u00d7", "upload-preview-cancel");
    cancel.type = "button";
    cancel.title = `Remove pending photo: ${entry.name}`;
    cancel.setAttribute("aria-label", cancel.title);
    cancel.disabled = input.disabled || state.busy || Boolean(window.memberEditor?.busy);
    cancel.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (cancel.disabled || input.matches(":disabled") || state.busy || window.memberEditor?.busy) return;
      if (remove) remove(index);
      else {
        const transfer = new DataTransfer();
        files.forEach((file, position) => { if (position !== index) transfer.items.add(file); });
        input.files = transfer.files;
        const previousURLs = binding.urls;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        if (binding.urls === previousURLs) renderUploadPreviews(input);
      }
    });
    card.append(image, name, cancel);
    if (entry.choose) {
      const choose = node("button", "Choose crop", "secondary");
      choose.type = "button";
      choose.disabled = cancel.disabled;
      choose.addEventListener("click", () => {
        if (!choose.disabled && !input.matches(":disabled")) entry.choose();
      });
      card.append(choose);
    }
    binding.gallery.append(card);
  }
}

window.addEventListener("pagehide", () => {
  for (const binding of uploadPreviewBindings.values()) binding.urls.forEach(url => URL.revokeObjectURL(url));
});

window.workbenchUploads = { render: renderUploadPreviews };

document.querySelectorAll('[data-panel="photos"] .settings, #crop-panel').forEach(panel => panel.classList.add("converter-panel"));
