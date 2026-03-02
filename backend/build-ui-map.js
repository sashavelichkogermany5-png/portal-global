const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function norm(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function isNavButton(item) {
  if (item.kind !== "button") return false;
  const cls = (item.attrs?.class || "").toLowerCase();
  // твои кнопки меню: nav-btn
  return cls.includes("nav-btn");
}

function guessSection(item) {
  // 1) по тексту кнопки
  const t = norm(item.text).toLowerCase();
  const known = ["dashboard","projects","ai","orders","pricing","clients","providers","compliance","account","cabinet"];
  for (const k of known) if (t.includes(k)) return k;

  // 2) по href
  const h = norm(item.href).toLowerCase();
  for (const k of known) if (h.includes("/" + k) || h.includes(k)) return k;

  // 3) по data-*
  const attrs = item.attrs || {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("data-")) {
      const vv = norm(v).toLowerCase();
      for (const name of known) if (vv.includes(name)) return name;
    }
  }
  return "other";
}

function mdEscape(s) {
  return norm(s).replace(/\|/g, "\\|");
}

function main() {
  const invPath = path.join(process.cwd(), "ui-inventory.json");
  if (!fs.existsSync(invPath)) {
    console.error("Missing ui-inventory.json in:", process.cwd());
    process.exit(1);
  }

  const items = readJson(invPath);

  // Группируем по файлу
  const byFile = new Map();
  for (const it of items) {
    const f = it.file || "unknown";
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(it);
  }

  // Собираем nav-меню (по всем файлам)
  const nav = items.filter(isNavButton).map((x) => ({
    text: norm(x.text),
    file: x.file,
    selector: x.selector,
    class: x.attrs?.class || ""
  }));

  // Группируем по секциям (по эвристике)
  const bySection = new Map();
  for (const it of items) {
    const sec = guessSection(it);
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec).push(it);
  }

  // Markdown
  let md = "";
  md += `# PORTAL UI Map\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Total unique UI items: **${items.length}**\n\n`;

  // Меню
  md += `## Navigation (main sections)\n\n`;
  if (nav.length) {
    md += `| Text | File | Selector |\n|---|---|---|\n`;
    for (const n of nav) {
      md += `| ${mdEscape(n.text)} | ${mdEscape(n.file)} | ${mdEscape(n.selector)} |\n`;
    }
    md += `\n`;
  } else {
    md += `No nav buttons detected.\n\n`;
  }

  // Секции
  const sectionOrder = ["dashboard","projects","ai","orders","pricing","clients","providers","compliance","account","cabinet","other"];
  md += `## Sections (buttons/links/forms/inputs)\n\n`;
  for (const sec of sectionOrder) {
    const arr = bySection.get(sec) || [];
    if (!arr.length) continue;
    md += `### ${sec.toUpperCase()} (${arr.length})\n\n`;
    md += `| Kind | Text | Href | File | Selector | id | class |\n|---|---|---|---|---|---|---|\n`;
    for (const it of arr) {
      const kind = mdEscape(it.kind);
      const text = mdEscape(it.text);
      const href = mdEscape(it.href);
      const file = mdEscape(it.file);
      const sel = mdEscape(it.selector);
      const id = mdEscape(it.attrs?.id);
      const cls = mdEscape(it.attrs?.class);
      md += `| ${kind} | ${text} | ${href} | ${file} | ${sel} | ${id} | ${cls} |\n`;
    }
    md += `\n`;
  }

  // По файлам (кратко)
  md += `## Files (counts)\n\n`;
  md += `| File | Items |\n|---|---:|\n`;
  for (const [f, arr] of byFile.entries()) {
    md += `| ${mdEscape(f)} | ${arr.length} |\n`;
  }
  md += `\n`;

  // JSON summary
  const summary = {
    generatedAt: new Date().toISOString(),
    total: items.length,
    nav,
    countsByFile: Object.fromEntries([...byFile.entries()].map(([f, arr]) => [f, arr.length])),
    countsBySection: Object.fromEntries(sectionOrder.map((s) => [s, (bySection.get(s) || []).length])),
  };

  fs.writeFileSync(path.join(process.cwd(), "ui-map.md"), md, "utf8");
  fs.writeFileSync(path.join(process.cwd(), "ui-summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log("Saved: ui-map.md");
  console.log("Saved: ui-summary.json");
  console.log("Done.");
}

main();
