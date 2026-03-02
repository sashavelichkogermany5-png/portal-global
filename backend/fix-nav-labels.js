const fs = require("fs");
const { JSDOM } = require("jsdom");

const LABELS = [
  "📊 Dashboard",
  "🗂️ Projects",
  "🤖 AI",
  "📦 Orders",
  "💰 Pricing",
  "👥 Clients",
  "🧩 Providers",
  "⚖️ Compliance",
  "👤 Account",
  "🇷🇺 Cabinet",
];

function ensureMetaCharset(doc) {
  let meta = doc.querySelector('meta[charset]');
  if (!meta) {
    meta = doc.createElement("meta");
    meta.setAttribute("charset", "UTF-8");
    doc.head.prepend(meta);
  } else {
    meta.setAttribute("charset", "UTF-8");
  }
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node fix-nav-labels.js <htmlFile>");
    process.exit(1);
  }

  const html = fs.readFileSync(file, "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  ensureMetaCharset(doc);

  // собираем nav кнопки (и <button>, и <a>)
  const nav = Array.from(doc.querySelectorAll(".nav-btn"));
  if (!nav.length) {
    console.error("No .nav-btn found in:", file);
    process.exit(2);
  }

  // проставляем тексты по порядку появления
  for (let i = 0; i < nav.length && i < LABELS.length; i++) {
    nav[i].textContent = LABELS[i];
  }

  fs.writeFileSync(file, dom.serialize(), "utf8");
  console.log("OK: fixed nav labels in", file, "buttons:", nav.length);
}

main();
