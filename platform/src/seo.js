const DEFAULT_ORIGIN = "https://servergrade.cc";
const INDEXABLE = "index, follow, max-image-preview:large";
const NOINDEX = "noindex, nofollow";
const VALID_ID = /^\d{8}$/;

export const SITEMAP_PAGE_SIZE = 1000;
export const SITEMAP_RESULTS_QUERY = "SELECT id,created_at FROM results ORDER BY created_at DESC,id LIMIT ? OFFSET ?";

// Canonicals never depend on an untrusted Host header or tracking parameters.
export function seoOrigin(env = {}) {
  try {
    const url = new URL(env.PUBLIC_ORIGIN || DEFAULT_ORIGIN);
    if (url.protocol === "https:" && !url.username && !url.password) return url.origin;
  } catch {}
  return DEFAULT_ORIGIN;
}

function text(value, limit = 120) {
  if (value == null) return "";
  const clean = String(value).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || /^(?:—|–|-|unknown|n\/?a|null|undefined|не раскрыт[ао]?|неизвестно|нет данных)$/i.test(clean)) return "";
  const characters = Array.from(clean);
  return characters.length > limit ? characters.slice(0, limit - 1).join("").trimEnd() + "…" : clean;
}

export function escapeXml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function validId(value) {
  const id = String(value ?? "");
  if (!VALID_ID.test(id)) throw new RangeError("Expected an eight-digit result ID");
  return id;
}

function score(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100 ? number : null;
}

function location(row) {
  const raw = text(row.country, 60).replace(/[\u{1f1e6}-\u{1f1ff}]/gu, "").trim();
  let country = raw;
  if (/^[a-z]{2}$/i.test(raw)) {
    if (["XX", "ZZ"].includes(raw.toUpperCase())) country = "";
    else {
      try { country = new Intl.DisplayNames(["ru"], { type: "region", fallback: "code" }).of(raw.toUpperCase()); }
      catch { country = raw.toUpperCase(); }
    }
  }
  return [country, text(row.city, 60)].filter(Boolean).join(", ");
}

function coreLabel(value) {
  const cores = text(value, 24);
  if (!cores) return "";
  if (!/^\d+$/.test(cores)) return `ядер: ${cores}`;
  const n = Number(cores), lastTwo = n % 100, last = n % 10;
  const ending = lastTwo >= 11 && lastTwo <= 14 ? "ядер" : last === 1 ? "ядро" : last >= 2 && last <= 4 ? "ядра" : "ядер";
  return `${cores} ${ending}`;
}

function publishedAt(value) {
  const raw = String(value || "");
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/);
  if (!match) return "";
  const day = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== raw.slice(0, 10)) return "";
  const normalized = raw.length === 10 ? raw + "T00:00:00Z" : raw.replace(" ", "T") + (/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? "" : "Z");
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function resultSummary(row) {
  const id = validId(row.id), place = location(row);
  const cpu = text(row.cpu, 100), cores = coreLabel(row.cores), ram = text(row.ram, 36);
  const disk = [text(row.disk, 48), text(row.disk_type, 24)].filter(Boolean).join(" · ");
  const provider = text(row.asn, 110) || text(row.provider, 110);
  const configuration = [cpu && `процессор ${cpu}`, cores, ram && `RAM ${ram}`, disk && `диск ${disk}`].filter(Boolean);
  const parts = [`Тест сервера #${id}${place ? `: ${place}` : ""}.`];
  if (configuration.length) parts.push(`Конфигурация: ${configuration.join(", ")}.`);
  if (provider) parts.push(`ASN / провайдер: ${provider}.`);
  const rating = score(row.score);
  if (rating !== null) parts.push(`Рейтинг ServerGrade — ${rating}/100.`);
  return parts.join(" ");
}

export function seoRobots(pathname = "/", status = 200) {
  const path = String(pathname).split(/[?#]/, 1)[0];
  return status === 200 && (path === "/" || /^\/test\/\d{8}$/.test(path)) ? INDEXABLE : NOINDEX;
}

export function homeSeo(env = {}) {
  const origin = seoOrigin(env), canonical = origin + "/";
  const title = "ServerGrade — бенчмарки VPS и серверов";
  const description = "Результаты тестов VPS и серверов: процессор, память, диск, скорость сети и доступность сервисов. Запустите открытый бенчмарк и поделитесь отчётом ServerGrade.";
  return {
    title, description, canonical, image: origin + "/preview.png", imageAlt: "ServerGrade — бенчмарки VPS и серверов",
    imageWidth: 1200, imageHeight: 630, robots: INDEXABLE,
    structuredData: { "@context": "https://schema.org", "@type": "WebSite", "@id": canonical + "#website", name: "ServerGrade", url: canonical, description, inLanguage: "ru-RU" },
  };
}

export function resultSeo(row, env = {}, { dedicatedPreview = false } = {}) {
  const id = validId(row.id), origin = seoOrigin(env), canonical = `${origin}/test/${id}`;
  const cpu = text(row.cpu, 42), place = text(location(row), 36);
  const title = `Тест ${cpu || "сервера"}${place ? ` · ${place}` : ""} #${id} — ServerGrade`;
  const description = resultSummary(row), published = publishedAt(row.created_at);
  const dataset = {
    "@type": "Dataset", "@id": canonical + "#measurements", name: `Результаты теста сервера #${id}`,
    description, url: canonical, identifier: id, inLanguage: "ru-RU", isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: "ServerGrade", url: origin + "/" },
    includedInDataCatalog: { "@type": "DataCatalog", name: "Бенчмарки ServerGrade", url: origin + "/" },
  };
  if (published) dataset.datePublished = published;
  const variables = [["Рейтинг ServerGrade", row.score], ["Оценка сети", row.network_score], ["Оценка производительности", row.performance_score], ["Оценка качества IP", row.quality_score]]
    .filter(([, value]) => score(value) !== null).map(([name]) => name + " (0–100)");
  if (variables.length) dataset.variableMeasured = variables;
  return {
    title, description, canonical, image: `${canonical}/preview.png`, imageAlt: `Результаты теста сервера #${id} — ServerGrade`,
    ...(dedicatedPreview ? { imageWidth: 1200, imageHeight: 630 } : {}), robots: INDEXABLE,
    structuredData: { "@context": "https://schema.org", "@graph": [
      { "@type": "WebPage", "@id": canonical + "#webpage", url: canonical, name: title, description, inLanguage: "ru-RU", isPartOf: { "@id": origin + "/#website" }, mainEntity: { "@id": canonical + "#measurements" } },
      dataset,
    ] },
  };
}

// Google recommends unique descriptions and self-referential canonicals. JSON
// escaping is separate from attribute escaping so report data cannot close a
// JSON-LD script element. No host ratings or unsupported search actions added.
export function renderSeoHead(meta) {
  const tag = (name, value, property = false) => `<meta ${property ? "property" : "name"}="${name}" content="${escapeXml(value)}">`;
  const parts = [
    `<title>${escapeXml(meta.title)}</title>`, tag("description", meta.description),
    `<link rel="canonical" href="${escapeXml(meta.canonical)}">`, tag("robots", meta.robots || NOINDEX),
    tag("og:type", "website", true), tag("og:site_name", "ServerGrade", true), tag("og:locale", "ru_RU", true),
    tag("og:title", meta.title, true), tag("og:description", meta.description, true), tag("og:url", meta.canonical, true),
    tag("og:image", meta.image, true), tag("og:image:secure_url", meta.image, true), tag("og:image:type", "image/png", true), tag("og:image:alt", meta.imageAlt, true),
    tag("twitter:card", "summary_large_image"), tag("twitter:title", meta.title), tag("twitter:description", meta.description), tag("twitter:image", meta.image), tag("twitter:image:alt", meta.imageAlt),
  ];
  if (Number.isInteger(meta.imageWidth) && Number.isInteger(meta.imageHeight) && meta.imageWidth > 0 && meta.imageHeight > 0) {
    parts.push(tag("og:image:width", meta.imageWidth, true), tag("og:image:height", meta.imageHeight, true));
  }
  if (meta.structuredData) {
    const json = JSON.stringify(meta.structuredData).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
    parts.push(`<script type="application/ld+json">${json}</script>`);
  }
  return parts.join("\n");
}

export function robotsResponse(env = {}) {
  // Do not block /admin in robots.txt: crawlers must see its noindex header.
  // Protected API endpoints also return X-Robots-Tag; robots is not access control.
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${seoOrigin(env)}/sitemap.xml\n`, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

function xmlResponse(body) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
}

export function sitemapResponse(env = {}, rows = [], { includeHome = true } = {}) {
  const origin = seoOrigin(env), urls = [], seen = new Set();
  if (includeHome) urls.push(`<url><loc>${escapeXml(origin + "/")}</loc></url>`);
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!VALID_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const modified = publishedAt(row.created_at);
    urls.push(`<url><loc>${escapeXml(`${origin}/test/${id}`)}</loc>${modified ? `<lastmod>${escapeXml(modified)}</lastmod>` : ""}</url>`);
  }
  if (urls.length > 50_000) throw new RangeError("Split sitemap into pages of at most 50,000 URLs");
  return xmlResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
}

export function sitemapIndexResponse(env = {}, resultCount = 0) {
  const origin = seoOrigin(env);
  if (!Number.isSafeInteger(resultCount) || resultCount < 0) throw new RangeError("Invalid result count");
  const pages = Math.max(1, Math.ceil(resultCount / SITEMAP_PAGE_SIZE));
  if (pages > 50_000) throw new RangeError("Split sitemap index before exceeding 50,000 entries");
  const entries = Array.from({ length: pages }, (_, index) => `<sitemap><loc>${escapeXml(`${origin}/sitemap-${index + 1}.xml`)}</loc></sitemap>`);
  return xmlResponse(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>`);
}
