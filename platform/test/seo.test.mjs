import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  escapeXml, homeSeo, renderSeoHead, resultSeo, resultSummary, robotsResponse,
  seoOrigin, seoRobots, sitemapIndexResponse, sitemapResponse,
  SITEMAP_PAGE_SIZE, SITEMAP_RESULTS_QUERY,
} from "../src/seo.js";

const row = {
  id: "40742053", created_at: "2026-11-21 03:31:00", cpu: "AMD EPYC 7B13",
  cores: "4", ram: "8 GiB", disk: "80 GB", disk_type: "NVMe SSD",
  country: "NL", city: "Amsterdam", asn: "AS12586 · Example Hosting",
  score: 76, network_score: 72, performance_score: 82, quality_score: 70,
};

test("canonical origin is normalized from trusted config, never from a request host", () => {
  assert.equal(seoOrigin(), "https://servergrade.cc");
  assert.equal(seoOrigin({ PUBLIC_ORIGIN: "https://EXAMPLE.com:443/path?campaign=x#fragment" }), "https://example.com");
  for (const value of ["http://example.com", "//example.com", "javascript:alert(1)", "https://user:password@example.com", "broken"]) {
    assert.equal(seoOrigin({ PUBLIC_ORIGIN: value }), "https://servergrade.cc");
  }
  const meta = resultSeo(row);
  assert.equal(meta.canonical, "https://servergrade.cc/test/40742053");
  assert.equal(meta.image, "https://servergrade.cc/test/40742053/preview.png");
  assert.throws(() => resultSeo({ id: "40742053?x=1" }), /result ID/);
});

test("report summary and metadata describe the actual configuration and score", () => {
  const summary = resultSummary(row);
  for (const value of ["#40742053", "Нидерланды", "Amsterdam", "AMD EPYC 7B13", "4 ядра", "8 GiB", "80 GB", "NVMe SSD", "AS12586", "76/100"]) assert.ok(summary.includes(value), value);
  const meta = resultSeo(row);
  assert.equal(meta.description, summary);
  assert.match(meta.title, /AMD EPYC 7B13/);
  assert.match(meta.title, /40742053/);
  assert.notEqual(resultSeo({ ...row, id: "12345678", country: "DE", city: "Berlin" }).description, summary);
  assert.equal(meta.imageWidth, undefined, "Fallback report PNG may have different dimensions");
  assert.equal(resultSeo(row, {}, { dedicatedPreview: true }).imageWidth, 1200);
  assert.equal(resultSeo(row, {}, { dedicatedPreview: true }).imageHeight, 630);
});

test("missing measurements do not become invented configuration, verification or ratings", () => {
  const summary = resultSummary({ id: "12345678", cpu: "unknown", cores: "—", ram: "не раскрыт", disk: "N/A", country: "ZZ", asn: "—", score: "" });
  assert.equal(summary, "Тест сервера #12345678.");
  assert.equal(resultSummary({ id: "12345678", score: 0 }), "Тест сервера #12345678. Рейтинг ServerGrade — 0/100.");
  assert.doesNotMatch(resultSummary({ id: "12345678", score: 101 }), /100/);
  const schema = resultSeo(row).structuredData;
  const dataset = schema["@graph"].find((entry) => entry["@type"] === "Dataset");
  assert.equal(dataset.datePublished, "2026-11-21T03:31:00.000Z");
  assert.equal(dataset.creator, undefined, "The runner's author is not the measurement author");
  assert.equal(dataset.license, undefined, "Do not invent a license for submitted data");
  assert.doesNotMatch(JSON.stringify(schema), /AggregateRating|SearchAction|ratingValue|verified/i);
});

test("home and report sharing tags are server-rendered, escaped and JSON-LD cannot close its script", () => {
  const home = homeSeo();
  assert.equal(home.image, "https://servergrade.cc/preview.png");
  const homeHtml = renderSeoHead(home);
  assert.match(homeHtml, /property="og:image:width" content="1200"/);
  assert.match(homeHtml, /property="og:image:height" content="630"/);
  const dangerous = '</script><img src=x onerror="alert(1)">&\u2028';
  const meta = resultSeo({ ...row, cpu: dangerous, asn: dangerous });
  const html = renderSeoHead(meta);
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:image:type" content="image\/png"/);
  assert.doesNotMatch(html, /<img src=x|<\/script><img|og:image:width/);
  assert.ok(html.includes("&lt;/script&gt;"));
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /\\u003c/);
  assert.ok(JSON.parse(scripts[0][1])["@graph"][0].description.includes("</script>"));
});

test("only published home/report URLs are indexable; private APIs and errors are noindex", async () => {
  assert.match(seoRobots("/"), /^index/);
  assert.match(seoRobots("/test/40742053?utm_source=test"), /^index/);
  for (const path of ["/admin", "/api/admin/state", "/api/results", "/test/missing", "/other", "/test/40742053/preview.png"]) assert.equal(seoRobots(path), "noindex, nofollow");
  assert.equal(seoRobots("/test/40742053", 404), "noindex, nofollow");
  assert.equal(seoRobots("/", 500), "noindex, nofollow");
  const robots = await robotsResponse().text();
  assert.match(robots, /Sitemap: https:\/\/servergrade\.cc\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow: \/admin/, "Crawlers must be able to read the admin noindex header");
});

test("sitemap contains canonical published result URLs and truthful dates only", async () => {
  assert.equal(escapeXml('<&"\''), "&lt;&amp;&quot;&apos;");
  const response = sitemapResponse({}, [row, row, { id: "12345678", created_at: "2026-02-30 01:00:00" }, { id: "87654321", created_at: "garbage" }, { id: "<unsafe>" }]);
  assert.match(response.headers.get("content-type"), /application\/xml/);
  const xml = await response.text();
  assert.equal((xml.match(/<url>/g) || []).length, 4, "Home plus three distinct valid result IDs");
  assert.equal((xml.match(/<lastmod>/g) || []).length, 1, "Invalid dates do not turn into a current timestamp");
  assert.match(xml, /<lastmod>2026-11-21T03:31:00\.000Z<\/lastmod>/);
  assert.doesNotMatch(xml, /unsafe|garbage|admin|api|preview|priority|changefreq/);
  const page = await sitemapResponse({}, [row], { includeHome: false }).text();
  assert.equal((page.match(/<url>/g) || []).length, 1);
});

test("paged sitemap query covers all results without dropping older reports", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE results(id TEXT PRIMARY KEY,created_at TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO results(id,created_at) VALUES(?,?)");
    for (let index = 0; index < SITEMAP_PAGE_SIZE + 1; index++) insert.run(String(10_000_000 + index), "2026-11-21 03:31:00");
    const first = db.prepare(SITEMAP_RESULTS_QUERY).all(SITEMAP_PAGE_SIZE, 0);
    const second = db.prepare(SITEMAP_RESULTS_QUERY).all(SITEMAP_PAGE_SIZE, SITEMAP_PAGE_SIZE);
    assert.equal(first.length, SITEMAP_PAGE_SIZE);
    assert.equal(second.length, 1);
    assert.equal(new Set([...first, ...second].map((entry) => entry.id)).size, SITEMAP_PAGE_SIZE + 1);
    const index = await sitemapIndexResponse({}, SITEMAP_PAGE_SIZE + 1).text();
    assert.match(index, /https:\/\/servergrade\.cc\/sitemap-1\.xml/);
    assert.match(index, /https:\/\/servergrade\.cc\/sitemap-2\.xml/);
    assert.doesNotMatch(index, /sitemap-3/);
    assert.equal(((await sitemapIndexResponse({}, 0).text()).match(/<sitemap>/g) || []).length, 1);
  } finally { db.close(); }
});
