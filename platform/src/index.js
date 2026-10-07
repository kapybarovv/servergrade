const headers = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const clamp = (value) => Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0));
const splitRows = (value = "") => value ? String(value).split("\n").filter(Boolean).map((line) => line.split("\x1f")) : [];
const present = (value) => value != null && !["", "—", "не раскрыт", "unknown"].includes(String(value).trim().toLowerCase());
const bytesHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function randomHex(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesHex(bytes);
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}

async function serverSecret(env) {
  const existing = await env.DB.prepare("SELECT value FROM app_secrets WHERE name='attestation-v1'").first();
  if (existing?.value) return existing.value;
  const generated = randomHex(32);
  await env.DB.prepare("INSERT OR IGNORE INTO app_secrets(name,value,created_at) VALUES('attestation-v1',?,datetime('now'))").bind(generated).run();
  return (await env.DB.prepare("SELECT value FROM app_secrets WHERE name='attestation-v1'").first()).value;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "0.0.0.0";
}

function numeric(value) {
  const match = String(value || "").replace(",", ".").match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : null;
}

function signalScore(label, value, state) {
  const key = String(label || "").toLowerCase();
  const raw = String(value || "").toLowerCase();
  let n = numeric(raw);
  if (key.includes("ping") || key.includes("lat avg") || key.includes("lat 95")) return n == null ? 70 : n <= 10 ? 100 : n <= 25 ? 92 : n <= 50 ? 80 : n <= 100 ? 62 : n <= 180 ? 42 : 20;
  if (key.includes("макс") || key.includes("mbps") || key.includes("скорост")) return n == null ? 70 : n >= 2000 ? 100 : n >= 1000 ? 95 : n >= 500 ? 86 : n >= 200 ? 72 : n >= 100 ? 60 : n >= 50 ? 45 : 25;
  if (key.includes("gb6 single")) return n == null ? 70 : n >= 2500 ? 100 : n >= 2000 ? 92 : n >= 1500 ? 82 : n >= 1000 ? 68 : n >= 600 ? 48 : 28;
  if (key.includes("gb6 multi")) return n == null ? 70 : n >= 10000 ? 100 : n >= 7000 ? 92 : n >= 4500 ? 82 : n >= 2500 ? 68 : n >= 1200 ? 48 : 28;
  if (key.includes("fio") || key.includes("i/o")) { if (n == null) return 70; if (raw.includes("gb/s")) n *= 1024; return n >= 1500 ? 100 : n >= 800 ? 92 : n >= 400 ? 82 : n >= 200 ? 68 : n >= 100 ? 52 : 30; }
  if (key.includes("events/s")) return n == null ? 70 : n >= 10000 ? 100 : n >= 5000 ? 90 : n >= 2500 ? 78 : n >= 1000 ? 62 : n >= 500 ? 45 : 25;
  if (key.includes("риск")) return /verylow|low/.test(raw) ? 100 : raw.includes("medium") ? 60 : raw.includes("high") ? 15 : 70;
  if (key.includes("dnsbl")) return n === 0 ? 100 : 20;
  return state === "ok" ? 100 : state === "pri" ? 85 : state === "warn" ? 55 : state === "bad" ? 10 : 72;
}

function calculateScores(statusBlob, metricsBlob, servicesBlob) {
  const statuses = new Map(splitRows(statusBlob).map(([fn, , status]) => [fn, status]));
  const metrics = splitRows(metricsBlob);
  const services = splitRows(servicesBlob);
  const groups = [
    ["run_ip_region", "run_censorcheck_geoblock", "run_censorcheck_dpi", "run_censorcheck_tlab"],
    ["run_iperf3_ru", "run_iperf3_tlab", "run_yabs", "run_bench_sh", "run_sysbench_cpu"],
    ["run_ip_check_place", "run_ip_quality"],
  ];
  const scoreTest = (fn) => {
    if (statuses.get(fn) !== "выполнен") return null;
    const signals = metrics.filter(([metricFn]) => metricFn === fn).map(([, label, value, state]) => signalScore(label, value, state));
    const serviceScores = services.filter(([serviceFn, kind, , , state]) => serviceFn === fn && kind !== "sep" && ["ok", "warn", "bad"].includes(state)).map(([, , , , state]) => state === "ok" ? 100 : state === "warn" ? 55 : 10);
    if (serviceScores.length) signals.push(Math.trunc(serviceScores.reduce((a, b) => a + b, 0) / serviceScores.length));
    return signals.length ? Math.trunc(signals.reduce((a, b) => a + b, 0) / signals.length) : 60;
  };
  const category = (members) => { const values = members.map(scoreTest).filter((v) => v != null); return values.length ? Math.trunc(values.reduce((a, b) => a + b, 0) / values.length) : 0; };
  const scores = groups.map(category);
  const weights = [30, 45, 25];
  let weighted = 0; let totalWeight = 0;
  scores.forEach((score, i) => { if (score > 0) { weighted += score * weights[i]; totalWeight += weights[i]; } });
  const total = totalWeight ? Math.trunc((weighted + totalWeight / 2) / totalWeight) : 0;
  const completed = [...statuses.values()].filter((status) => status === "выполнен").length;
  return { total, network: scores[0], performance: scores[1], quality: scores[2], coverage: Math.trunc(completed * 100 / 11), grade: total >= 90 ? "A" : total >= 80 ? "B" : total >= 70 ? "C" : total >= 60 ? "D" : "E" };
}

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
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ServerGrade</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&amp;family=Montserrat:wght@600;700&amp;display=swap" rel="stylesheet"><meta name="theme-color" content="#0d0f0e"><style>
  :root{color-scheme:dark;--bg:#0d0f0e;--surface:#151816;--surface-2:#191d1a;--line:#29302b;--text:#f4f6f4;--muted:#929a93;--quiet:#626963;--accent:#78cf87;--accent-soft:#19271c;--warn:#e0bd70}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:Manrope,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.5;font-variant-numeric:tabular-nums}a{color:inherit}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}.nav{height:66px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-family:Montserrat,Manrope,sans-serif;font-weight:750;letter-spacing:-.04em}.muted{color:var(--muted)}main{padding:72px 0 96px;animation:enter .42s cubic-bezier(.22,1,.36,1) both}.eyebrow{font-size:11px;letter-spacing:.14em;color:var(--muted)}h1{max-width:760px;margin:12px 0 18px;font-family:Montserrat,Manrope,sans-serif;font-size:clamp(38px,7vw,72px);line-height:.98;letter-spacing:-.055em}.back{display:inline-flex;align-items:center;gap:8px;margin-bottom:28px;color:var(--muted);font-weight:650;text-decoration:none;transition:color .16s ease,transform .16s ease}.back:hover{color:var(--text);transform:translateX(-2px)}.warning{margin:36px 0 28px;padding:18px 20px;border:1px solid #5b4b2c;border-radius:14px;background:#201b12;color:#dac79c}.warning strong{display:block;color:#f3d88e;margin-bottom:3px}.score{display:grid;grid-template-columns:1.15fr 2fr;gap:1px;margin-top:28px;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--line)}.panel{background:var(--surface);padding:28px}.number{font-family:Montserrat,Manrope,sans-serif;font-size:76px;line-height:1;color:var(--accent);font-weight:750;letter-spacing:-.06em}.number small{font-size:20px;color:var(--muted);font-weight:500;letter-spacing:0}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.metric span,.fact span{display:block;color:var(--quiet);font-size:10px;letter-spacing:.12em;margin-bottom:7px}.metric b{font-size:28px}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}.fact{padding:20px;background:var(--surface)}.fact b{font-weight:600}.actions{display:flex;gap:12px;margin-top:28px}.button{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 20px;border:1px solid transparent;border-radius:999px;text-decoration:none;background:var(--accent);color:#10130f;font:700 14px Manrope,sans-serif;cursor:pointer;transition:transform .16s cubic-bezier(.22,1,.36,1),background .16s ease,border-color .16s ease}.button:hover{background:#91dfa0;transform:translateY(-1px)}.button:active{transform:translateY(0) scale(.98)}.button.secondary{background:transparent;border-color:var(--line);color:var(--text)}.button.secondary:hover{background:var(--surface);border-color:#465047}.button:focus-visible,.result-link:focus-visible,.back:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.system-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:16px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--line)}.system-item{padding:18px;background:var(--surface)}.system-item span{display:block;margin-bottom:6px;color:var(--quiet);font-size:10px;letter-spacing:.1em}.system-item b{font-size:13px}.details-missing{margin-top:24px;padding:22px;border:1px dashed #4d574f;border-radius:14px;color:var(--muted)}.details-missing strong{display:block;margin-bottom:4px;color:var(--text)}.details-section{margin-top:56px}.section-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:16px}.section-head span{font-family:Montserrat,Manrope,sans-serif;font-size:28px;font-weight:750;letter-spacing:-.04em}.section-head b{color:var(--muted);font-size:12px}.test-group{margin-bottom:14px;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface);animation:enter .36s cubic-bezier(.22,1,.36,1) both}.test-group>header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line)}.test-group h3{margin:2px 0 0;font-size:16px}.test-kicker{color:var(--quiet);font-size:9px;letter-spacing:.14em}.run-status{color:var(--accent);font-size:12px}.detail-grid{display:grid;grid-template-columns:repeat(4,1fr)}.detail-item{position:relative;min-height:82px;padding:17px 20px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.detail-item span{display:block;color:var(--quiet);font-size:10px;letter-spacing:.08em}.detail-item b{display:block;margin-top:7px;font-size:17px}.state{position:absolute;top:15px;right:14px;color:var(--quiet);font-size:9px;font-style:normal}.state.ok{color:var(--accent)}.state.warn,.state.bad{color:var(--warn)}.services-grid{display:grid;grid-template-columns:repeat(3,1fr);padding:10px}.service-item{display:grid;grid-template-columns:8px 1fr auto;gap:9px;align-items:center;padding:10px;border-radius:8px;transition:background .15s ease}.service-item:hover{background:var(--surface-2)}.service-item b{color:var(--muted);font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:var(--quiet)}.dot.ok{background:var(--accent)}.dot.warn{background:var(--warn)}.dot.bad{background:#ff6467}.results{margin-top:70px}.table-shell{overflow:hidden;margin-top:16px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}table{width:100%;border-collapse:collapse;text-align:left}th{padding:13px 16px;color:var(--quiet);font-size:10px;font-weight:700;letter-spacing:.1em;border-bottom:1px solid var(--line)}td{padding:0;border-bottom:1px solid var(--line);vertical-align:middle}tbody tr:last-child td{border-bottom:0}tbody tr{transition:background .15s ease}tbody tr:hover{background:var(--surface-2)}.result-link{display:block;min-height:68px;padding:17px 16px;color:var(--text);font-weight:700;text-decoration:none}.result-link:hover{color:var(--accent)}.result-link.regular{font-weight:500}.open-link{display:inline-flex;align-items:center;gap:7px;color:var(--accent);white-space:nowrap}.location{display:block;font-weight:650}.cpu{display:block;max-width:340px;overflow:hidden;color:var(--quiet);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.score-cell{color:var(--accent);font-family:Montserrat,Manrope,sans-serif;font-size:22px;font-weight:750}.grade{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-weight:800}.empty{padding:42px 16px;text-align:center;color:var(--muted)}footer{padding:26px 0;border-top:1px solid var(--line);color:var(--quiet);font-size:12px}@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(max-width:900px){.table-shell{overflow-x:auto}table{min-width:940px}.detail-grid{grid-template-columns:repeat(2,1fr)}.services-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){main{padding-top:42px}.score{grid-template-columns:1fr}.metrics,.facts,.system-grid{grid-template-columns:1fr 1fr}.number{font-size:60px}.nav>.muted{display:none}}@media(max-width:560px){.metrics,.facts,.system-grid,.detail-grid,.services-grid{grid-template-columns:1fr}.actions{flex-direction:column}.button{width:100%}.section-head{align-items:start;flex-direction:column;gap:6px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  .github-stars{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 11px;border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:13px;font-weight:650;text-decoration:none;transition:color .16s ease,border-color .16s ease,background .16s ease,transform .16s cubic-bezier(.22,1,.36,1)}.github-stars:hover{color:var(--text);border-color:#465047;background:var(--surface);transform:translateY(-1px)}.github-stars:active{transform:scale(.98)}.github-stars svg{width:15px;height:15px;fill:currentColor}
  .hero{max-width:820px;padding:32px 0 18px}.hero h1{margin-top:0;text-wrap:balance}.hero p{max-width:590px;margin:24px 0 0;color:var(--muted);font-size:18px;line-height:1.65}.results .section-head{margin-bottom:18px}.results-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.result-card{display:flex;min-height:250px;padding:24px;flex-direction:column;border:1px solid var(--line);border-radius:18px;background:var(--surface);text-decoration:none;transition:transform .18s cubic-bezier(.22,1,.36,1),border-color .18s ease,background .18s ease}.result-card:hover{transform:translateY(-2px);border-color:#455047;background:var(--surface-2)}.card-top,.card-foot{display:flex;align-items:center;justify-content:space-between;color:var(--quiet);font-size:12px}.card-top strong{color:var(--accent);font-family:Montserrat,Manrope,sans-serif;font-size:30px}.card-top small{font-size:12px}.result-card h2{margin:26px 0 6px;font:700 24px Montserrat,Manrope,sans-serif;letter-spacing:-.035em}.result-card p{margin:0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.specs{display:flex;flex-wrap:wrap;gap:7px;margin-top:18px}.specs span{padding:6px 9px;border-radius:8px;background:var(--bg);color:var(--muted);font-size:11px}.card-foot{margin-top:auto;padding-top:22px}.card-foot b{color:var(--text)}.result-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:32px}.result-heading h1{margin-bottom:10px}.score-badge{display:flex;align-items:baseline;gap:8px;white-space:nowrap}.score-badge strong{color:var(--accent);font:750 72px/1 Montserrat,Manrope,sans-serif;letter-spacing:-.06em}.score-badge span{color:var(--muted)}.compact-score{display:block}.compact-score .metrics{grid-template-columns:repeat(4,1fr)}.report-section{margin-top:56px}.report-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.report-gallery a{display:block;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface);text-decoration:none}.report-gallery img{display:block;width:100%;height:auto;background:var(--surface-2)}.report-gallery span{display:block;padding:12px 15px;color:var(--muted);font-size:12px}.test-group>summary{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;cursor:pointer;list-style:none}.test-group>summary::-webkit-details-marker{display:none}.test-group[open]>summary{border-bottom:1px solid var(--line)}.details-section{margin-top:64px}@media(max-width:760px){.results-grid,.report-gallery{grid-template-columns:1fr}.result-heading{align-items:flex-start;flex-direction:column}.score-badge strong{font-size:58px}.compact-score .metrics{grid-template-columns:1fr 1fr}}
  .icon{width:17px;height:17px;flex:0 0 auto}.button{gap:9px}.github-stars .icon{width:15px;height:15px}.location{display:flex;align-items:center;gap:9px}.flag{display:block;width:24px;height:24px;object-fit:contain;flex:0 0 24px}.result-location{display:flex;align-items:center;gap:14px}.result-location .flag{width:38px;height:38px;flex-basis:38px}.open-link{gap:8px}.open-link .icon{width:15px;height:15px}.table-shell{margin-top:0}@media(max-width:900px){.table-shell{overflow-x:auto}table{min-width:940px}}
  .stats{display:flex;align-items:center;gap:28px;margin-top:34px;padding-top:22px;border-top:1px solid var(--line)}.stat{display:flex;align-items:baseline;gap:8px}.stat strong{font:700 24px Montserrat,Manrope,sans-serif;letter-spacing:-.04em}.stat span{color:var(--muted);font-size:12px}.live-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}@media(max-width:560px){.stats{align-items:flex-start;flex-direction:column;gap:12px}.stat strong{font-size:20px}}
  main{padding:24px 0 52px}.nav{height:52px}.hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;max-width:none;padding:20px 0;border-bottom:1px solid var(--line)}.hero h1{margin:0;font-size:28px;line-height:1.1;letter-spacing:-.04em}.hero p{margin:5px 0 0;font-size:13px;line-height:1.5}.hero .actions{grid-column:2;grid-row:1/3;margin:0}.button{min-height:38px;padding:0 15px;border-radius:9px;font-size:12px}.stats{grid-column:1/-1;gap:22px;margin:2px 0 0;padding:12px 0 0}.stat strong{font-size:17px}.results{margin-top:22px}.section-head{margin-bottom:8px}.section-head span{font-size:18px}.table-shell,.score,.facts,.system-grid,.test-group{border-radius:8px}th{padding:9px 11px;font-size:9px}.result-link{min-height:48px;padding:10px 11px;font-size:12px}.cpu{font-size:10px}.score-cell{font-size:17px}.grade{width:27px;height:27px;border-radius:6px;font-size:11px}.flag{width:20px;height:20px;flex-basis:20px}.verification{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border:1px solid #31573a;border-radius:999px;color:var(--accent);font-size:9px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}.verification.off{border-color:#5b4b2c;color:var(--warn)}.result-heading{align-items:center;padding-bottom:18px;border-bottom:1px solid var(--line)}.result-heading h1{margin:5px 0 2px;font-size:30px}.score-badge strong{font-size:50px}.compact-score{margin-top:12px}.panel{padding:16px}.metric b{font-size:20px}.facts,.system-grid{margin-top:8px}.fact,.system-item{padding:12px}.fact span,.system-item span,.metric span{margin-bottom:3px}.details-section,.report-section{margin-top:24px}.test-group{margin-bottom:7px}.test-group>summary{padding:11px 13px}.test-group h3{font-size:13px}.detail-item{min-height:62px;padding:11px 13px}.detail-item b{margin-top:4px;font-size:13px}.services-grid{padding:5px}.service-item{padding:7px;font-size:12px}.attestation{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin-top:8px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--line)}.attestation .system-item{background:var(--surface)}.signature{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}.report-gallery{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.report-gallery a{border-radius:8px}@media(max-width:900px){.table-shell{overflow:hidden}table{min-width:0!important;table-layout:fixed}th:nth-child(3),td:nth-child(3),th:nth-child(4),td:nth-child(4),th:nth-child(5),td:nth-child(5){display:none}th:nth-child(1){width:104px}th:nth-child(6){width:62px}th:nth-child(7){width:112px}th:nth-child(8){width:42px}.result-link{padding-left:8px;padding-right:8px}}@media(max-width:760px){.hero{display:block}.hero .actions{margin-top:15px}.stats{margin-top:15px}.attestation{grid-template-columns:1fr 1fr}.report-gallery{grid-template-columns:1fr}.result-heading{align-items:flex-start}.compact-score .metrics{grid-template-columns:1fr 1fr}}@media(max-width:560px){.wrap{width:min(100% - 20px,1180px)}.hero h1{font-size:23px}.section-head b{display:none}th:nth-child(7),td:nth-child(7){display:none}th:nth-child(1){width:94px}th:nth-child(6){width:54px}th:nth-child(8){width:38px}}
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
  const demo = r.verification_level === "demo";
  const verified = Number(r.verified) === 1;
  const statusLabel = demo ? "Демонстрационные данные" : verified ? "Source-bound · Worker score" : "Не подтверждено";
  const security = `<section class="attestation">${item("СТАТУС", statusLabel, "system-item")}${item("EDGE", [r.edge_colo, r.edge_country].filter(present).join(" · "), "system-item")}${item("ASN EDGE", r.edge_asn ? `AS${r.edge_asn} ${r.edge_org || ""}` : "—", "system-item")}${item("RTT ДО CLOUDFLARE", r.edge_rtt_ms != null ? `${r.edge_rtt_ms} ms` : "—", "system-item")}${item("ВНЕШНИЕ PROBES", r.external_probe_status === "edge-only" ? "Только edge attestation" : r.external_probe_status, "system-item")}${!demo ? item("ПОДПИСЬ", r.signature ? r.signature.slice(0, 20) + "…" : "—", "system-item signature") : ""}</section>`;
  return shell(`Тест ${r.id}`, `<main><a class="back" href="/">← Все тесты</a><div class="result-heading"><div><div class="eyebrow">ТЕСТ ${escapeHtml(r.id)} · ${escapeHtml(r.created_at)} · <span class="verification ${verified ? "" : "off"}">${demo ? "DEMO" : verified ? "ПОДТВЕРЖДЁН" : "НЕ ПОДТВЕРЖДЁН"}</span></div><h1 class="result-location">${appleFlag(r.country)}<span>${escapeHtml(countryLabel(r.country))} · ${escapeHtml(r.city)}</span></h1><p class="muted">${present(r.server_vendor) ? `${escapeHtml(r.server_vendor)} · ` : ""}${present(r.cpu) ? escapeHtml(r.cpu) : "Результат диагностики сервера"}</p></div><div class="score-badge"><strong>${clamp(r.score)}</strong><span>/ 100 · ${escapeHtml(r.grade)}</span></div></div>
  <section class="score compact-score"><div class="panel metrics"><div class="metric"><span>СЕТЬ</span><b>${clamp(r.network_score)}</b></div><div class="metric"><span>ПРОИЗВОДИТЕЛЬНОСТЬ</span><b>${clamp(r.performance_score)}</b></div><div class="metric"><span>КАЧЕСТВО IP</span><b>${clamp(r.quality_score)}</b></div><div class="metric"><span>ПОКРЫТИЕ</span><b>${clamp(r.coverage)}%</b></div></div></section>
  ${facts ? `<section class="facts">${facts}</section>` : ""}${system ? `<section class="system-grid">${system}</section>` : ""}${security}
  ${gallery}${renderDetailedResults(r)}
  <div class="actions"><a class="button secondary" href="https://github.com/kapybarovv/servergrade">${icon("github")}Методика на GitHub</a></div></main>`);
}

function renderHome(rows, stars, stats) {
  const rowsHtml = rows.length ? rows.map((r) => { const href = `/test/${escapeHtml(r.id)}`; const demo = r.verification_level === "demo"; const verified = Number(r.verified) === 1; return `<tr><td><a class="result-link" href="${href}">#${escapeHtml(r.id)}</a></td><td><a class="result-link regular" href="${href}">${location(r.country, r.city)}${present(r.cpu) ? `<span class="cpu">${present(r.server_vendor) ? `${escapeHtml(r.server_vendor)} · ` : ""}${escapeHtml(r.cpu)}</span>` : ""}</a></td><td><a class="result-link regular" href="${href}">${present(r.cores) ? escapeHtml(r.cores) : "—"}</a></td><td><a class="result-link regular" href="${href}">${present(r.ram) ? escapeHtml(r.ram) : "—"}${present(r.ram_type) ? `<span class="cpu">${escapeHtml(r.ram_type)}</span>` : ""}</a></td><td><a class="result-link regular" href="${href}">${present(r.disk) ? escapeHtml(r.disk) : "—"}${present(r.disk_type) ? `<span class="cpu">${escapeHtml(r.disk_type)}</span>` : ""}</a></td><td><a class="result-link score-cell" href="${href}">${clamp(r.score)}</a></td><td><a class="result-link" href="${href}"><span class="verification ${verified ? "" : "off"}">${demo ? "DEMO" : verified ? "VERIFIED" : "UNVERIFIED"}</span></a></td><td><a class="result-link open-link" href="${href}" aria-label="Открыть тест ${escapeHtml(r.id)}">${icon("arrow")}</a></td></tr>`; }).join("") : `<tr><td class="empty" colspan="8">Пока нет опубликованных результатов.</td></tr>`;
  const command = "bash <(curl -fsSL https://raw.githubusercontent.com/kapybarovv/servergrade/main/servergrade.sh)";
  return shell("Результаты тестов", `<main><section class="hero"><div><h1>ServerGrade / benchmark index</h1><p>Технические замеры VPS. Баллы считаются на сервере; подтверждённые запуски привязаны к исходному IP.</p></div><div class="actions"><button class="button" type="button" data-copy="${escapeHtml(command)}">${icon("copy")}Запустить</button><a class="button secondary" href="https://github.com/kapybarovv/servergrade">${icon("github")}GitHub</a></div><div class="stats"><div class="stat"><strong>${Number(stats.total || 0).toLocaleString("ru-RU")}</strong><span>всего</span></div><div class="stat"><strong>${Number(stats.verified || 0).toLocaleString("ru-RU")}</strong><span>подтверждено</span></div><div class="stat"><strong>${Number(stats.today || 0).toLocaleString("ru-RU")}</strong><span>сегодня</span></div><div class="stat"><i class="live-dot"></i><strong>${Number(stats.active || 0).toLocaleString("ru-RU")}</strong><span>сейчас</span></div></div></section><section class="results"><div class="section-head"><span>Последние замеры</span><b>verified участвуют в рейтинге</b></div><div class="table-shell"><table><thead><tr><th>ID</th><th>ЛОКАЦИЯ / CPU</th><th>ЯДРА</th><th>RAM</th><th>ДИСК</th><th>SCORE</th><th>АТТЕСТАЦИЯ</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div></section></main>`, stars);
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

async function createChallenge(request, env) {
  const secret = await serverSecret(env);
  const ipHash = await hmac(secret, clientIp(request));
  await env.DB.prepare("DELETE FROM result_challenges WHERE expires_at < datetime('now','-1 day')").run();
  const recent = await env.DB.prepare("SELECT COUNT(*) count FROM result_challenges WHERE source_ip_hash=? AND created_at > datetime('now','-1 hour')").bind(ipHash).first();
  if (Number(recent?.count || 0) >= 12) return Response.json({ error: "challenge_rate_limit" }, { status: 429 });
  let id;
  for (let attempt = 0; attempt < 8; attempt++) {
    id = resultId();
    const exists = await env.DB.prepare("SELECT 1 FROM results WHERE id=? UNION SELECT 1 FROM result_challenges WHERE id=?").bind(id, id).first();
    if (!exists) break;
  }
  const nonce = randomHex(32);
  const cf = request.cf || {};
  const edgeRtt = Number.isFinite(Number(cf.clientTcpRtt)) ? Math.round(Number(cf.clientTcpRtt)) : Number.isFinite(Number(cf.clientQuicRtt)) ? Math.round(Number(cf.clientQuicRtt)) : null;
  await env.DB.prepare("INSERT INTO result_challenges(id,nonce_hash,source_ip_hash,created_at,expires_at,edge_country,edge_asn,edge_org,edge_rtt_ms,edge_colo) VALUES(?,?,?,datetime('now'),datetime('now','+2 hours'),?,?,?,?,?)")
    .bind(id, await hmac(secret, nonce), ipHash, String(cf.country || "—"), cf.asn == null ? null : Number(cf.asn), String(cf.asOrganization || "—").slice(0, 160), edgeRtt, String(cf.colo || "—")).run();
  return Response.json({ test_id: id, nonce, expires_in: 7200 }, { status: 201, headers: { "cache-control": "no-store" } });
}

async function publish(request, env) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/x-www-form-urlencoded")) return new Response("Expected form data", { status: 415 });
  const raw = await request.text();
  if (raw.length > 320_000) return new Response("Payload too large", { status: 413 });
  const form = new URLSearchParams(raw);
  const statusBlob = (form.get("test_statuses") || "").slice(0, 16000);
  const metricsBlob = (form.get("metrics") || "").slice(0, 50000);
  const servicesBlob = (form.get("services") || "").slice(0, 50000);
  const scores = calculateScores(statusBlob, metricsBlob, servicesBlob);
  const secret = await serverSecret(env);
  const ipHash = await hmac(secret, clientIp(request));
  const challengeId = form.get("challenge_id") || "";
  const nonce = form.get("nonce") || "";
  let challenge = null;
  if (/^\d{8}$/.test(challengeId) && /^[a-f0-9]{64}$/.test(nonce)) {
    challenge = await env.DB.prepare("SELECT * FROM result_challenges WHERE id=? AND used_at IS NULL AND expires_at > datetime('now')").bind(challengeId).first();
    if (!challenge || challenge.source_ip_hash !== ipHash || challenge.nonce_hash !== await hmac(secret, nonce)) challenge = null;
  }
  const verified = Boolean(challenge);
  let id = verified ? challengeId : resultId();
  if (!verified) for (let attempt = 0; attempt < 7; attempt++) { const exists = await env.DB.prepare("SELECT 1 FROM results WHERE id=?").bind(id).first(); if (!exists) break; id = resultId(); }
  if (verified) {
    const claimed = await env.DB.prepare("UPDATE result_challenges SET used_at=datetime('now') WHERE id=? AND used_at IS NULL").bind(id).run();
    if (!claimed.meta?.changes) return Response.json({ error: "challenge_already_used" }, { status: 409 });
  }
  const country = verified && present(challenge.edge_country) ? challenge.edge_country : form.get("country") || "—";
  const values = [id, new Date().toISOString(), scores.total, scores.grade, scores.network, scores.performance, scores.quality, scores.coverage, country, form.get("city") || "—", (form.get("cpu") || "—").slice(0, 160), (form.get("cores") || "—").slice(0, 16), (form.get("ram") || "—").slice(0, 32), (form.get("ram_type") || "не раскрыт").slice(0, 32), (form.get("disk") || "—").slice(0, 32), (form.get("disk_type") || "не раскрыт").slice(0, 48), (form.get("disk_model") || "не раскрыт").slice(0, 120), (form.get("server_vendor") || "не раскрыт").slice(0, 160), (form.get("report_url") || "").slice(0, 500), (form.get("runner_version") || "unknown").slice(0, 32)];
  await env.DB.prepare("INSERT INTO results(id,created_at,score,grade,network_score,performance_score,quality_score,coverage,country,city,cpu,cores,ram,ram_type,disk,disk_type,disk_model,server_vendor,report_url,runner_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...values).run();
  const authoritativeAsn = verified && challenge.edge_asn ? `AS${challenge.edge_asn} · ${challenge.edge_org}` : form.get("asn") || "—";
  const details = [id, authoritativeAsn, form.get("os") || "—", form.get("kernel") || "—", form.get("arch") || "—", form.get("virtualization") || "—", form.get("congestion_control") || "—", form.get("qdisc") || "—", form.get("uptime") || "—", form.get("load_avg") || "—", form.get("has_ipv4") === "1" ? 1 : 0, form.get("has_ipv6") === "1" ? 1 : 0, statusBlob, metricsBlob, servicesBlob];
  await env.DB.prepare("INSERT INTO result_details(result_id,asn,os,kernel,arch,virtualization,congestion_control,qdisc,uptime,load_avg,has_ipv4,has_ipv6,test_statuses,metrics,services) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...details).run();
  const immutableAt = new Date().toISOString();
  const signaturePayload = JSON.stringify({ id, immutableAt, score: scores.total, network: scores.network, performance: scores.performance, quality: scores.quality, coverage: scores.coverage, ipHash, challengeId: verified ? id : null, metrics: await hmac(secret, metricsBlob), services: await hmac(secret, servicesBlob) });
  const signature = await hmac(secret, signaturePayload);
  await env.DB.prepare("INSERT INTO result_security(result_id,verified,verification_level,challenge_id,signature,source_ip_hash,edge_country,edge_asn,edge_org,edge_rtt_ms,edge_colo,external_probe_status,immutable_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, verified ? 1 : 0, verified ? "source-bound" : "unverified", verified ? id : null, signature, ipHash, challenge?.edge_country || "—", challenge?.edge_asn ?? null, challenge?.edge_org || "—", challenge?.edge_rtt_ms ?? null, challenge?.edge_colo || "—", verified ? "edge-only" : "not-run", immutableAt).run();
  const pagesExpected = Math.max(0, Math.min(8, Number.parseInt(form.get("pages_expected"), 10) || 0));
  const uploadToken = pagesExpected ? randomHex(24) : "";
  if (pagesExpected) await env.DB.prepare("INSERT INTO secure_upload_tokens(result_id,token_hash,expires_at,expected_count) VALUES(?,?,datetime('now','+10 minutes'),?)").bind(id, await hmac(secret, uploadToken), pagesExpected).run();
  return Response.json({ id, url: `${new URL(request.url).origin}/test/${id}`, verified, score: scores, upload_token: uploadToken || undefined, upload_expires_in: pagesExpected ? 600 : undefined }, { status: 201, headers: { "cache-control": "no-store" } });
}

async function uploadAsset(request, env, id) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/x-www-form-urlencoded")) return new Response("Expected form data", { status: 415 });
  const raw = await request.text();
  if (raw.length > 1_500_000) return new Response("Asset too large", { status: 413 });
  const form = new URLSearchParams(raw);
  const token = form.get("token") || "";
  const secret = await serverSecret(env);
  const access = await env.DB.prepare("SELECT expected_count,uploaded_count FROM secure_upload_tokens WHERE result_id=? AND token_hash=? AND expires_at > datetime('now')").bind(id, await hmac(secret, token)).first();
  if (!access) return new Response("Forbidden", { status: 403 });
  const position = Math.max(1, Math.min(8, Number.parseInt(form.get("position"), 10) || 0));
  const svg = form.get("svg") || "";
  if (!position || svg.length > 1_200_000 || !svg.includes("<svg")) return new Response("Invalid asset", { status: 400 });
  const name = (form.get("name") || `Страница ${position}`).slice(0, 80);
  try {
    await env.DB.prepare("INSERT INTO result_assets(result_id,position,name,mime,data) VALUES(?,?,?,'image/svg+xml',?)").bind(id, position, name, svg).run();
  } catch { return new Response("Asset is immutable", { status: 409 }); }
  const uploaded = Number(access.uploaded_count || 0) + 1;
  if (uploaded >= Number(access.expected_count)) await env.DB.prepare("DELETE FROM secure_upload_tokens WHERE result_id=?").bind(id).run();
  else await env.DB.prepare("UPDATE secure_upload_tokens SET uploaded_count=? WHERE result_id=?").bind(uploaded, id).run();
  return Response.json({ ok: true, complete: uploaded >= Number(access.expected_count), url: `${new URL(request.url).origin}/assets/${id}/${position}.svg` }, { status: 201 });
}

async function updateRun(request, env) {
  const raw = await request.text();
  if (raw.length > 256) return new Response("Payload too large", { status: 413 });
  const form = new URLSearchParams(raw);
  const id = form.get("id") || "";
  const action = form.get("action") || "ping";
  if (!/^\d{10}-\d{1,8}-\d{1,5}$/.test(id)) return new Response("Invalid run id", { status: 400 });
  if (action === "end") {
    await env.DB.prepare("DELETE FROM active_runs WHERE id=?").bind(id).run();
  } else if (action === "start" || action === "ping") {
    await env.DB.prepare("INSERT INTO active_runs(id,started_at,updated_at) VALUES(?,datetime('now'),datetime('now')) ON CONFLICT(id) DO UPDATE SET updated_at=datetime('now')").bind(id).run();
  } else {
    return new Response("Invalid action", { status: 400 });
  }
  return Response.json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/favicon.svg") {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#78cf87"/><path d="M42 20H27a8 8 0 0 0 0 16h10a5 5 0 0 1 0 10H20" fill="none" stroke="#0d0f0e" stroke-width="7" stroke-linecap="round"/></svg>', { headers: { "content-type": "image/svg+xml", "cache-control": "public,max-age=86400" } });
    }
    if (request.method === "POST" && url.pathname === "/api/runs") return updateRun(request, env);
    if (request.method === "POST" && url.pathname === "/api/challenges") return createChallenge(request, env);
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
        env.DB.prepare("SELECT r.*,d.*,s.verified,s.verification_level,s.signature,s.edge_country,s.edge_asn,s.edge_org,s.edge_rtt_ms,s.edge_colo,s.external_probe_status,s.immutable_at FROM results r LEFT JOIN result_details d ON d.result_id=r.id LEFT JOIN result_security s ON s.result_id=r.id WHERE r.id=?").bind(match[1]).first(),
        env.DB.prepare("SELECT position,name FROM result_assets WHERE result_id=? ORDER BY position").bind(match[1]).all(),
      ]);
      return row ? new Response(renderResult(row, assets.results || []), { headers }) : new Response("Result not found", { status: 404 });
    }
    if (request.method === "GET" && url.pathname === "/") {
      await env.DB.prepare("DELETE FROM active_runs WHERE updated_at < datetime('now','-45 minutes')").run();
      const [query, stars, stats] = await Promise.all([
        env.DB.prepare("SELECT r.id,r.created_at,r.score,r.grade,r.country,r.city,r.cpu,r.cores,r.ram,r.ram_type,r.disk,r.disk_type,r.server_vendor,COALESCE(s.verified,0) verified,COALESCE(s.verification_level,'legacy') verification_level FROM results r LEFT JOIN result_security s ON s.result_id=r.id ORDER BY r.created_at DESC LIMIT 64").all(),
        githubStars(),
        env.DB.prepare("SELECT (SELECT COUNT(*) FROM results r LEFT JOIN result_security s ON s.result_id=r.id WHERE COALESCE(s.verification_level,'legacy')!='demo') total,(SELECT COUNT(*) FROM result_security WHERE verified=1) verified,(SELECT COUNT(*) FROM results r LEFT JOIN result_security s ON s.result_id=r.id WHERE date(r.created_at)=date('now') AND COALESCE(s.verification_level,'legacy')!='demo') today,(SELECT COUNT(*) FROM active_runs) active").first(),
      ]);
      return new Response(renderHome(query.results || [], stars, stats || {}), { headers });
    }
    return new Response("Not found", { status: 404 });
  }
};
