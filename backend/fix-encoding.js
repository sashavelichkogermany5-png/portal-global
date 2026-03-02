const fs = require("fs");

function scoreUtfText(s) {
  // чем больше “нормальных” символов и эмодзи — тем лучше
  const good = (s.match(/[A-Za-zА-Яа-я0-9\s.,:;!?()\[\]'"—–\-_/\\]/g) || []).length;
  const bad = (s.match(/[�]/g) || []).length * 50; // штраф за replacement char
  const weird = (s.match(/[СЂСџ]/g) || []).length * 10; // штраф за “СЂСџ…”
  return good - bad - weird;
}

function decode(buf, encoding) {
  // Node умеет latin1, но cp1251 — нет.
  // Поэтому cp1251 делаем вручную через таблицу (минимальная).
  if (encoding === "latin1") return buf.toString("latin1");
  if (encoding === "utf8") return buf.toString("utf8");

  // CP1251 mapping for 0x80-0xFF (частичная + полная для кириллицы)
  const cp1251Map = {
    0x80: "Ђ",0x81:"Ѓ",0x82:"‚",0x83:"ѓ",0x84:"„",0x85:"…",0x86:"†",0x87:"‡",
    0x88:"ˆ",0x89:"‰",0x8A:"Љ",0x8B:"‹",0x8C:"Њ",0x8D:"Ѝ",0x8E:"Ћ",0x8F:"Џ",
    0x90:"ђ",0x91:"‘",0x92:"’",0x93:"“",0x94:"”",0x95:"•",0x96:"–",0x97:"—",
    0x98:"˜",0x99:"™",0x9A:"љ",0x9B:"›",0x9C:"њ",0x9D:"ќ",0x9E:"ћ",0x9F:"џ",
    0xA0:" ",0xA1:"Ў",0xA2:"ў",0xA3:"Ј",0xA4:"¤",0xA5:"Ґ",0xA6:"¦",0xA7:"§",
    0xA8:"Ё",0xA9:"©",0xAA:"Є",0xAB:"«",0xAC:"¬",0xAD:"­",0xAE:"®",0xAF:"Ї",
    0xB0:"°",0xB1:"±",0xB2:"І",0xB3:"і",0xB4:"ґ",0xB5:"µ",0xB6:"¶",0xB7:"·",
    0xB8:"ё",0xB9:"№",0xBA:"є",0xBB:"»",0xBC:"ј",0xBD:"Ѕ",0xBE:"ѕ",0xBF:"ї",
    0xC0:"А",0xC1:"Б",0xC2:"В",0xC3:"Г",0xC4:"Д",0xC5:"Е",0xC6:"Ж",0xC7:"З",
    0xC8:"И",0xC9:"Й",0xCA:"К",0xCB:"Л",0xCC:"М",0xCD:"Н",0xCE:"О",0xCF:"П",
    0xD0:"Р",0xD1:"С",0xD2:"Т",0xD3:"У",0xD4:"Ф",0xD5:"Х",0xD6:"Ц",0xD7:"Ч",
    0xD8:"Ш",0xD9:"Щ",0xDA:"Ъ",0xDB:"Ы",0xDC:"Ь",0xDD:"Э",0xDE:"Ю",0xDF:"Я",
    0xE0:"а",0xE1:"б",0xE2:"в",0xE3:"г",0xE4:"д",0xE5:"е",0xE6:"ж",0xE7:"з",
    0xE8:"и",0xE9:"й",0xEA:"к",0xEB:"л",0xEC:"м",0xED:"н",0xEE:"о",0xEF:"п",
    0xF0:"р",0xF1:"с",0xF2:"т",0xF3:"у",0xF4:"ф",0xF5:"х",0xF6:"ц",0xF7:"ч",
    0xF8:"ш",0xF9:"щ",0xFA:"ъ",0xFB:"ы",0xFC:"ь",0xFD:"э",0xFE:"ю",0xFF:"я",
  };

  let out = "";
  for (const b of buf) {
    if (b < 0x80) out += String.fromCharCode(b);
    else out += (cp1251Map[b] ?? "�");
  }
  return out;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node fix-encoding.js <file>");
    process.exit(1);
  }
  const buf = fs.readFileSync(file);

  const variants = [
    { enc: "utf8",  text: decode(buf, "utf8")  },
    { enc: "latin1",text: decode(buf, "latin1")},
    { enc: "cp1251",text: decode(buf, "cp1251")},
  ];

  // теперь попробуем “двойное исправление”: если файл уже испорчен UTF8->CP1251
  // то можно попытаться: взять текст как latin1 и перекодировать обратно в bytes
  // но это сложнее. Пока хватит выбора лучшего варианта.
  variants.forEach(v => v.score = scoreUtfText(v.text));

  variants.sort((a,b) => b.score - a.score);
  const best = variants[0];

  fs.writeFileSync(file, best.text, "utf8");
  console.log("Fixed encoding using:", best.enc, "score:", best.score);
}

main();
