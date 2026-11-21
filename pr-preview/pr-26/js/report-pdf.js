"use strict";

(() => {
  const width = 475.28;
  if (typeof document === "undefined") {
    self.addEventListener("message", async ({ data }) => {
      try {
        importScripts(data.pdfmake, data.fonts);
        self.postMessage({ state: "layout" });
        const blob = await pdfBlob(documentDefinition(data.content, data.logo, data.metadata));
        self.postMessage({ blob });
      } catch (error) {
        self.postMessage({ error: error.message || String(error) });
      }
    });
    return;
  }
  const button = document.querySelector("#report-pdf-download");
  if (!button) return;
  const status = document.querySelector("#report-pdf-status");
  const dialog = document.querySelector("#report-pdf-dialog");
  const retry = document.querySelector("#report-pdf-retry");
  const spinner = document.querySelector("#report-pdf-spinner");
  const scripts = new Map();
  let active = null;

  function loadScript(url) {
    if (scripts.has(url)) return scripts.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => fail(), 30000);
      function fail() {
        clearTimeout(timer);
        script.remove();
        scripts.delete(url);
        reject(new Error(`Nem tölthető be a PDF-eszköz: ${url}`));
      }
      script.src = url;
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = fail;
      document.head.append(script);
    });
    scripts.set(url, promise);
    return promise;
  }

  async function imageData(url, transparent = false, signal) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 30000);
    let objectURL;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      objectURL = URL.createObjectURL(blob);
      const image = new Image();
      image.src = objectURL;
      await image.decode();
      signal.throwIfAborted();
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("A böngésző nem támogatja a képfeldolgozást.");
      if (!transparent) { context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (transparent) {
        context.globalCompositeOperation = "source-in";
        context.fillStyle = "#222222";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      return canvas.toDataURL(transparent ? "image/png" : "image/jpeg", 0.9);
    } catch (error) {
      throw new Error(`Nem készíthető PDF, mert egy kép nem olvasható: ${url}. ${error.message}`);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (objectURL) URL.revokeObjectURL(objectURL);
    }
  }

  function replaceTag(element, name) {
    const replacement = document.createElement(name);
    replacement.className = element.className;
    replacement.append(...element.childNodes);
    element.replaceWith(replacement);
    return replacement;
  }

  function markChapters(copy) {
    const chapters = [...copy.querySelectorAll("h1, h2")];
    for (const [index, heading] of chapters.entries()) {
      const range = document.createRange();
      range.setStartAfter(heading);
      if (chapters[index + 1]) range.setEndBefore(chapters[index + 1]);
      else range.setEnd(copy, copy.childNodes.length);
      const chapter = range.cloneContents();
      const words = chapter.textContent.trim().split(/\s+/).filter(Boolean).length;
      heading.dataset.reportChapterId = `report-pdf-chapter-${index}-${words >= 220 || chapter.querySelector("img") ? "long" : "short"}`;
    }
  }

  async function reportHTML(source, signal) {
    const copy = source.cloneNode(true);
    const faq = document.querySelector(".ftsk-article-faq");
    if (faq) copy.append(faq.cloneNode(true));
    // Interactive viewers become links; their external document is not the Markdown report.
    for (const viewer of copy.querySelectorAll(".ftsk-pdf-embed")) {
      const link = viewer.querySelector("a[href]");
      if (!link) throw new Error("A beágyazott PDF letöltési hivatkozása hiányzik.");
      const paragraph = document.createElement("p");
      paragraph.append(link.cloneNode(true));
      viewer.replaceWith(paragraph);
    }
    for (const element of copy.querySelectorAll("script, style, iframe, video, audio, button, .ph")) element.remove();
    for (const image of copy.querySelectorAll("img")) {
      const figure = image.closest(".ftsk-article-figure");
      const percent = parseFloat(figure?.style.getPropertyValue("--article-image-width") || "100");
      image.dataset.reportWidth = Number.isFinite(percent) && percent >= 10 && percent <= 100 ? percent : 100;
    }
    for (const element of [copy, ...copy.querySelectorAll("*")]) {
      element.removeAttribute("style");
      element.removeAttribute("data-pdfmake");
      element.removeAttribute("data-pdfmake-type");
      element.removeAttribute("width");
      element.removeAttribute("height");
    }
    for (const galleryItem of copy.querySelectorAll(".ftsk-gallery-item")) {
      galleryItem.removeAttribute("href");
      replaceTag(galleryItem, "figure");
    }
    for (const caption of copy.querySelectorAll(".ftsk-gallery-caption")) replaceTag(caption, "figcaption");
    for (const element of copy.querySelectorAll("figure, section, details")) replaceTag(element, "div");
    for (const element of copy.querySelectorAll("figcaption, summary")) replaceTag(element, "p");
    for (const anchor of copy.querySelectorAll("a[href]")) {
      const url = new URL(anchor.getAttribute("href"), location.href);
      if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
        anchor.removeAttribute("href");
      } else anchor.setAttribute("href", url.href);
      if (anchor.querySelector("img")) {
        anchor.removeAttribute("href");
        replaceTag(anchor, "div");
      }
    }
    const images = new Map();
    for (const image of copy.querySelectorAll("img")) {
      signal.throwIfAborted();
      const url = new URL(image.getAttribute("src"), location.href).href;
      if (!images.has(url)) images.set(url, await imageData(url, false, signal));
      image.src = images.get(url);
    }
    for (const block of [copy, ...copy.querySelectorAll("div, ul, ol, table, thead, tbody, tr")]) {
      for (const child of [...block.childNodes]) {
        if (child.nodeType === 3 && !child.textContent.trim()) child.remove();
      }
    }
    markChapters(copy);
    return copy.innerHTML;
  }

  function convertReport(html, metadata) {
    const gap = Number(metadata.spacing);
    if (!Number.isFinite(gap) || gap < 0 || gap > 4 ||
        !["left", "right", "center", "justify"].includes(metadata.alignment)) {
      throw new Error("A beszámoló bekezdésbeállításai érvénytelenek.");
    }
    return window.htmlToPdfmake(html, {
      window,
      defaultStyles: {
        p: { margin: [0, 0, 0, gap * 12], alignment: metadata.alignment },
        h1: { fontSize: 22, bold: true, color: "#222222", margin: [0, 0, 0, 14] },
        h2: { fontSize: 18, bold: true, color: "#222222", margin: [0, 0, 0, 14] },
        h3: { fontSize: 14, bold: true, color: "#222222", margin: [0, 16, 0, 8] },
        h4: { fontSize: 12, bold: true, margin: [0, 14, 0, 8] },
        a: { color: "#222222", decoration: "underline" },
        ul: { margin: [12, 0, 0, 12] }, ol: { margin: [12, 0, 0, 12] },
        li: { margin: [0, 0, 0, 4] },
        blockquote: { margin: [18, 8, 18, 12], italics: true, color: "#555555" },
        table: { margin: [0, 8, 0, 14] },
        th: { bold: true, fillColor: "#f2f2f2" }
      },
      customTag({ element, ret }) {
        if (!ret.image && !ret.svg) {
          ret.color = "#222222";
          if (ret.fillColor) ret.fillColor = "#f2f2f2";
        }
        if (/^H[1-6]$/.test(element.tagName)) {
          ret.headlineLevel = Number(element.tagName[1]);
          if (element.dataset.reportChapterId) ret.id = element.dataset.reportChapterId;
        }
        if (element.tagName === "IMG") {
          ret.fit = [width * Number(element.dataset.reportWidth || 100) / 100, 440];
          ret.alignment = "center";
          ret.margin = [0, 10, 0, 8];
        }
        if (element.tagName === "HR") {
          ret.canvas[0].x2 = width;
          ret.canvas[0].lineColor = "#888888";
        }
        if (element.classList.contains("ftsk-signature")) ret.alignment = "right";
        if (element.classList.contains("ftsk-article-figure") || element.classList.contains("ftsk-gallery-item")) {
          ret.unbreakable = true;
          ret.margin = [0, 8, 0, 14];
        }
        if (element.classList.contains("ftsk-gallery-caption") || element.tagName === "P" &&
            element.parentElement?.classList.contains("ftsk-article-figure")) {
          ret.fontSize = 9;
          ret.color = "#666666";
          ret.italics = true;
          ret.alignment = "center";
        }
        return ret;
      }
    });
  }

  function documentDefinition(content, logo, metadata) {
    // Trailing margins can push pdfmake onto an otherwise empty final page.
    function removeTrailingGap(nodes) {
      const node = nodes.at(-1);
      if (!node || typeof node !== "object") return;
      const margin = node.margin;
      if (Array.isArray(margin)) node.margin = [margin[0], margin[1], margin.length === 4 ? margin[2] : margin[0], 0];
      else if (typeof margin === "number") node.margin = [margin, margin, margin, 0];
      node.marginBottom = 0;
      const children = node.stack || node.ul || node.ol;
      if (Array.isArray(children)) removeTrailingGap(children);
    }
    removeTrailingGap(content);
    return {
      pageSize: "A4",
      pageMargins: [60, 64, 60, 62],
      info: { title: metadata.title, author: metadata.author, subject: "FTSK Barlangkutató Szakosztály – Túrabeszámoló" },
      defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.45, color: "#222222" },
      content: [
        {
          stack: [
            { image: logo, fit: [230, 250], alignment: "center", margin: [0, 35, 0, 26] },
            { text: metadata.title, fontSize: 26, bold: true, color: "#222222", alignment: "center", margin: [0, 0, 0, 24] },
            { canvas: [{ type: "line", x1: width / 2 - 45, y1: 0, x2: width / 2 + 45, y2: 0, lineWidth: 1.5, lineColor: "#888888" }], margin: [0, 0, 0, 24] },
            { text: metadata.author || "Szerző nincs megadva", fontSize: 13, alignment: "center", margin: [0, 0, 0, 8] },
            { text: metadata.date, fontSize: 11, color: "#666666", alignment: "center", margin: [0, 0, 0, 45] },
            { text: "FTSK Barlangkutató Szakosztály", fontSize: 14, bold: true, alignment: "center" },
            { text: "TÚRABESZÁMOLÓ", fontSize: 9, characterSpacing: 2, color: "#666666", alignment: "center", margin: [0, 10, 0, 0] }
          ],
          pageBreak: "after"
        },
        ...content
      ],
      header(page) {
        return page === 1 ? null : { id: "report-pdf-running-header", text: metadata.title, margin: [60, 28, 60, 0], fontSize: 8, color: "#666666" };
      },
      footer(page, pages) {
        return page === 1 ? null : {
          id: "report-pdf-running-footer",
          columns: [
            { id: "report-pdf-running-organization", text: "FTSK Barlangkutató Szakosztály", width: "*" },
            { id: "report-pdf-running-page", text: `${page - 1} / ${pages - 1}`, alignment: "right" }
          ],
          margin: [60, 20, 60, 0], fontSize: 8, color: "#666666"
        };
      },
      pageBreakBefore(node, following, next, previous) {
        if (!node.headlineLevel) return false;
        const bodyContent = item => {
          if (item.id?.startsWith("report-pdf-running-")) return false;
          const text = typeof item.text === "string" ? item.text.trim() : item.text;
          return Boolean(text || item.image || item.table || item.ul || item.ol || item.svg);
        };
        if (node.headlineLevel <= 2) {
          const awayFromTop = node.startPosition.verticalRatio > 0;
          if (node.id?.endsWith("-long")) return awayFromTop;
          const nextChapter = following.findIndex(item => item.headlineLevel <= 2);
          const chapter = nextChapter < 0 ? following : following.slice(0, nextChapter);
          const opening = chapter.find(item => !item.headlineLevel && bodyContent(item));
          const splitOpening = opening?.pageNumbers?.some(page => page > node.startPosition.pageNumber);
          return awayFromTop && (!opening || splitOpening && node.startPosition.verticalRatio > 0.75);
        }
        return previous.some(bodyContent) && !following.some(bodyContent);
      }
    };
  }

  function pdfBlob(definition) {
    // All fonts and images are already local/in-memory. The synchronous stream API
    // exposes layout and stream errors, unlike 0.2.x's callback-only getBlob().
    return new Promise((resolve, reject) => {
      const stream = globalThis.pdfMake.createPdf(definition).getStream();
      const chunks = [];
      stream.on("data", chunk => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(new Blob(chunks, { type: "application/pdf" })));
      stream.end();
    });
  }

  function message(text, error = false) {
    status.hidden = false;
    status.textContent = text;
    status.dataset.error = String(error);
  }

  function cancelGeneration() {
    if (!active) return;
    const job = active;
    active = null;
    job.controller.abort();
    job.worker?.terminate();
    job.worker = null;
    if (job.bootstrap) URL.revokeObjectURL(job.bootstrap);
    job.bootstrap = "";
    job.reject?.(new DOMException("PDF generation cancelled.", "AbortError"));
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }

  function workerPDF(job, content, logo, metadata) {
    return new Promise((resolve, reject) => {
      job.reject = reject;
      const source = new URL(button.dataset.worker, location.href).href;
      job.bootstrap = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(source)});`], { type: "application/javascript" }));
      job.worker = new Worker(job.bootstrap, { name: "FTSK report PDF" });
      job.worker.onerror = event => reject(new Error(event.message || "A PDF-munkafolyamat nem indult el."));
      job.worker.onmessage = ({ data }) => {
        if (active !== job) return;
        if (data.error) reject(new Error(data.error));
        else if (data.state === "layout") message("PDF tördelése…");
        else if (data.blob instanceof Blob) resolve(data.blob);
      };
      job.worker.postMessage({
        content, logo, metadata,
        pdfmake: new URL(button.dataset.pdfmake, location.href).href,
        fonts: new URL(button.dataset.fonts, location.href).href
      });
    });
  }

  async function startGeneration() {
    if (active) return;
    const job = { controller: new AbortController(), worker: null, bootstrap: "", reject: null };
    active = job;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    retry.hidden = true;
    spinner.hidden = false;
    if (!dialog.open) dialog.showModal();
    message("A beszámoló előkészítése…");
    try {
      await loadScript(button.dataset.converter);
      job.controller.signal.throwIfAborted();
      if (typeof window.htmlToPdfmake !== "function") throw new Error("A PDF-eszköz nem indult el.");
      const source = document.querySelector(".ftsk-trip-report-content");
      if (!source) throw new Error("A beszámoló szövege nem található.");
      const html = await reportHTML(source, job.controller.signal);
      const logo = await imageData(button.dataset.logo, true, job.controller.signal);
      job.controller.signal.throwIfAborted();
      const metadata = Object.fromEntries(["title", "author", "date", "spacing", "alignment"].map(key => [key, button.dataset[key]]));
      const blob = await workerPDF(job, convertReport(html, metadata), logo, metadata);
      job.controller.signal.throwIfAborted();
      if (!blob.size) throw new Error("Üres PDF készült.");
      const url = URL.createObjectURL(blob);
      const download = document.createElement("a");
      download.href = url;
      download.download = `${button.dataset.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 150) || "FTSK-beszamolo"}.pdf`;
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      dialog.close();
    } catch (error) {
      if (job.controller.signal.aborted) return;
      console.error("Report PDF download failed:", error);
      spinner.hidden = true;
      retry.hidden = false;
      message(`A PDF nem készíthető el. ${error.message}`, true);
    } finally {
      job.worker?.terminate();
      if (job.bootstrap) URL.revokeObjectURL(job.bootstrap);
      if (active === job) {
        active = null;
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    }
  }

  function closeDialog() {
    cancelGeneration();
    dialog.close();
  }
  button.addEventListener("click", startGeneration);
  retry.addEventListener("click", startGeneration);
  document.querySelector("#report-pdf-close").addEventListener("click", closeDialog);
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
    }
  });
  dialog.addEventListener("cancel", cancelGeneration);
  dialog.addEventListener("close", () => { if (!dialog.open) cancelGeneration(); });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
    }
  });
})();
