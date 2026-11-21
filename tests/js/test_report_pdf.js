"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pdfMake = require("pdfmake/build/pdfmake");
pdfMake.addVirtualFileSystem(require("pdfmake/build/vfs_fonts"));
const source = fs.readFileSync(path.join(__dirname, "../../static/js/report-pdf.js"), "utf8");
const convertStart = source.indexOf("  function convertReport(");
const definitionStart = source.indexOf("  function documentDefinition(");
const blobStart = source.indexOf("  function pdfBlob(");
const blobEnd = source.indexOf("  function message(");
let options;
const convert = vm.runInNewContext(`(${source.slice(convertStart, definitionStart).trim()})`, {
  window: { htmlToPdfmake: (html, configuration) => {
    options = configuration;
    return [{ text: "Árvíztűrő tükörfúrógép. **Magyar beszámoló**", margin: configuration.defaultStyles.p.margin,
      alignment: configuration.defaultStyles.p.alignment },
    { text: "Final paragraph", margin: configuration.defaultStyles.p.margin }];
  } },
  width: 475.28,
});
const build = vm.runInNewContext(`(${source.slice(definitionStart, blobStart).trim()})`, { width: 475.28 });
const definition = (html, logo, metadata) => build(convert(html, metadata), logo, metadata);
const blob = vm.runInNewContext(`(${source.slice(blobStart, blobEnd).trim()})`, { pdfMake, Blob });
const logo = "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "../../static/images/ftsk-logo.png")).toString("base64");
const metadata = { title: "Őszi barlangtúra", author: "Teszt Szerző", date: "2026. november 21.", spacing: "1.5", alignment: "justify" };

async function main() {
  const markerStart = source.indexOf("  function markChapters(");
  const markerEnd = source.indexOf("  async function reportHTML(", markerStart);
  const mark = vm.runInNewContext(`(${source.slice(markerStart, markerEnd).trim()})`, {
    document: { createRange: () => {
      let heading;
      return {
        setStartAfter: element => { heading = element; },
        setEndBefore() {}, setEnd() {},
        cloneContents: () => ({ textContent: Array(heading.words).fill("word").join(" "),
          querySelector: () => heading.photo ? {} : null })
      };
    } }
  });
  const headings = [{ words: 0 }, { words: 219 }, { words: 220 }, { words: 1, photo: true }]
    .map(heading => ({ ...heading, dataset: {} }));
  mark({ querySelectorAll: () => headings, childNodes: [] });
  assert.deepEqual(headings.map(heading => heading.dataset.reportChapterId), [
    "report-pdf-chapter-0-short", "report-pdf-chapter-1-short", "report-pdf-chapter-2-long", "report-pdf-chapter-3-long"
  ], "Chapter classification must honor the exact threshold and photo exception");
  const doc = definition("<p>Story</p>", logo, metadata);
  assert.equal(doc.content[0].pageBreak, "after", "The cover must end before any body text");
  assert.equal(doc.content[1].alignment, "justify");
  assert.equal(doc.content[1].margin[3], 18, "1.5 rem must produce an 18 pt paragraph gap");
  assert.equal(doc.header(1), null);
  assert.equal(doc.footer(1, 3), null);
  assert.equal(doc.footer(2, 3).columns[1].text, "1 / 2");
  const prior = [{ text: "Prior chapter body" }];
  assert.equal(doc.pageBreakBefore({ id: "chapter-long", headlineLevel: 2, startPosition: { verticalRatio: 0.1 } }, [{ text: "Body paragraph" }], [], prior), true,
    "A major chapter always starts on a new page after preceding body text");
  assert.equal(doc.pageBreakBefore({ id: "chapter-long", headlineLevel: 2, startPosition: { verticalRatio: 0 } }, [{ text: "Body paragraph" }], [], []), false,
    "The first chapter must not add a blank page after the cover");
  assert.equal(doc.pageBreakBefore({ id: "chapter-short", headlineLevel: 2, startPosition: { verticalRatio: 0.2 } },
    [{ text: "Small opening paragraph", pageNumbers: [2] }], [], prior), false,
    "Small chapters should share a page when the opening text fits");
  assert.equal(doc.pageBreakBefore({ id: "chapter-short", headlineLevel: 2, startPosition: { verticalRatio: 0.9, pageNumber: 2 } },
    [{ text: "Split opening", pageNumbers: [2, 3] }], [], prior), true);
  assert.equal(doc.pageBreakBefore({ headlineLevel: 3 }, [{ text: "Body paragraph" }], [], prior), false);
  assert.equal(doc.pageBreakBefore({ headlineLevel: 3 }, [
    doc.header(2), ...doc.footer(2, 3).columns, { text: " " }
  ], [], prior), true, "Running page furniture must not keep an orphan heading on the page");
  assert.equal(doc.pageBreakBefore({ text: "Paragraph" }, [], [], prior), false);
  const node = options.customTag({ element: {
    tagName: "IMG", dataset: { reportWidth: "40" }, classList: { contains: () => false }
  }, ret: {} });
  assert(Math.abs(node.fit[0] - 190.112) < 0.001, "An explicitly sized photo must keep its width");
  for (const spacing of ["0", "4"]) {
    const modified = definition("", logo, { ...metadata, spacing });
    assert.equal(modified.content[1].margin[3], Number(spacing) * 12);
  }
  for (const change of [{ spacing: "-0.1" }, { spacing: "4.1" }, { spacing: "NaN" }, { alignment: "invalid" }]) {
    assert.throws(() => definition("", logo, { ...metadata, ...change }), /érvénytelenek/);
  }
  const generated = await blob(doc);
  assert(generated.size > 1000);
  const bytes = Buffer.from(await generated.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const chapterDefinition = definition("", logo, metadata);
  chapterDefinition.content = [
    chapterDefinition.content[0], { id: "first-long", text: "First chapter", headlineLevel: 2 }, { text: "First body paragraph" },
    { id: "second-long", text: "Second chapter", headlineLevel: 2 }, { text: "Second body paragraph" }
  ];
  const chapters = await blob(chapterDefinition);
  const chapterBytes = Buffer.from(await chapters.arrayBuffer()).toString("latin1");
  assert.equal((chapterBytes.match(/\/Type \/Page\b/g) || []).length, 3,
    "Two chapters need exactly two body pages, without a blank page after the cover");
  const shortDefinition = definition("", logo, metadata);
  shortDefinition.content = [
    shortDefinition.content[0], { id: "first-short", text: "First short chapter", headlineLevel: 2 }, { text: "First small paragraph" },
    { id: "second-short", text: "Second short chapter", headlineLevel: 2 }, { text: "Second small paragraph" }
  ];
  const shortPages = Buffer.from(await (await blob(shortDefinition)).arrayBuffer()).toString("latin1");
  assert.equal((shortPages.match(/\/Type \/Page\b/g) || []).length, 2,
    "Two short chapters must share one body page instead of leaving two mostly-empty pages");
  for (const nested of [false, true]) {
    const finalParagraph = { text: "Last body line", margin: [0, 690, 0, 18] };
    const finalContent = nested ? [{ stack: [finalParagraph], margin: [0, 0, 0, 12] }] : [finalParagraph];
    const finalGapPages = Buffer.from(await (await blob(build(finalContent, logo, metadata))).arrayBuffer()).toString("latin1");
    assert.equal((finalGapPages.match(/\/Type \/Page\b/g) || []).length, 2,
      "Spacing after the final paragraph or figure must not create an empty last page");
  }
  const photoDefinition = definition("", logo, metadata);
  photoDefinition.content = [
    photoDefinition.content[0], { id: "first-long", text: "First chapter", headlineLevel: 2 }, { text: "First body paragraph" },
    { pageBreak: "before", unbreakable: true, stack: [
      { image: logo, fit: [200, 440] }, { text: "Photo caption" }
    ] },
    { id: "second-long", text: "Second chapter", headlineLevel: 2 }, { text: "Second body paragraph" }
  ];
  const photoPages = Buffer.from(await (await blob(photoDefinition)).arrayBuffer()).toString("latin1");
  assert.equal((photoPages.match(/\/Type \/Page\b/g) || []).length, 4,
    "A chapter following a moved unbreakable photo must still start on its own page");
  const gray = color => /^#([0-9a-f]{2})\1\1$/i.test(color);
  for (const style of Object.values(options.defaultStyles)) {
    if (style.color) assert(gray(style.color), `Text must be monochrome: ${style.color}`);
    if (style.fillColor) assert(gray(style.fillColor), `Shading must be monochrome: ${style.fillColor}`);
  }
  const colored = options.customTag({ element: {
    tagName: "SPAN", classList: { contains: () => false }
  }, ret: { color: "#ff0000", fillColor: "#0000ff" } });
  assert(gray(colored.color) && gray(colored.fillColor), "Inline HTML cannot reintroduce colored text");
  const failing = vm.runInNewContext(`(${source.slice(blobStart, blobEnd).trim()})`, {
    pdfMake: { createPdf: () => { throw new Error("Layout error"); } }, Blob
  });
  await assert.rejects(failing(doc), /Layout error/);
  const streamError = vm.runInNewContext(`(${source.slice(blobStart, blobEnd).trim()})`, {
    pdfMake: { createPdf: () => ({ getStream: () => {
      const handlers = {};
      return { on: (event, handler) => { handlers[event] = handler; }, end: () => handlers.error(new Error("Stream error")) };
    } }) }, Blob
  });
  await assert.rejects(streamError(doc), /Stream error/);

  function element() {
    return { dataset: {}, events: {}, addEventListener(event, handler) { this.events[event] = handler; },
      setAttribute() {}, removeAttribute() {} };
  }
  let attempts = 0;
  let fail = true;
  let pendingScript;
  const status = element();
  const button = element();
  button.dataset.converter = "/converter.js";
  const dialog = element();
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.events.close(); };
  const retry = element();
  const close = element();
  const fields = { "#report-pdf-download": button, "#report-pdf-status": status, "#report-pdf-dialog": dialog,
    "#report-pdf-retry": retry, "#report-pdf-close": close, "#report-pdf-spinner": element() };
  vm.runInNewContext(source, {
    document: {
      querySelector: selector => {
        assert(fields[selector], selector);
        return fields[selector];
      },
      createElement: () => ({ remove() {} }),
      head: { append: script => {
        attempts++;
        pendingScript = script;
        if (fail) queueMicrotask(() => script.onerror());
      } },
    },
    AbortController, DOMException, Map, Promise, setTimeout, clearTimeout,
    console: { error() {} }
  });
  await button.events.click();
  assert.equal(status.dataset.error, "true", "Dependency failures must be visible, never successful downloads");
  assert.equal(dialog.open, true);
  assert.equal(retry.hidden, false);
  assert.equal(button.disabled, false);
  await retry.events.click();
  assert.equal(attempts, 2, "Failed libraries must be loadable on retry");
  fail = false;
  const cancelledLoad = button.events.click();
  close.events.click();
  assert.equal(dialog.open, false);
  assert.equal(button.disabled, false);
  pendingScript.onload();
  await cancelledLoad;
  assert.equal(status.dataset.error, "false", "A late cancelled dependency must not show an error or restart generation");
  const keyboardLoad = button.events.click();
  dialog.events.keydown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  await keyboardLoad;
  assert.equal(dialog.open, false, "Escape must close the modal even if the browser does not issue a native cancel event");
  assert.equal(button.disabled, false);
  assert.equal(status.dataset.error, "false", "Escape must stop pending generation without displaying an error");

  let terminated = 0;
  let rejected;
  let revoked;
  const job = { controller: new AbortController(), worker: { terminate: () => { terminated++; } },
    bootstrap: "blob:worker", reject: error => { rejected = error; } };
  const cancelStart = source.indexOf("  function cancelGeneration(");
  const cancelEnd = source.indexOf("  function workerPDF(", cancelStart);
  const cancellation = vm.createContext({ active: job, button, DOMException,
    URL: { revokeObjectURL: url => { revoked = url; } } });
  vm.runInContext(source.slice(cancelStart, cancelEnd) + "\ncancelGeneration(); cancelGeneration();", cancellation);
  assert.equal(terminated, 1, "Closing must terminate the real PDF worker, not merely hide the modal");
  assert.equal(job.controller.signal.aborted, true);
  assert.equal(rejected.name, "AbortError");
  assert.equal(revoked, "blob:worker");
  assert.equal(cancellation.active, null);

  let handleWorker;
  const workerMessages = [];
  const workerContext = vm.createContext({
    self: { addEventListener: (event, handler) => { handleWorker = handler; }, postMessage: value => workerMessages.push(value) },
    importScripts() {}, pdfMake, Blob,
  });
  vm.runInContext(source, workerContext);
  await handleWorker({ data: { content: [{ text: "Worker body" }], metadata, logo, pdfmake: "/pdfmake.js", fonts: "/fonts.js" } });
  assert.equal(workerMessages[0].state, "layout");
  assert(workerMessages[1].blob.size > 1000, "The worker must produce a real PDF without DOM globals");
  workerContext.importScripts = () => { throw new Error("Worker dependency failure"); };
  await handleWorker({ data: {} });
  assert.equal(workerMessages.at(-1).error, "Worker dependency failure");
  console.log("PASS: Report PDF formatting, adaptive pages, monochrome fonts, worker output, modal retry and cancellation.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
