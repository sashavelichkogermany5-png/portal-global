const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function safeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function attr(el, name) {
  const v = el.getAttribute(name);
  return v === null ? undefined : v;
}

function pickAttrs(el) {
  const keep = [
    "id","class","type","name","value","placeholder",
    "href","src","alt","title","role","aria-label",
    "data-action","data-section","data-target","data-modal","data-tab"
  ];
  const out = {};
  for (const k of keep) {
    const v = attr(el, k);
    if (v !== undefined && v !== "") out[k] = v;
  }
  // собрать все data-*
  for (const a of Array.from(el.attributes || [])) {
    if (a.name.startsWith("data-") && out[a.name] === undefined) out[a.name] = a.value;
  }
  return out;
}

function getSelector(el) {
  if (!el) return "";
  const id = el.id ? `#${el.id}` : "";
  const cls = el.className && typeof el.className === "string"
    ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
    : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

function scanHtml(filePath) {
  const html = fs.readFileSync(filePath, "utf8");
  const dom = new JSDOM(html);
  const d = dom.window.document;

  const items = [];

  // кнопки
  d.querySelectorAll("button").forEach((el) => {
    items.push({
      kind: "button",
      file: path.basename(filePath),
      selector: getSelector(el),
      text: safeText(el.textContent),
      attrs: pickAttrs(el),
    });
  });

  // ссылки как кнопки/навигация
  d.querySelectorAll("a").forEach((el) => {
    const text = safeText(el.textContent);
    const href = attr(el, "href");
    // берём все ссылки, но отдельно можно фильтровать
    items.push({
      kind: "link",
      file: path.basename(filePath),
      selector: getSelector(el),
      text,
      href,
      attrs: pickAttrs(el),
    });
  });

  // формы
  d.querySelectorAll("form").forEach((el) => {
    items.push({
      kind: "form",
      file: path.basename(filePath),
      selector: getSelector(el),
      attrs: pickAttrs(el),
    });
  });

  // инпуты/textarea/select
  d.querySelectorAll("input, textarea, select").forEach((el) => {
    items.push({
      kind: el.tagName.toLowerCase(),
      file: path.basename(filePath),
      selector: getSelector(el),
      text: safeText(el.textContent),
      attrs: pickAttrs(el),
    });
  });

  // элементы с onclick
  d.querySelectorAll("[onclick]").forEach((el) => {
    items.push({
      kind: "onclick",
      file: path.basename(filePath),
      selector: getSelector(el),
      onclick: safeText(attr(el, "onclick")),
      text: safeText(el.textContent),
      attrs: pickAttrs(el),
    });
  });

  return items;
}

function main() {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    console.error("Usage: node extract-ui.js <file1.html> <file2.html> ...");
    process.exit(1);
  }

  let all = [];
  for (const fp of targets) {
    if (!fs.existsSync(fp)) {
      console.warn("Missing:", fp);
      continue;
    }
    try {
      all = all.concat(scanHtml(fp));
    } catch (e) {
      console.warn("Failed parsing:", fp, e.message);
    }
  }

  // группировка по kind + text + selector
  const key = (x) => `${x.kind}|${x.text || ""}|${x.href || ""}|${x.selector}`;
  const uniq = new Map();
  for (const it of all) uniq.set(key(it), it);
  const unique = Array.from(uniq.values());

  // Сохранить JSON
  const outJson = path.join(process.cwd(), "ui-inventory.json");
  fs.writeFileSync(outJson, JSON.stringify(unique, null, 2), "utf8");

  // Сохранить TXT (коротко)
  const outTxt = path.join(process.cwd(), "ui-inventory.txt");
  const lines = unique.map((x) => {
    const t = x.text ? ` "${x.text}"` : "";
    const h = x.href ? ` href=${x.href}` : "";
    const id = x.attrs?.id ? ` id=${x.attrs.id}` : "";
    const cls = x.attrs?.class ? ` class="${x.attrs.class}"` : "";
    return `[${x.kind}] ${x.file} :: ${x.selector}${t}${h}${id}${cls}`;
  });
  fs.writeFileSync(outTxt, lines.join("\n"), "utf8");

  console.log("Saved:", outJson);
  console.log("Saved:", outTxt);
  console.log("Total unique UI items:", unique.length);
}

main();
