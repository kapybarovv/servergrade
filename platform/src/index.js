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
const splitRows = (value = "") => value ? String(value).split("\n").filter(Boolean).map((line) => line.split("\x1f")) : [];

function renderDetailedResults(r) {
  const statuses = new Map(splitRows(r.test_statuses).map(([fn, name, status]) => [fn, { name, status }]));
  const metrics = splitRows(r.metrics);
  const services = splitRows(r.services);
  if (!statuses.size && !metrics.length && !services.length) return `<aside class="details-missing"><strong>Подробности этого прогона не сохранены</strong>Этот результат опубликован старой версией runner. Полный набор ASN, скоростей, ping и результатов сервисов появится после нового запуска.</aside>`;
  const groups = [...statuses].map(([fn, meta]) => {
    const items = metrics.filter(([metricFn]) => metricFn === fn);
    const checks = services.filter(([serviceFn, kind]) => serviceFn === fn && kind !== "sep");
    if (!items.length && !checks.length && meta.status === "не запускался") return "";
    const metricsHtml = items.map(([, label, value, state]) => `<div class="detail-item"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${state ? `<i class="state ${escapeHtml(state)}">${escapeHtml(state)}</i>` : ""}</div>`).join("");
    const servicesHtml = checks.map(([, , name, , state, value]) => `<div class="service-item"><span class="dot ${escapeHtml(state)}"></span><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b></div>`).join("");
    return `<article class="test-group"><header><div><span class="test-kicker">ТЕСТ</span><h3>${escapeHtml(meta.name)}</h3></div><span class="run-status">${escapeHtml(meta.status)}</span></header>${metricsHtml ? `<div class="detail-grid">${metricsHtml}</div>` : ""}${servicesHtml ? `<div class="services-grid">${servicesHtml}</div>` : ""}</article>`;
  }).join("");
  return `<section class="details-section"><div class="section-head"><span>Полные результаты</span><b>${metrics.length} метрик · ${services.length} проверок</b></div>${groups}</section>`;
}

function resultId() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(10_000_000 + (bytes[0] % 90_000_000));
}

function shell(title, body) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ServerGrade</title><style>
  :root{color-scheme:dark;--bg:#0d0f0e;--surface:#151816;--surface-2:#191d1a;--line:#29302b;--text:#f4f6f4;--muted:#929a93;--quiet:#626963;--accent:#78cf87;--accent-soft:#19271c;--warn:#e0bd70}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.5;font-variant-numeric:tabular-nums}a{color:inherit}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}.nav{height:74px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-family:Montserrat,Manrope,sans-serif;font-weight:750;letter-spacing:-.04em}.mark{display:inline-grid;place-items:center;width:30px;height:30px;margin-right:10px;border-radius:9px;background:var(--accent);color:#10130f}.muted{color:var(--muted)}main{padding:72px 0 96px}.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--muted)}h1{max-width:760px;margin:12px 0 18px;font-family:Montserrat,Manrope,sans-serif;font-size:clamp(38px,7vw,72px);line-height:.98;letter-spacing:-.055em}.back{display:inline-flex;align-items:center;gap:8px;margin-bottom:28px;color:var(--muted);font-weight:650;text-decoration:none;transition:color .16s ease,transform .16s ease}.back:hover{color:var(--text);transform:translateX(-2px)}.warning{margin:36px 0 28px;padding:18px 20px;border:1px solid #5b4b2c;border-radius:14px;background:#201b12;color:#dac79c}.warning strong{display:block;color:#f3d88e;margin-bottom:3px}.score{display:grid;grid-template-columns:1.15fr 2fr;gap:1px;margin-top:28px;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--line)}.panel{background:var(--surface);padding:28px}.number{font-family:Montserrat,Manrope,sans-serif;font-size:76px;line-height:1;color:var(--accent);font-weight:750;letter-spacing:-.06em}.number small{font-size:20px;color:var(--muted);font-weight:500;letter-spacing:0}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.metric span,.fact span{display:block;color:var(--quiet);font-size:10px;letter-spacing:.12em;margin-bottom:7px}.metric b{font-size:28px}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}.fact{padding:20px;background:var(--surface)}.fact b{font-weight:600}.actions{display:flex;gap:12px;margin-top:24px}.button{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:999px;text-decoration:none;background:var(--accent);color:#10130f;font-weight:700;transition:transform .16s ease,background .16s ease,border-color .16s ease}.button:hover{background:#91dfa0;transform:translateY(-1px)}.button:active{transform:translateY(0)}.button.secondary{background:var(--surface);border:1px solid var(--line);color:var(--text)}.button.secondary:hover{background:var(--surface-2);border-color:#3c463f}.button:focus-visible,.result-link:focus-visible,.back:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.system-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}.system-item{padding:18px;background:var(--surface)}.system-item span{display:block;margin-bottom:6px;color:var(--quiet);font-size:10px;letter-spacing:.1em}.system-item b{font-size:13px}.details-missing{margin-top:24px;padding:22px;border:1px dashed #4d574f;border-radius:14px;color:var(--muted)}.details-missing strong{display:block;margin-bottom:4px;color:var(--text)}.details-section{margin-top:56px}.section-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:16px}.section-head span{font-family:Montserrat,Manrope,sans-serif;font-size:28px;font-weight:750;letter-spacing:-.04em}.section-head b{color:var(--muted);font-size:12px}.test-group{margin-bottom:14px;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.test-group>header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line)}.test-group h3{margin:2px 0 0;font-size:16px}.test-kicker{color:var(--quiet);font-size:9px;letter-spacing:.14em}.run-status{color:var(--accent);font-size:12px}.detail-grid{display:grid;grid-template-columns:repeat(4,1fr)}.detail-item{position:relative;min-height:82px;padding:17px 20px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.detail-item span{display:block;color:var(--quiet);font-size:10px;letter-spacing:.08em}.detail-item b{display:block;margin-top:7px;font-size:17px}.state{position:absolute;top:15px;right:14px;color:var(--quiet);font-size:9px;font-style:normal}.state.ok{color:var(--accent)}.state.warn,.state.bad{color:var(--warn)}.services-grid{display:grid;grid-template-columns:repeat(3,1fr);padding:10px}.service-item{display:grid;grid-template-columns:8px 1fr auto;gap:9px;align-items:center;padding:10px;border-radius:8px}.service-item:hover{background:var(--surface-2)}.service-item b{color:var(--muted);font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:var(--quiet)}.dot.ok{background:var(--accent)}.dot.warn{background:var(--warn)}.dot.bad{background:#ff6467}.results{margin-top:70px}.table-shell{overflow:hidden;margin-top:16px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}table{width:100%;border-collapse:collapse;text-align:left}th{padding:13px 16px;color:var(--quiet);font-size:10px;font-weight:700;letter-spacing:.1em;border-bottom:1px solid var(--line)}td{padding:0;border-bottom:1px solid var(--line);vertical-align:middle}tbody tr:last-child td{border-bottom:0}tbody tr{transition:background .15s ease}tbody tr:hover{background:var(--surface-2)}.result-link{display:block;min-height:68px;padding:17px 16px;color:var(--text);font-weight:700;text-decoration:none}.result-link:hover{color:var(--accent)}.result-link.regular{font-weight:500}.open-link{display:inline-flex;align-items:center;gap:7px;color:var(--accent);white-space:nowrap}.location{display:block;font-weight:650}.cpu{display:block;max-width:340px;overflow:hidden;color:var(--quiet);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.score-cell{color:var(--accent);font-family:Montserrat,Manrope,sans-serif;font-size:22px;font-weight:750}.grade{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-weight:800}.empty{padding:42px 16px;text-align:center;color:var(--muted)}footer{padding:26px 0;border-top:1px solid var(--line);color:var(--quiet);font-size:12px}@media(max-width:900px){.table-shell{overflow-x:auto}table{min-width:940px}.detail-grid{grid-template-columns:repeat(2,1fr)}.services-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){main{padding-top:42px}.score{grid-template-columns:1fr}.metrics,.facts,.system-grid{grid-template-columns:1fr 1fr}.number{font-size:60px}.nav>.muted{display:none}}@media(max-width:560px){.metrics,.facts,.system-grid,.detail-grid,.services-grid{grid-template-columns:1fr}.actions{flex-direction:column}.button{justify-content:center}.section-head{align-items:start;flex-direction:column;gap:6px}}
  </style></head><body><div class="wrap"><nav class="nav"><div class="brand"><span class="mark">S</span>ServerGrade</div><span class="muted">Открытые замеры серверов</span></nav>${body}<footer>ServerGrade показывает данные, отправленные пользователями. Проверяйте критичные решения самостоятельно.</footer></div></body></html>`;
}

function renderResult(r) {
  const report = /^https:\/\//.test(r.report_url) ? r.report_url : "";
  return shell(`Тест ${r.id}`, `<main><a class="back" href="/">← Все тесты</a><div class="eyebrow">ТЕСТ ${escapeHtml(r.id)} · ${escapeHtml(r.created_at)}</div><h1>Результат диагностики сервера</h1><p class="muted">${escapeHtml(r.country)} · ${escapeHtml(r.city)} · runner ${escapeHtml(r.runner_version)}</p>
  <aside class="warning"><strong>Результат не подтверждён ServerGrade</strong>Замеры отправлены пользователем и технически могут быть изменены или подделаны. Используйте их как ориентир и перепроверяйте перед покупкой.</aside>
  <section class="score"><div class="panel"><div class="eyebrow">SERVERGRADE SCORE</div><div class="number">${clamp(r.score)} <small>/ 100 · ${escapeHtml(r.grade)}</small></div><div class="muted">Покрытие тестами: ${clamp(r.coverage)}%</div></div><div class="panel metrics"><div class="metric"><span>СЕТЬ</span><b>${clamp(r.network_score)}</b></div><div class="metric"><span>ПРОИЗВОДИТЕЛЬНОСТЬ</span><b>${clamp(r.performance_score)}</b></div><div class="metric"><span>КАЧЕСТВО IP</span><b>${clamp(r.quality_score)}</b></div></div></section>
  <section class="facts"><div class="fact"><span>CPU</span><b>${escapeHtml(r.cpu)}</b></div><div class="fact"><span>ЯДРА</span><b>${escapeHtml(r.cores)}</b></div><div class="fact"><span>RAM</span><b>${escapeHtml(r.ram)} · ${escapeHtml(r.ram_type)}</b></div><div class="fact"><span>ДИСК</span><b>${escapeHtml(r.disk)} · ${escapeHtml(r.disk_type)}</b></div><div class="fact"><span>МОДЕЛЬ ДИСКА</span><b>${escapeHtml(r.disk_model)}</b></div><div class="fact"><span>ВЕНДОР СЕРВЕРА</span><b>${escapeHtml(r.server_vendor)}</b></div></section>
  ${r.result_id ? `<section class="system-grid"><div class="system-item"><span>ASN / ПРОВАЙДЕР</span><b>${escapeHtml(r.asn)}</b></div><div class="system-item"><span>ОС</span><b>${escapeHtml(r.os)}</b></div><div class="system-item"><span>ЯДРО / АРХИТЕКТУРА</span><b>${escapeHtml(r.kernel)} · ${escapeHtml(r.arch)}</b></div><div class="system-item"><span>ВИРТУАЛИЗАЦИЯ</span><b>${escapeHtml(r.virtualization)}</b></div><div class="system-item"><span>BBR / QDISC</span><b>${escapeHtml(r.congestion_control)} · ${escapeHtml(r.qdisc)}</b></div><div class="system-item"><span>UPTIME</span><b>${escapeHtml(r.uptime)}</b></div><div class="system-item"><span>LOAD AVG</span><b>${escapeHtml(r.load_avg)}</b></div><div class="system-item"><span>СЕТЕВОЙ СТЕК</span><b>IPv4 ${r.has_ipv4 ? "есть" : "нет"} · IPv6 ${r.has_ipv6 ? "есть" : "нет"}</b></div></section>` : ""}
  ${renderDetailedResults(r)}
  <div class="actions">${report ? `<a class="button" href="${escapeHtml(report)}" rel="nofollow noopener">Открыть полный отчёт</a>` : ""}<a class="button secondary" href="https://github.com/kapybarovv/servergrade">Методика на GitHub</a></div></main>`);
}

function renderHome(rows) {
  const rowsHtml = rows.length ? rows.map((r) => { const href = `/test/${escapeHtml(r.id)}`; return `<tr><td><a class="result-link" href="${href}">#${escapeHtml(r.id)}</a></td><td><a class="result-link regular" href="${href}"><span class="location">${escapeHtml(r.country)} · ${escapeHtml(r.city)}</span><span class="cpu">${escapeHtml(r.cpu)}</span></a></td><td><a class="result-link regular" href="${href}">${escapeHtml(r.cores)}</a></td><td><a class="result-link regular" href="${href}">${escapeHtml(r.ram)}<span class="cpu">${escapeHtml(r.ram_type)}</span></a></td><td><a class="result-link regular" href="${href}">${escapeHtml(r.disk)}<span class="cpu">${escapeHtml(r.disk_type)}</span></a></td><td><a class="result-link score-cell" href="${href}">${clamp(r.score)}</a></td><td><a class="result-link" href="${href}"><span class="grade">${escapeHtml(r.grade)}</span></a></td><td><a class="result-link open-link" href="${href}" aria-label="Открыть тест ${escapeHtml(r.id)}">Открыть <span aria-hidden="true">→</span></a></td></tr>`; }).join("") : `<tr><td class="empty" colspan="8">Пока нет опубликованных замеров.</td></tr>`;
  return shell("Открытые замеры", `<main><div class="eyebrow">SERVERGRADE</div><h1>Открытые замеры серверов</h1><p class="muted">Запустите открытый runner с GitHub — результат автоматически появится здесь.</p><aside class="warning"><strong>Не является гарантией характеристик</strong>Опубликованные результаты присылают пользователи. Они могут быть неточными или подделанными.</aside><div class="actions"><a class="button" href="https://github.com/kapybarovv/servergrade">Запустить тест</a></div><section class="results"><div class="eyebrow">ПОСЛЕДНИЕ ТЕСТЫ</div><div class="table-shell"><table><thead><tr><th>ТЕСТ</th><th>ЛОКАЦИЯ / CPU</th><th>ЯДРА</th><th>RAM</th><th>ДИСК</th><th>БАЛЛ</th><th>ОЦЕНКА</th><th><span class="muted">ДЕЙСТВИЕ</span></th></tr></thead><tbody>${rowsHtml}</tbody></table></div></section></main>`);
}

async function publish(request, env) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/x-www-form-urlencoded")) return new Response("Expected form data", { status: 415 });
  const raw = await request.text();
  if (raw.length > 320_000) return new Response("Payload too large", { status: 413 });
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
  const details = [id, form.get("asn") || "—", form.get("os") || "—", form.get("kernel") || "—", form.get("arch") || "—", form.get("virtualization") || "—", form.get("congestion_control") || "—", form.get("qdisc") || "—", form.get("uptime") || "—", form.get("load_avg") || "—", form.get("has_ipv4") === "1" ? 1 : 0, form.get("has_ipv6") === "1" ? 1 : 0, (form.get("test_statuses") || "").slice(0, 16000), (form.get("metrics") || "").slice(0, 50000), (form.get("services") || "").slice(0, 50000)];
  await env.DB.prepare("INSERT INTO result_details(result_id,asn,os,kernel,arch,virtualization,congestion_control,qdisc,uptime,load_avg,has_ipv4,has_ipv6,test_statuses,metrics,services) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...details).run();
  return Response.json({ id, url: `${new URL(request.url).origin}/test/${id}`, verified: false }, { status: 201 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/results") return publish(request, env);
    const match = url.pathname.match(/^\/test\/(\d{8})$/);
    if (request.method === "GET" && match) {
      const row = await env.DB.prepare("SELECT r.*,d.* FROM results r LEFT JOIN result_details d ON d.result_id=r.id WHERE r.id=?").bind(match[1]).first();
      return row ? new Response(renderResult(row), { headers }) : new Response("Result not found", { status: 404 });
    }
    if (request.method === "GET" && url.pathname === "/") {
      const query = await env.DB.prepare("SELECT id,created_at,score,grade,country,city,cpu,cores,ram,ram_type,disk,disk_type FROM results ORDER BY created_at DESC LIMIT 20").all();
      return new Response(renderHome(query.results || []), { headers });
    }
    return new Response("Not found", { status: 404 });
  }
};
