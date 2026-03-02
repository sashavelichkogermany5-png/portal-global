const fs = require("fs");

function fixDoubleEncodedLatin1ToUtf8(text) {
  // text сейчас выглядит как "Г‘ВЂ..."
  // Берём каждый символ как байт (latin1), собираем буфер, декодируем UTF-8
  const bytes = Buffer.from(text, "latin1");
  return bytes.toString("utf8");
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node repair-mojibake.js <file>");
    process.exit(1);
  }

  // читаем как utf8 (получим "Г‘ВЂ..." строку)
  const txt = fs.readFileSync(file, "utf8");

  const fixed = fixDoubleEncodedLatin1ToUtf8(txt);

  fs.writeFileSync(file, fixed, "utf8");

  console.log("Repaired mojibake (latin1->utf8) in:", file);
}

main();
