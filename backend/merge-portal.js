const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function read(p) { return fs.readFileSync(p, "utf8"); }

function pickAll(doc, selector) {
  return Array.from(doc.querySelectorAll(selector)).map((x) => x.outerHTML).join("\n");
}

function replaceInnerHTML(doc, selector, newInnerHtml) {
  const el = doc.querySelector(selector);
  if (!el) return false;
  el.innerHTML = newInnerHtml;
  return true;
}

function main() {
  const targetPath = process.argv[2];
  const sourcePath = process.argv[3];

  if (!targetPath || !sourcePath) {
    console.error("Usage: node merge-portal.js <target.html> <source.html>");
    process.exit(1);
  }
  if (!fs.existsSync(targetPath)) { console.error("Target missing:", targetPath); process.exit(1); }
  if (!fs.existsSync(sourcePath)) { console.error("Source missing:", sourcePath); process.exit(1); }

  const targetDom = new JSDOM(read(targetPath));
  const sourceDom = new JSDOM(read(sourcePath));
  const targetDoc = targetDom.window.document;
  const sourceDoc = sourceDom.window.document;

  // styles
  const sourceStyles = pickAll(sourceDoc, "style");
  if (sourceStyles) {
    targetDoc.querySelectorAll("style").forEach((s) => s.remove());
    targetDoc.head.insertAdjacentHTML("beforeend", "\n" + sourceStyles + "\n");
  }

  // external scripts (cdn)
  const sourceScriptTags = Array.from(sourceDoc.querySelectorAll('script[src]'))
    .map((s) => s.outerHTML)
    .join("\n");
  if (sourceScriptTags) {
    targetDoc.querySelectorAll('script[src]').forEach((s) => s.remove());
    targetDoc.head.insertAdjacentHTML("beforeend", "\n" + sourceScriptTags + "\n");
  }

  // main content
  const sourceMain = sourceDoc.querySelector("main");
  if (sourceMain) {
    const ok = replaceInnerHTML(targetDoc, "main", sourceMain.innerHTML);
    if (!ok) targetDoc.body.insertAdjacentHTML("beforeend", "\n" + sourceMain.outerHTML + "\n");
  }

  // footer
  const sourceFooter = sourceDoc.querySelector("footer");
  if (sourceFooter) {
    const oldFooter = targetDoc.querySelector("footer");
    if (oldFooter) oldFooter.remove();
    targetDoc.body.insertAdjacentHTML("beforeend", "\n" + sourceFooter.outerHTML + "\n");
  }

  // inline scripts (logic)
  const sourceInlineScripts = Array.from(sourceDoc.querySelectorAll("script"))
    .filter((s) => !s.getAttribute("src"))
    .map((s) => s.textContent)
    .join("\n\n");

  targetDoc.querySelectorAll("script").forEach((s) => {
    if (!s.getAttribute("src")) s.remove();
  });

  if (sourceInlineScripts.trim()) {
    const scriptEl = targetDoc.createElement("script");
    scriptEl.textContent = sourceInlineScripts;
    targetDoc.body.appendChild(scriptEl);
  }

  // title
  const sourceTitle = sourceDoc.querySelector("title");
  if (sourceTitle) {
    let targetTitle = targetDoc.querySelector("title");
    if (!targetTitle) {
      targetTitle = targetDoc.createElement("title");
      targetDoc.head.appendChild(targetTitle);
    }
    targetTitle.textContent = sourceTitle.textContent;
  }

  const outPath = path.join(path.dirname(targetPath), "unified_portal_merged.html");
  fs.writeFileSync(outPath, targetDom.serialize(), "utf8");
  console.log("OK. Saved merged file:", outPath);
}

main();
