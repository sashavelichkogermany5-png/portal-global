const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const PAGES = ["dashboard","projects","ai","orders","pricing","clients","providers","compliance","account","cabinet"];

function read(p){ return fs.readFileSync(p, "utf8"); }

function normalizeSlug(s){
  return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}

function guessKeyFromText(txt){
  const t = normalizeSlug(txt);
  if (t.includes("dashboard")) return "dashboard";
  if (t.includes("project")) return "projects";
  if (t.includes("ai")) return "ai";
  if (t.includes("order")) return "orders";
  if (t.includes("pricing") || t.includes("price")) return "pricing";
  if (t.includes("client")) return "clients";
  if (t.includes("provider")) return "providers";
  if (t.includes("compliance") || t.includes("legal")) return "compliance";
  if (t.includes("account")) return "account";
  if (t.includes("cabinet") || t.includes("admin")) return "cabinet";
  return null;
}

function ensureContainer(targetDoc){
  let main = targetDoc.querySelector("main");
  if (!main){
    main = targetDoc.createElement("main");
    targetDoc.body.appendChild(main);
  }
  main.id = main.id || "app";

  // add CSS once
  if (!targetDoc.querySelector("style#pages-css")){
    const st = targetDoc.createElement("style");
    st.id = "pages-css";
    st.textContent = ".page{display:none}.page.active{display:block}";
    targetDoc.head.appendChild(st);
  }

  // create sections
  for (const k of PAGES){
    if (!targetDoc.querySelector(`#page-${k}`)){
      const sec = targetDoc.createElement("section");
      sec.id = `page-${k}`;
      sec.className = "page" + (k==="dashboard" ? " active" : "");
      main.appendChild(sec);
    }
  }
}

function findSourceBlocks(sourceDoc){
  // Берём любые большие блоки, которые похожи на секции/страницы
  const candidates = Array.from(sourceDoc.querySelectorAll("section, main > div, article, .page, [data-page], [data-section], [data-tab]"));
  return candidates.map(el => ({ el, text: (el.textContent||"").slice(0,2000) }));
}

function pickBlockForKey(sourceDoc, key){
  // 1) по id / data-*
  const direct = sourceDoc.querySelector(
    `#${key}, #page-${key}, #section-${key}, [data-page="${key}"], [data-section="${key}"], [data-tab="${key}"]`
  );
  if (direct) return direct;

  // 2) по заголовкам
  const heads = Array.from(sourceDoc.querySelectorAll("h1,h2,h3"));
  const h = heads.find(x => normalizeSlug(x.textContent).includes(key));
  if (h) return h.closest("section, article, div") || h.parentElement;

  // 3) по текстовому совпадению (fallback)
  const blocks = findSourceBlocks(sourceDoc);
  const best = blocks
    .map(b => {
      const score = normalizeSlug(b.text).includes(key) ? 10 : 0;
      return { el: b.el, score };
    })
    .sort((a,b)=>b.score-a.score)[0];

  return best && best.score>0 ? best.el : null;
}

function addRouterScript(targetDoc){
  if (targetDoc.querySelector("script#portal-router")) return;

  const s = targetDoc.createElement("script");
  s.id = "portal-router";
  s.textContent = `
  (function(){
    const pages = ${JSON.stringify(PAGES)};
    function mapBtnToKey(btn){
      return (btn.dataset && (btn.dataset.section||btn.dataset.page||btn.dataset.tab)) || null;
    }
    function keyFromBtn(btn){
      const k = mapBtnToKey(btn);
      if (k) return k;
      const t = (btn.textContent||"");
      const low = t.toLowerCase();
      if (low.includes("dashboard")) return "dashboard";
      if (low.includes("project")) return "projects";
      if (low.includes("ai")) return "ai";
      if (low.includes("order")) return "orders";
      if (low.includes("pricing") || low.includes("price")) return "pricing";
      if (low.includes("client")) return "clients";
      if (low.includes("provider")) return "providers";
      if (low.includes("compliance") || low.includes("legal")) return "compliance";
      if (low.includes("account")) return "account";
      if (low.includes("cabinet") || low.includes("admin")) return "cabinet";
      return null;
    }

    function show(key){
      document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
      const el = document.getElementById("page-"+key);
      if (el) el.classList.add("active");

      document.querySelectorAll(".nav-btn").forEach(b=>{
        b.classList.remove("active");
        const k = keyFromBtn(b);
        if (k===key) b.classList.add("active");
      });

      location.hash = key;
    }

    document.querySelectorAll(".nav-btn").forEach(btn=>{
      const k = keyFromBtn(btn);
      if (!k) return;
      btn.addEventListener("click", (e)=>{
        // если это <a href="/..."> — отменяем переход
        if (btn.tagName.toLowerCase()==="a") e.preventDefault();
        show(k);
      });
    });

    const initial = (location.hash||"").replace("#","") || "dashboard";
    show(pages.includes(initial) ? initial : "dashboard");
    window.addEventListener("hashchange", ()=>{
      const k = (location.hash||"").replace("#","");
      if (pages.includes(k)) show(k);
    });
  })();
  `;
  targetDoc.body.appendChild(s);
}

function main(){
  const targetPath = process.argv[2];
  const sourcePath = process.argv[3];
  if (!targetPath || !sourcePath){
    console.error("Usage: node combine-by-buttons.js <unified_portal.html> <portal-portal.html>");
    process.exit(1);
  }

  const targetDom = new JSDOM(read(targetPath));
  const sourceDom = new JSDOM(read(sourcePath));
  const targetDoc = targetDom.window.document;
  const sourceDoc = sourceDom.window.document;

  // ensure containers/pages in target
  ensureContainer(targetDoc);

  // переносим стили из source (добавляем, не удаляем твои)
  const sourceStyles = Array.from(sourceDoc.querySelectorAll("style")).map(s=>s.textContent).join("\n");
  if (sourceStyles.trim()){
    const st = targetDoc.createElement("style");
    st.id = "imported-source-styles";
    st.textContent = sourceStyles;
    targetDoc.head.appendChild(st);
  }

  // переносим внешний js (script[src])
  Array.from(sourceDoc.querySelectorAll("script[src]")).forEach(scr=>{
    const clone = targetDoc.createElement("script");
    clone.src = scr.src;
    targetDoc.head.appendChild(clone);
  });

  // переносим контент по страницам
  for (const key of PAGES){
    const container = targetDoc.getElementById("page-"+key);
    const block = pickBlockForKey(sourceDoc, key);
    if (block){
      container.innerHTML = block.innerHTML;
    } else {
      container.innerHTML = `<div style="padding:24px;opacity:.75">No content found for <b>${key}</b> in portal-portal.html</div>`;
    }
  }

  // переносим inline scripts (в конец)
  const inline = Array.from(sourceDoc.querySelectorAll("script"))
    .filter(s=>!s.getAttribute("src"))
    .map(s=>s.textContent||"")
    .join("\n\n");
  if (inline.trim()){
    const scr = targetDoc.createElement("script");
    scr.id = "imported-source-inline-js";
    scr.textContent = inline;
    targetDoc.body.appendChild(scr);
  }

  // добавляем роутер-клики по кнопкам
  addRouterScript(targetDoc);

  const outPath = path.join(path.dirname(targetPath), "unified_portal_by_buttons.html");
  fs.writeFileSync(outPath, targetDom.serialize(), "utf8");
  console.log("OK saved:", outPath);
}

main();
