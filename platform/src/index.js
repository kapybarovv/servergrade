const headers = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const clamp = (value) => Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0));
const splitRows = (value = "") => value ? String(value).split("\n").filter(Boolean).map((line) => line.split("\x1f")) : [];
const present = (value) => value != null && !["", "—", "не раскрыт", "unknown"].includes(String(value).trim().toLowerCase());

function item(label, value, className = "fact") {
  return present(value) ? `<div class="${className}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>` : "";
}

function icon(name) {
  const paths = {
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.8a13.4 13.4 0 0 0-7 0C4.8.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 8 18v4"/><path d="M8 19c-3 .9-3-1.5-4-2"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    star: '<path d="m12 2.7 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9z"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}

function countryCode(value = "") {
  const raw = String(value).replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  const names = { "нидерланды": "NL", netherlands: "NL", "германия": "DE", germany: "DE", "франция": "FR", france: "FR", "россия": "RU", russia: "RU", "сша": "US", usa: "US", "united states": "US", "великобритания": "GB", "united kingdom": "GB", "финляндия": "FI", finland: "FI", "эстония": "EE", estonia: "EE", "польша": "PL", poland: "PL", "швеция": "SE", sweden: "SE", "норвегия": "NO", norway: "NO", "латвия": "LV", latvia: "LV", "литва": "LT", lithuania: "LT" };
  const normalized = raw.toLowerCase();
  return names[normalized] || Object.entries(names).find(([name]) => normalized.includes(name))?.[1] || "";
}

function appleFlag(country) {
  const code = countryCode(country);
  if (!code) return "";
  const unified = [...code].map((letter) => (0x1f1e6 + letter.charCodeAt(0) - 65).toString(16)).join("-");
  return `<img class="flag" src="https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/${unified}.png" alt="${escapeHtml(code)}" width="24" height="24">`;
}

const countryLabel = (country) => String(country).replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();

function location(country, city) {
  return `<span class="location">${appleFlag(country)}<span>${escapeHtml(countryLabel(country))}${present(city) ? ` · ${escapeHtml(city)}` : ""}</span></span>`;
}

function renderDetailedResults(r) {
  const statuses = new Map(splitRows(r.test_statuses).map(([fn, name, status]) => [fn, { name, status }]));
  const metrics = splitRows(r.metrics);
  const services = splitRows(r.services);
  if (!statuses.size && !metrics.length && !services.length) return `<aside class="details-missing"><strong>Старый формат результата</strong>В этом прогоне сохранилась только краткая сводка. Новый запуск добавит характеристики, метрики и изображения отчёта.</aside>`;
  const groups = [...statuses].map(([fn, meta]) => {
    const items = metrics.filter(([metricFn]) => metricFn === fn);
    const checks = services.filter(([serviceFn, kind]) => serviceFn === fn && kind !== "sep");
    if (!items.length && !checks.length && meta.status === "не запускался") return "";
    const metricsHtml = items.map(([, label, value, state]) => `<div class="detail-item"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${state ? `<i class="state ${escapeHtml(state)}">${escapeHtml(state)}</i>` : ""}</div>`).join("");
    const servicesHtml = checks.map(([, , name, , state, value]) => `<div class="service-item"><span class="dot ${escapeHtml(state)}"></span><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b></div>`).join("");
    return `<details class="test-group"><summary><div><span class="test-kicker">ТЕСТ</span><h3>${escapeHtml(meta.name)}</h3></div><span class="run-status">${escapeHtml(meta.status)} · открыть</span></summary>${metricsHtml ? `<div class="detail-grid">${metricsHtml}</div>` : ""}${servicesHtml ? `<div class="services-grid">${servicesHtml}</div>` : ""}</details>`;
  }).join("");
  return `<section class="details-section"><div class="section-head"><span>Полные результаты</span><b>${metrics.length} метрик · ${services.length} проверок</b></div>${groups}</section>`;
}

function resultId() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(10_000_000 + (bytes[0] % 90_000_000));
}

function shell(title, body, stars = null) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ServerGrade</title><style>
  :root{color-scheme:dark;--bg:#0d0f0e;--surface:#151816;--surface-2:#191d1a;--line:#29302b;--text:#f4f6f4;--muted:#929a93;--quiet:#626963;--accent:#78cf87;--accent-soft:#19271c;--warn:#e0bd70}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.5;font-variant-numeric:tabular-nums}a{color:inherit}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}.nav{height:66px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-family:Montserrat,Manrope,sans-serif;font-weight:750;letter-spacing:-.04em}.muted{color:var(--muted)}main{padding:72px 0 96px;animation:enter .42s cubic-bezier(.22,1,.36,1) both}.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--muted)}h1{max-width:760px;margin:12px 0 18px;font-family:Montserrat,Manrope,sans-serif;font-size:clamp(38px,7vw,72px);line-height:.98;letter-spacing:-.055em}.back{display:inline-flex;align-items:center;gap:8px;margin-bottom:28px;color:var(--muted);font-weight:650;text-decoration:none;transition:color .16s ease,transform .16s ease}.back:hover{color:var(--text);transform:translateX(-2px)}.warning{margin:36px 0 28px;padding:18px 20px;border:1px solid #5b4b2c;border-radius:14px;background:#201b12;color:#dac79c}.warning strong{display:block;color:#f3d88e;margin-bottom:3px}.score{display:grid;grid-template-columns:1.15fr 2fr;gap:1px;margin-top:28px;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--line)}.panel{background:var(--surface);padding:28px}.number{font-family:Montserrat,Manrope,sans-serif;font-size:76px;line-height:1;color:var(--accent);font-weight:750;letter-spacing:-.06em}.number small{font-size:20px;color:var(--muted);font-weight:500;letter-spacing:0}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.metric span,.fact span{display:block;color:var(--quiet);font-size:10px;letter-spacing:.12em;margin-bottom:7px}.metric b{font-size:28px}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}.fact{padding:20px;background:var(--surface)}.fact b{font-weight:600}.actions{display:flex;gap:12px;margin-top:28px}.button{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 20px;border:1px solid transparent;border-radius:999px;text-decoration:none;background:var(--accent);color:#10130f;font:700 14px Manrope,sans-serif;cursor:pointer;transition:transform .16s cubic-bezier(.22,1,.36,1),background .16s ease,border-color .16s ease}.button:hover{background:#91dfa0;transform:translateY(-1px)}.button:active{transform:translateY(0) scale(.98)}.button.secondary{background:transparent;border-color:var(--line);color:var(--text)}.button.secondary:hover{background:var(--surface);border-color:#465047}.button:focus-visible,.result-link:focus-visible,.back:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.system-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}.system-item{padding:18px;background:var(--surface)}.system-item span{display:block;margin-bottom:6px;color:var(--quiet);font-size:10px;letter-spacing:.1em}.system-item b{font-size:13px}.details-missing{margin-top:24px;padding:22px;border:1px dashed #4d574f;border-radius:14px;color:var(--muted)}.details-missing strong{display:block;margin-bottom:4px;color:var(--text)}.details-section{margin-top:56px}.section-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:16px}.section-head span{font-family:Montserrat,Manrope,sans-serif;font-size:28px;font-weight:750;letter-spacing:-.04em}.section-head b{color:var(--muted);font-size:12px}.test-group{margin-bottom:14px;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface);animation:enter .36s cubic-bezier(.22,1,.36,1) both}.test-group>header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line)}.test-group h3{margin:2px 0 0;font-size:16px}.test-kicker{color:var(--quiet);font-size:9px;letter-spacing:.14em}.run-status{color:var(--accent);font-size:12px}.detail-grid{display:grid;grid-template-columns:repeat(4,1fr)}.detail-item{position:relative;min-height:82px;padding:17px 20px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.detail-item span{display:block;color:var(--quiet);font-size:10px;letter-spacing:.08em}.detail-item b{display:block;margin-top:7px;font-size:17px}.state{position:absolute;top:15px;right:14px;color:var(--quiet);font-size:9px;font-style:normal}.state.ok{color:var(--accent)}.state.warn,.state.bad{color:var(--warn)}.services-grid{display:grid;grid-template-columns:repeat(3,1fr);padding:10px}.service-item{display:grid;grid-template-columns:8px 1fr auto;gap:9px;align-items:center;padding:10px;border-radius:8px;transition:background .15s ease}.service-item:hover{background:var(--surface-2)}.service-item b{color:var(--muted);font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:var(--quiet)}.dot.ok{background:var(--accent)}.dot.warn{background:var(--warn)}.dot.bad{background:#ff6467}.results{margin-top:70px}.table-shell{overflow:hidden;margin-top:16px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}table{width:100%;border-collapse:collapse;text-align:left}th{padding:13px 16px;color:var(--quiet);font-size:10px;font-weight:700;letter-spacing:.1em;border-bottom:1px solid var(--line)}td{padding:0;border-bottom:1px solid var(--line);vertical-align:middle}tbody tr:last-child td{border-bottom:0}tbody tr{transition:background .15s ease}tbody tr:hover{background:var(--surface-2)}.result-link{display:block;min-height:68px;padding:17px 16px;color:var(--text);font-weight:700;text-decoration:none}.result-link:hover{color:var(--accent)}.result-link.regular{font-weight:500}.open-link{display:inline-flex;align-items:center;gap:7px;color:var(--accent);white-space:nowrap}.location{display:block;font-weight:650}.cpu{display:block;max-width:340px;overflow:hidden;color:var(--quiet);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.score-cell{color:var(--accent);font-family:Montserrat,Manrope,sans-serif;font-size:22px;font-weight:750}.grade{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-weight:800}.empty{padding:42px 16px;text-align:center;color:var(--muted)}footer{padding:26px 0;border-top:1px solid var(--line);color:var(--quiet);font-size:12px}@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(max-width:900px){.table-shell{overflow-x:auto}table{min-width:940px}.detail-grid{grid-template-columns:repeat(2,1fr)}.services-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){main{padding-top:42px}.score{grid-template-columns:1fr}.metrics,.facts,.system-grid{grid-template-columns:1fr 1fr}.number{font-size:60px}.nav>.muted{display:none}}@media(max-width:560px){.metrics,.facts,.system-grid,.detail-grid,.services-grid{grid-template-columns:1fr}.actions{flex-direction:column}.button{width:100%}.section-head{align-items:start;flex-direction:column;gap:6px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  .github-stars{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 11px;border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:13px;font-weight:650;text-decoration:none;transition:color .16s ease,border-color .16s ease,background .16s ease,transform .16s cubic-bezier(.22,1,.36,1)}.github-stars:hover{color:var(--text);border-color:#465047;background:var(--surface);transform:translateY(-1px)}.github-stars:active{transform:scale(.98)}.github-stars svg{width:15px;height:15px;fill:currentColor}
  .hero{max-width:820px;padding:32px 0 18px}.hero h1{margin-top:0;text-wrap:balance}.hero p{max-width:590px;margin:24px 0 0;color:var(--muted);font-size:18px;line-height:1.65}.results .section-head{margin-bottom:18px}.results-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.result-card{display:flex;min-height:250px;padding:24px;flex-direction:column;border:1px solid var(--line);border-radius:18px;background:var(--surface);text-decoration:none;transition:transform .18s cubic-bezier(.22,1,.36,1),border-color .18s ease,background .18s ease}.result-card:hover{transform:translateY(-2px);border-color:#455047;background:var(--surface-2)}.card-top,.card-foot{display:flex;align-items:center;justify-content:space-between;color:var(--quiet);font-size:12px}.card-top strong{color:var(--accent);font-family:Montserrat,Manrope,sans-serif;font-size:30px}.card-top small{font-size:12px}.result-card h2{margin:26px 0 6px;font:700 24px Montserrat,Manrope,sans-serif;letter-spacing:-.035em}.result-card p{margin:0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.specs{display:flex;flex-wrap:wrap;gap:7px;margin-top:18px}.specs span{padding:6px 9px;border-radius:8px;background:var(--bg);color:var(--muted);font-size:11px}.card-foot{margin-top:auto;padding-top:22px}.card-foot b{color:var(--text)}.result-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:32px}.result-heading h1{margin-bottom:10px}.score-badge{display:flex;align-items:baseline;gap:8px;white-space:nowrap}.score-badge strong{color:var(--accent);font:750 72px/1 Montserrat,Manrope,sans-serif;letter-spacing:-.06em}.score-badge span{color:var(--muted)}.compact-score{display:block}.compact-score .metrics{grid-template-columns:repeat(4,1fr)}.report-section{margin-top:56px}.report-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.report-gallery a{display:block;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface);text-decoration:none}.report-gallery img{display:block;width:100%;height:auto;background:var(--surface-2)}.report-gallery span{display:block;padding:12px 15px;color:var(--muted);font-size:12px}.test-group>summary{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;cursor:pointer;list-style:none}.test-group>summary::-webkit-details-marker{display:none}.test-group[open]>summary{border-bottom:1px solid var(--line)}.details-section{margin-top:64px}@media(max-width:760px){.results-grid,.report-gallery{grid-template-columns:1fr}.result-heading{align-items:flex-start;flex-direction:column}.score-badge strong{font-size:58px}.compact-score .metrics{grid-template-columns:1fr 1fr}}
  .icon{width:17px;height:17px;flex:0 0 auto}.button{gap:9px}.github-stars .icon{width:15px;height:15px}.location{display:flex;align-items:center;gap:9px}.flag{display:block;width:24px;height:24px;object-fit:contain;flex:0 0 24px}.result-location{display:flex;align-items:center;gap:14px}.result-location .flag{width:38px;height:38px;flex-basis:38px}.open-link{gap:8px}.open-link .icon{width:15px;height:15px}.table-shell{margin-top:0}@media(max-width:900px){.table-shell{overflow-x:auto}table{min-width:940px}}
  </style></head><body><div class="wrap"><nav class="nav"><div class="brand">ServerGrade</div>${stars === null ? "" : `<a class="github-stars" href="https://github.com/kapybarovv/servergrade" aria-label="ServerGrade на GitHub, ${stars} звёзд">${icon("star")}<span>${stars}</span></a>`}</nav>${body}<footer>Данные публикуют пользователи. Проверяйте критичные решения самостоятельно.</footer></div><script>document.addEventListener("click",async(e)=>{const b=e.target.closest("[data-copy]");if(!b)return;const original=b.innerHTML;try{await navigator.clipboard.writeText(b.dataset.copy)}catch{const t=document.createElement("textarea");t.value=b.dataset.copy;document.body.append(t);t.select();document.execCommand("copy");t.remove()}b.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Команда скопирована';setTimeout(()=>b.innerHTML=original,1800)})</script></body></html>`;
}

function renderResult(r, assets = []) {
  const ram = [r.ram, r.ram_type].filter(present).join(" · ");
  const disk = [r.disk, r.disk_type].filter(present).join(" · ");
  const kernel = [r.kernel, r.arch].filter(present).join(" · ");
  const network = [r.congestion_control, r.qdisc].filter(present).join(" · ");
  const facts = [item("CPU", r.cpu), item("Ядра", r.cores), item("RAM", ram), item("Диск", disk), item("Модель диска", r.disk_model), item("Вендор", r.server_vendor)].join("");
  const system = [item("ASN / провайдер", r.asn, "system-item"), item("ОС", r.os, "system-item"), item("Ядро / архитектура", kernel, "system-item"), item("Виртуализация", r.virtualization, "system-item"), item("BBR / QDISC", network, "system-item"), item("Uptime", r.uptime, "system-item"), item("Load avg", r.load_avg, "system-item"), r.result_id ? item("Сетевой стек", `IPv4 ${r.has_ipv4 ? "есть" : "нет"} · IPv6 ${r.has_ipv6 ? "есть" : "нет"}`, "system-item") : ""].join("");
  const gallery = assets.length ? `<section class="report-section"><div class="section-head"><span>Отчёт</span><b>${assets.length} ${assets.length === 1 ? "страница" : "страницы"}</b></div><div class="report-gallery">${assets.map((a) => `<a href="/assets/${escapeHtml(r.id)}/${a.position}.svg" target="_blank"><img src="/assets/${escapeHtml(r.id)}/${a.position}.svg" alt="${escapeHtml(a.name)}" loading="lazy"><span>${escapeHtml(a.name)}</span></a>`).join("")}</div></section>` : "";
  return shell(`Тест ${r.id}`, `<main><a class="back" href="/">← Все тесты</a><div class="result-heading"><div><div class="eyebrow">ТЕСТ ${escapeHtml(r.id)} · ${escapeHtml(r.created_at)}</div><h1 class="result-location">${appleFlag(r.country)}<span>${escapeHtml(countryLabel(r.country))} · ${escapeHtml(r.city)}</span></h1><p class="muted">${present(r.cpu) ? escapeHtml(r.cpu) : "Результат диагностики сервера"}</p></div><div class="score-badge"><strong>${clamp(r.score)}</strong><span>/ 100 · ${escapeHtml(r.grade)}</span></div></div>
  <section class="score compact-score"><div class="panel metrics"><div class="metric"><span>СЕТЬ</span><b>${clamp(r.network_score)}</b></div><div class="metric"><span>ПРОИЗВОДИТЕЛЬНОСТЬ</span><b>${clamp(r.performance_score)}</b></div><div class="metric"><span>КАЧЕСТВО IP</span><b>${clamp(r.quality_score)}</b></div><div class="metric"><span>ПОКРЫТИЕ</span><b>${clamp(r.coverage)}%</b></div></div></section>
  ${facts ? `<section class="facts">${facts}</section>` : ""}${system ? `<section class="system-grid">${system}</section>` : ""}
  ${gallery}${renderDetailedResults(r)}
  <div class="actions"><a class="button secondary" href="https://github.com/kapybarovv/servergrade">${icon("github")}Методика на GitHub</a></div></main>`);
}

function renderHome(rows, stars) {
  const rowsHtml = rows.length ? rows.map((r) => { const href = `/test/${escapeHtml(r.id)}`; return `<tr><td><a class="result-link" href="${href}">#${escapeHtml(r.id)}</a></td><td><a class="result-link regular" href="${href}">${location(r.country, r.city)}${present(r.cpu) ? `<span class="cpu">${escapeHtml(r.cpu)}</span>` : ""}</a></td><td><a class="result-link regular" href="${href}">${present(r.cores) ? escapeHtml(r.cores) : "—"}</a></td><td><a class="result-link regular" href="${href}">${present(r.ram) ? escapeHtml(r.ram) : "—"}${present(r.ram_type) ? `<span class="cpu">${escapeHtml(r.ram_type)}</span>` : ""}</a></td><td><a class="result-link regular" href="${href}">${present(r.disk) ? escapeHtml(r.disk) : "—"}${present(r.disk_type) ? `<span class="cpu">${escapeHtml(r.disk_type)}</span>` : ""}</a></td><td><a class="result-link score-cell" href="${href}">${clamp(r.score)}</a></td><td><a class="result-link" href="${href}"><span class="grade">${escapeHtml(r.grade)}</span></a></td><td><a class="result-link open-link" href="${href}" aria-label="Открыть тест ${escapeHtml(r.id)}">${icon("arrow")}<span>Открыть</span></a></td></tr>`; }).join("") : `<tr><td class="empty" colspan="8">Пока нет опубликованных результатов.</td></tr>`;
  const command = "bash <(curl -fsSL https://raw.githubusercontent.com/kapybarovv/servergrade/main/servergrade.sh)";
  return shell("Результаты тестов", `<main><section class="hero"><h1>Тесты серверов.<br>Без лишнего.</h1><p>Запустите диагностику и получите одну страницу с оценкой, характеристиками и полным отчётом.</p><div class="actions"><button class="button" type="button" data-copy="${escapeHtml(command)}">${icon("copy")}Запустить тест</button><a class="button secondary" href="https://github.com/kapybarovv/servergrade">${icon("github")}Открыть GitHub</a></div></section><section class="results"><div class="section-head"><span>Последние результаты</span><b>${rows.length}</b></div><div class="table-shell"><table><thead><tr><th>ТЕСТ</th><th>ЛОКАЦИЯ / CPU</th><th>ЯДРА</th><th>RAM</th><th>ДИСК</th><th>БАЛЛ</th><th>ОЦЕНКА</th><th>ДЕЙСТВИЕ</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></section></main>`, stars);
}

async function githubStars() {
  try {
    const response = await fetch("https://api.github.com/repos/kapybarovv/servergrade", {
      headers: { accept: "application/vnd.github+json", "user-agent": "servergrade-results" },
      cf: { cacheEverything: true, cacheTtl: 1800 },
    });
    if (!response.ok) return "—";
    const data = await response.json();
    return new Intl.NumberFormat("ru-RU", { notation: "compact" }).format(data.stargazers_count || 0);
  } catch {
    return "—";
  }
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
  const tokenBytes = new Uint8Array(24); crypto.getRandomValues(tokenBytes);
  const uploadToken = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO result_upload_tokens(result_id,token) VALUES(?,?)").bind(id, uploadToken).run();
  return Response.json({ id, url: `${new URL(request.url).origin}/test/${id}`, upload_token: uploadToken }, { status: 201 });
}

async function uploadAsset(request, env, id) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/x-www-form-urlencoded")) return new Response("Expected form data", { status: 415 });
  const raw = await request.text();
  if (raw.length > 1_500_000) return new Response("Asset too large", { status: 413 });
  const form = new URLSearchParams(raw);
  const token = form.get("token") || "";
  const access = await env.DB.prepare("SELECT 1 FROM result_upload_tokens WHERE result_id=? AND token=?").bind(id, token).first();
  if (!access) return new Response("Forbidden", { status: 403 });
  const position = Math.max(1, Math.min(8, Number.parseInt(form.get("position"), 10) || 0));
  const svg = form.get("svg") || "";
  if (!position || svg.length > 1_200_000 || !svg.includes("<svg")) return new Response("Invalid asset", { status: 400 });
  const name = (form.get("name") || `Страница ${position}`).slice(0, 80);
  await env.DB.prepare("INSERT OR REPLACE INTO result_assets(result_id,position,name,mime,data) VALUES(?,?,?,'image/svg+xml',?)").bind(id, position, name, svg).run();
  return Response.json({ ok: true, url: `${new URL(request.url).origin}/assets/${id}/${position}.svg` }, { status: 201 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/results") return publish(request, env);
    const assetUpload = url.pathname.match(/^\/api\/results\/(\d{8})\/assets$/);
    if (request.method === "POST" && assetUpload) return uploadAsset(request, env, assetUpload[1]);
    const assetMatch = url.pathname.match(/^\/assets\/(\d{8})\/(\d+)\.svg$/);
    if (request.method === "GET" && assetMatch) {
      const asset = await env.DB.prepare("SELECT data FROM result_assets WHERE result_id=? AND position=?").bind(assetMatch[1], assetMatch[2]).first();
      return asset ? new Response(asset.data, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } }) : new Response("Not found", { status: 404 });
    }
    const match = url.pathname.match(/^\/test\/(\d{8})$/);
    if (request.method === "GET" && match) {
      const [row, assets] = await Promise.all([
        env.DB.prepare("SELECT r.*,d.* FROM results r LEFT JOIN result_details d ON d.result_id=r.id WHERE r.id=?").bind(match[1]).first(),
        env.DB.prepare("SELECT position,name FROM result_assets WHERE result_id=? ORDER BY position").bind(match[1]).all(),
      ]);
      return row ? new Response(renderResult(row, assets.results || []), { headers }) : new Response("Result not found", { status: 404 });
    }
    if (request.method === "GET" && url.pathname === "/") {
      const [query, stars] = await Promise.all([
        env.DB.prepare("SELECT id,created_at,score,grade,country,city,cpu,cores,ram,ram_type,disk,disk_type FROM results ORDER BY created_at DESC LIMIT 20").all(),
        githubStars(),
      ]);
      return new Response(renderHome(query.results || [], stars), { headers });
    }
    return new Response("Not found", { status: 404 });
  }
};
