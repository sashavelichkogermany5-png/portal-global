const { layout } = require("./_layout");

function page(slug, title, bodyHtml) {
  return layout({
    title,
    active: slug,
    content: `
      <h1 style="margin:0 0 10px">${title}</h1>
      <div class="muted" style="margin:0 0 18px">Section: /${slug}</div>
      ${bodyHtml}
    `
  });
}

function dashboard() {
  return page("dashboard","Dashboard",`
    <div class="grid">
      <div class="card"><div class="pill">Status</div><h3>System</h3><div class="muted">Health check, logs, uptime.</div></div>
      <div class="card"><div class="pill">Projects</div><h3>Portfolio</h3><div class="muted">All sub-projects inside central portal.</div></div>
      <div class="card"><div class="pill">Orders</div><h3>Pipeline</h3><div class="muted">Create & track client requests.</div></div>
    </div>
    <hr/>
    <button class="btn" onclick="fetch('/api/health').then(r=>r.json()).then(console.log).alert ? 0 : alert('Check console: /api/health')">Ping /api/health</button>
  `);
}

function projects() {
  return page("projects","Projects",`
    <div class="card">
      <div class="muted">This portal contains multiple modules. Add your list here:</div>
      <ul>
        <li>Portal Orders (files upload, requests)</li>
        <li>AI Assistant (idea → project plan)</li>
        <li>Clients & Providers registry</li>
        <li>Compliance / Legal docs</li>
        <li>Pricing plans</li>
      </ul>
    </div>
  `);
}

function ai() {
  return page("ai","AI",`
    <div class="card">
      <div class="row">
        <div>
          <label class="muted">Idea / Request</label>
          <textarea id="idea" placeholder="Напиши идею проекта..."></textarea>
        </div>
      </div>
      <div style="margin-top:12px">
        <button class="btn" id="gen">Generate (demo)</button>
      </div>
      <pre id="out" style="white-space:pre-wrap;margin-top:14px" class="muted"></pre>
    </div>

    <script>
      document.getElementById("gen").onclick = async () => {
        const idea = document.getElementById("idea").value.trim();
        if(!idea){ alert("Enter idea"); return; }
        const r = await fetch("/api/ai-project", {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ idea })
        });
        const j = await r.json();
        document.getElementById("out").textContent = JSON.stringify(j, null, 2);
      };
    </script>
  `);
}

function orders() {
  return page("orders","Orders",`
    <div class="card">
      <div class="row">
        <div>
          <label class="muted">Order details</label>
          <textarea id="msg" placeholder="Describe your order..."></textarea>
        </div>
      </div>
      <div style="margin-top:12px" class="row">
        <input id="file" type="file" multiple />
        <button class="btn" id="send">Send (demo)</button>
      </div>
      <pre id="out" style="white-space:pre-wrap;margin-top:14px" class="muted"></pre>
    </div>

    <script>
      document.getElementById("send").onclick = async () => {
        const message = document.getElementById("msg").value.trim();
        const r = await fetch("/api/chat", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ message })
        });
        const j = await r.json();
        document.getElementById("out").textContent = JSON.stringify(j,null,2);
      };
    </script>
  `);
}

function pricing() { return page("pricing","Pricing",`<div class="card"><div class="muted">Plans and subscriptions placeholder.</div></div>`); }
function clients() { return page("clients","Clients",`<div class="card"><div class="muted">Clients list placeholder.</div></div>`); }
function providers() { return page("providers","Providers",`<div class="card"><div class="muted">Providers list placeholder.</div></div>`); }
function compliance() { return page("compliance","Compliance",`<div class="card"><div class="muted">Compliance / legal docs placeholder.</div></div>`); }
function account() { return page("account","Account",`<div class="card"><div class="muted">Account settings placeholder.</div></div>`); }
function cabinet() { return page("cabinet","Cabinet",`<div class="card"><div class="muted">Cabinet / admin placeholder.</div></div>`); }

module.exports = { dashboard, projects, ai, orders, pricing, clients, providers, compliance, account, cabinet };
