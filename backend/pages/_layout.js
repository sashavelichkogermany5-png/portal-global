function layout({ title, active, content }) {
  const menu = [
    ["dashboard", "Dashboard"],
    ["projects", "Projects"],
    ["ai", "AI"],
    ["orders", "Orders"],
    ["pricing", "Pricing"],
    ["clients", "Clients"],
    ["providers", "Providers"],
    ["compliance", "Compliance"],
    ["account", "Account"],
    ["cabinet", "Cabinet"],
  ];

  const navHtml = menu.map(([slug, label]) => {
    const isActive = slug === active;
    return `
      <a class="nav-btn ${isActive ? "active" : ""}" href="/${slug}">${label}</a>
    `;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
  <style>
    body{margin:0;font-family:system-ui,Segoe UI,Arial;background:#0b0f19;color:#fff}
    .top{position:sticky;top:0;z-index:10;background:rgba(10,13,22,.92);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.08)}
    .top__inner{max-width:1100px;margin:0 auto;padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    .brand{font-weight:800;letter-spacing:.5px;font-size:18px}
    .nav{display:flex;flex-wrap:wrap;gap:8px}
    .nav-btn{display:inline-flex;align-items:center;text-decoration:none;color:rgba(255,255,255,.78);padding:8px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
    .nav-btn:hover{color:#fff;border-color:rgba(255,255,255,.18)}
    .nav-btn.active{color:#fff;border-color:rgba(59,130,246,.55);background:rgba(59,130,246,.12)}
    .main{max-width:1100px;margin:0 auto;padding:28px 18px 60px}
    .card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
    .muted{color:rgba(255,255,255,.65)}
    .btn{display:inline-block;background:#3b82f6;color:#fff;border:none;border-radius:12px;padding:10px 14px;cursor:pointer}
    .btn:disabled{opacity:.6;cursor:not-allowed}
    input,textarea{width:100%;box-sizing:border-box;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.25);color:#fff;padding:10px 12px}
    textarea{min-height:110px;resize:vertical}
    .row{display:flex;gap:12px;flex-wrap:wrap}
    .row > * {flex:1}
    hr{border:none;border-top:1px solid rgba(255,255,255,.08);margin:16px 0}
    .pill{display:inline-block;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font-size:12px}
  </style>
</head>
<body>
  <header class="top">
    <div class="top__inner">
      <div class="brand">PORTAL GLOBAL</div>
      <nav class="nav">${navHtml}</nav>
    </div>
  </header>
  <main class="main">
    ${content}
  </main>
</body>
</html>`;
}

module.exports = { layout };
