const headers = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const clamp = (value) => Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0));

function resultId() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(10_000_000 + (bytes[0] % 90_000_000));
}

function shell(title, body) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ServerGrade</title><style>
  :root{color-scheme:dark;--bg:#0d0f0e;--surface:#151816;--line:#29302b;--text:#f4f6f4;--muted:#929a93;--quiet:#626963;--accent:#78cf87;--accent-soft:#19271c;--warn:#e0bd70}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.5}a{color:inherit}.wrap{width:min(1080px,calc(100% - 32px));margin:auto}.nav{height:74px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-family:Montserrat,Manrope,sans-serif;font-weight:750;letter-spacing:-.04em}.mark{display:inline-grid;place-items:center;width:30px;height:30px;margin-right:10px;border-radius:9px;background:var(--accent);color:#10130f}.muted{color:var(--muted)}main{padding:72px 0 96px}.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--muted)}h1{max-width:760px;margin:12px 0 18px;font-family:Montserrat,Manrope,sans-serif;font-size:clamp(38px,7vw,72px);line-height:.98;letter-spacing:-.055em}.warning{margin:36px 0 28px;padding:18px 20px;border:1px solid #5b4b2c;border-radius:14px;background:#201b12;color:#dac79c}.warning strong{display:block;color:#f3d88e;margin-bottom:3px}.score{display:grid;grid-template-columns:1.15fr 2fr;gap:1px;margin-top:28px;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--line)}.panel{background:var(--surface);padding:28px}.number{font-family:Montserrat,Manrope,sans-serif;font-size:76px;line-height:1;color:var(--accent);font-weight:750;letter-spacing:-.06em}.number small{font-size:20px;color:var(--muted);font-weight:500;letter-spacing:0}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.metric span,.fact span{display:block;color:var(--quiet);font-size:10px;letter-spacing:.12em;margin-bottom:7px}.metric b{font-size:28px}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}.fact{padding:20px;background:var(--surface)}.fact b{font-weight:600}.actions{display:flex;gap:12px;margin-top:24px}.button{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:999px;text-decoration:none;background:var(--accent);color:#10130f;font-weight:700}.button.secondary{background:var(--surface);border:1px solid var(--line);color:var(--text)}footer{padding:26px 0;border-top:1px solid var(--line);color:var(--quiet);font-size:12px}@media(max-width:760px){main{padding-top:42px}.score{grid-template-columns:1fr}.metrics,.facts{grid-template-columns:1fr 1fr}.number{font-size:60px}}@media(max-width:480px){.metrics,.facts{grid-template-columns:1fr}.actions{flex-direction:column}.button{justify-content:center}}
  </style></head><body><div class="wrap"><nav class="nav"><div class="brand"><span class="mark">S</span>ServerGrade</div><span class="muted">Открытые замеры серверов</span></nav>${body}<footer>ServerGrade показывает данные, отправленные пользователями. Проверяйте критичные решения самостоятельно.</footer></div></body></html>`;
}

function renderResult(r) {
  const report = /^https:\/\//.test(r.report_url) ? r.report_url : "";
  return shell(`Тест ${r.id}`, `<main><div class="eyebrow">ТЕСТ ${escapeHtml(r.id)} · ${escapeHtml(r.created_at)}</div><h1>Результат диагностики сервера</h1><p class="muted">${escapeHtml(r.country)} · ${escapeHtml(r.city)} · runner ${escapeHtml(r.runner_version)}</p>
  <aside class="warning"><strong>Результат не подтверждён ServerGrade</strong>Замеры отправлены пользователем и технически могут быть изменены или подделаны. Используйте их как ориентир и перепроверяйте перед покупкой.</aside>
  <section class="score"><div class="panel"><div class="eyebrow">SERVERGRADE SCORE</div><div class="number">${clamp(r.score)} <small>/ 100 · ${escapeHtml(r.grade)}</small></div><div class="muted">Покрытие тестами: ${clamp(r.coverage)}%</div></div><div class="panel metrics"><div class="metric"><span>СЕТЬ</span><b>${clamp(r.network_score)}</b></div><div class="metric"><span>ПРОИЗВОДИТЕЛЬНОСТЬ</span><b>${clamp(r.performance_score)}</b></div><div class="metric"><span>КАЧЕСТВО IP</span><b>${clamp(r.quality_score)}</b></div></div></section>
  <section class="facts"><div class="fact"><span>CPU</span><b>${escapeHtml(r.cpu)}</b></div><div class="fact"><span>ЯДРА</span><b>${escapeHtml(r.cores)}</b></div><div class="fact"><span>RAM</span><b>${escapeHtml(r.ram)} · ${escapeHtml(r.ram_type)}</b></div><div class="fact"><span>ДИСК</span><b>${escapeHtml(r.disk)} · ${escapeHtml(r.disk_type)}</b></div><div class="fact"><span>МОДЕЛЬ ДИСКА</span><b>${escapeHtml(r.disk_model)}</b></div><div class="fact"><span>ВЕНДОР СЕРВЕРА</span><b>${escapeHtml(r.server_vendor)}</b></div></section>
  <div class="actions">${report ? `<a class="button" href="${escapeHtml(report)}" rel="nofollow noopener">Открыть полный отчёт</a>` : ""}<a class="button secondary" href="https://github.com/kapybarovv/servergrade">Методика на GitHub</a></div></main>`);
}

function renderHome(rows) {
  const list = rows.length ? rows.map((r) => `<a href="/test/${escapeHtml(r.id)}" style="display:grid;grid-template-columns:110px 1fr auto;gap:18px;align-items:center;padding:17px 0;border-top:1px solid var(--line);text-decoration:none"><span class="muted">#${escapeHtml(r.id)}</span><span>${escapeHtml(r.country)} · ${escapeHtml(r.city)}<small style="display:block;color:var(--quiet)">${escapeHtml(r.cpu)}</small></span><strong style="color:var(--accent);font-size:21px">${clamp(r.score)}</strong></a>`).join("") : `<p class="muted">Пока нет опубликованных замеров.</p>`;
  return shell("Открытые замеры", `<main><div class="eyebrow">SERVERGRADE</div><h1>Открытые замеры серверов</h1><p class="muted">Запустите открытый runner с GitHub — результат автоматически появится здесь.</p><aside class="warning"><strong>Не является гарантией характеристик</strong>Опубликованные результаты присылают пользователи. Они могут быть неточными или подделанными.</aside><div class="actions"><a class="button" href="https://github.com/kapybarovv/servergrade">Запустить тест</a></div><section style="margin-top:70px"><div class="eyebrow" style="margin-bottom:16px">ПОСЛЕДНИЕ ТЕСТЫ</div>${list}</section></main>`);
}

async function publish(request, env) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/x-www-form-urlencoded")) return new Response("Expected form data", { status: 415 });
  const raw = await request.text();
  if (raw.length > 16_384) return new Response("Payload too large", { status: 413 });
  const form = new URLSearchParams(raw);
  const score = clamp(form.get("score"));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "E";
  let id;
  for (let attempt = 0; attempt < 5; attempt++) {
    id = resultId();
    const exists = await env.DB.prepare("SELECT 1 FROM results WHERE id=?").bind(id).first();
    if (!exists) break;
  }
  const values = [id, new Date().toISOString(), score, grade, clamp(form.get("network_score")), clamp(form.get("performance_score")), clamp(form.get("quality_score")), clamp(form.get("coverage")), form.get("country") || "—", form.get("city") || "—", (form.get("cpu") || "—").slice(0, 160), (form.get("cores") || "—").slice(0, 16), (form.get("ram") || "—").slice(0, 32), (form.get("ram_type") || "не раскрыт").slice(0, 32), (form.get("disk") || "—").slice(0, 32), (form.get("disk_type") || "не раскрыт").slice(0, 48), (form.get("disk_model") || "не раскрыт").slice(0, 120), (form.get("server_vendor") || "не раскрыт").slice(0, 160), (form.get("report_url") || "").slice(0, 500), (form.get("runner_version") || "unknown").slice(0, 32)];
  await env.DB.prepare("INSERT INTO results(id,created_at,score,grade,network_score,performance_score,quality_score,coverage,country,city,cpu,cores,ram,ram_type,disk,disk_type,disk_model,server_vendor,report_url,runner_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...values).run();
  return Response.json({ id, url: `${new URL(request.url).origin}/test/${id}`, verified: false }, { status: 201 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/results") return publish(request, env);
    const match = url.pathname.match(/^\/test\/(\d{8})$/);
    if (request.method === "GET" && match) {
      const row = await env.DB.prepare("SELECT * FROM results WHERE id=?").bind(match[1]).first();
      return row ? new Response(renderResult(row), { headers }) : new Response("Result not found", { status: 404 });
    }
    if (request.method === "GET" && url.pathname === "/") {
      const query = await env.DB.prepare("SELECT id,created_at,score,country,city,cpu FROM results ORDER BY created_at DESC LIMIT 20").all();
      return new Response(renderHome(query.results || []), { headers });
    }
    return new Response("Not found", { status: 404 });
  }
};
