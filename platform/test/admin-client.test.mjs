import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, Script } from "node:vm";
import test from "node:test";

const platformDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://servergrade.test";
const sessionSecret = "b".repeat(64);

// These elements expose the browser operations used while registering handlers
// and rendering an empty dashboard. Network requests stay inside this test.
class Element {
  constructor() {
    this.value = "";
    this.files = [];
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.children = [];
    this.listeners = new Map();
    this.selectors = new Map();
    this.classList = { add() {}, toggle() {} };
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element());
    return this.selectors.get(selector);
  }

  setAttribute(name, value) { (this.attributes ||= new Map()).set(name, value); }
  removeAttribute(name) { this.attributes?.delete(name); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  reset() {}
  focus() {}
  scrollIntoView() {}

  append(...elements) {
    this.children.push(...elements);
  }

  replaceChildren(...elements) {
    this.children = elements;
  }
}

function browser(authenticated, adminState = { banners: [], results: [], pins: [] }) {
  const selectors = new Map();
  const element = (selector) => {
    if (!selectors.has(selector)) selectors.set(selector, new Element());
    return selectors.get(selector);
  };
  const loginForm = element("[data-login]");
  loginForm.elements = { password: new Element() };
  const bannerForm = element("[data-banner-form]");
  bannerForm.elements = Object.fromEntries([
    "image_file", "banner_id", "title", "image_url", "target_url", "enabled", "sort_order",
  ].map((name) => [name, new Element()]));
  const calls = [];
  let reloads = 0;
  const context = createContext({
    document: {
      body: { dataset: { authenticated: String(authenticated) } },
      querySelector: element,
      createElement: (tag) => { const element = new Element(); element.tagName = tag.toUpperCase(); return element; },
      createElementNS: () => new Element(),
    },
    window: {
      location: { reload() { reloads++; } },
      setTimeout,
      confirm: () => true,
    },
    fetch: async (path, options) => {
      calls.push({ path, options });
      assert.ok(path.startsWith("/api/admin/"));
      return {
        ok: true,
        status: 200,
        json: async () => path.startsWith("/api/admin/state")
          ? adminState
          : { ok: true },
      };
    },
    URL,
    Intl,
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: false }),
  });
  return { context, element, calls, loginForm, bannerForm, get reloads() { return reloads; } };
}

function runPage(html, page) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length, "The rendered admin page must include its client script");
  for (const [, source] of scripts) {
    new Script(source, { filename: "admin-page-inline.js" }).runInContext(page.context, { timeout: 1000 });
  }
}

async function buildWorker(directory) {
  const wrangler = process.env.WRANGLER_BIN || join(platformDirectory, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  const build = spawnSync(wrangler, ["deploy", "--dry-run", "--outdir", directory], {
    cwd: process.env.SERVERGRADE_BUILD_CWD || platformDirectory,
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
    },
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const filename = join(directory, "index.js");
  const source = readFileSync(filename, "utf8").replace(
    /^import\s+([A-Za-z_$][\w$]*)\s+from\s+["'](\.\/[^"']+)["'];?\s*$/gm,
    (_, name, file) => `const ${name} = ${JSON.stringify(readFileSync(resolve(directory, file), "utf8"))};`,
  );
  // Wrangler leaves Text modules as imports. Node receives their exact emitted
  // contents, so the test exercises the same client text served in production.
  const executable = join(directory, "worker-for-test.mjs");
  writeFileSync(executable, source);
  return (await import(pathToFileURL(executable).href)).default;
}

function environment() {
  const statement = {
    bind() { return this; },
    async run() { return { meta: { changes: 0 } }; },
  };
  return {
    PUBLIC_ORIGIN: origin,
    ADMIN_PASSWORD_HASH: "a".repeat(64),
    ADMIN_SESSION_SECRET: sessionSecret,
    DB: {
      prepare() { return statement; },
      async batch(statements) { return Promise.all(statements.map((item) => item.run())); },
    },
  };
}

function sessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ issued_at: now, expires_at: now + 12 * 60 * 60 })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update("servergrade-admin-session-v1." + payload).digest("hex");
  return `__Host-servergrade_admin=${payload}.${signature}`;
}

class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys=ON;");
    this.sqlite.exec(readFileSync(join(platformDirectory, "schema.sql"), "utf8"));
    this.pending = Promise.resolve();
  }
  prepare(sql) {
    const database = this;
    const statement = (bindings = []) => ({
      bind(...values) { return statement(values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value)); },
      async first() { const row = database.sqlite.prepare(sql).get(...bindings); return row ? { ...row } : null; },
      async all() { return { results: database.sqlite.prepare(sql).all(...bindings).map((row) => ({ ...row })) }; },
      async run() { const result = database.sqlite.prepare(sql).run(...bindings); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
    });
    return statement();
  }
  async batch(statements) {
    let release;
    const previous = this.pending;
    this.pending = new Promise((resolve) => { release = resolve; });
    await previous;
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (failure) {
      this.sqlite.exec("ROLLBACK");
      throw failure;
    } finally { release(); }
  }
}

function resultEnvironment(t, id = "12345678", expectedPages = 1) {
  const env = environment();
  env.DB = new SqliteD1();
  t.after(() => env.DB.sqlite.close());
  env.DB.sqlite.prepare("INSERT INTO results(id,created_at,score,grade,network_score,performance_score,quality_score,coverage,country,city,cpu,cores,ram,ram_type,disk,disk_type,disk_model,server_vendor,report_url,runner_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, "2026-11-21T12:00:00Z", 82, "Хорошо", 80, 82, 84, 100, "NL", "Amsterdam", "Synthetic CPU <script>", "2", "8 GiB", "DDR4", "80 GiB", "NVMe", "Virtual disk", "Synthetic vendor", "", "test");
  const secret = "synthetic-test-secret";
  const token = "a".repeat(48);
  env.DB.sqlite.prepare("INSERT INTO app_secrets(name,value,created_at) VALUES('attestation-v1',?,datetime('now'))").run(secret);
  env.DB.sqlite.prepare("INSERT INTO secure_upload_tokens(result_id,token_hash,expires_at,expected_count,uploaded_count) VALUES(?,?,datetime('now','+10 minutes'),?,0)")
    .run(id, createHmac("sha256", secret).update(token).digest("hex"), expectedPages);
  return { env, id, token };
}

function solidPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const chunk = (type, data) => {
    const name = Buffer.from(type), crcInput = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of crcInput) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return result;
  };
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk("IEND", Buffer.alloc(0))]);
}

const reportSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#39e492"/></svg>';
const reportPng = solidPng(40, 40);
const previewPng = solidPng(1200, 630);
function assetRequest(id, token, extra = {}) {
  return new Request(origin + "/api/results/" + id + "/assets", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token, position: "1", name: "Synthetic overview", svg: reportSvg, png: reportPng.toString("base64"), ...extra }) });
}

function asnEnvironment(t) {
  const env = environment();
  env.DB = new SqliteD1();
  t.after(() => env.DB.sqlite.close());
  const add = (options) => {
    const { id, score = 80, coverage = 100, verified = 1, security = true,
      edgeAsn = 64496, edgeOrg = "Synthetic edge organization",
      reportedAsn = "AS64496 · Synthetic reported organization",
      createdAt = "2026-11-20T10:00:00.000Z" } = options;
    env.DB.sqlite.prepare("INSERT INTO results(id,created_at,score,grade,network_score,performance_score,quality_score,coverage,country,city,cpu,cores,ram,ram_type,disk,disk_type,disk_model,server_vendor,report_url,runner_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, createdAt, score, "Хорошо", score, score, score, coverage, "NL", "Amsterdam", "Synthetic ASN CPU", "2", "8 GiB", "DDR4", "80 GiB", "NVMe", "Synthetic disk", "Synthetic vendor", "", "test");
    env.DB.sqlite.prepare("INSERT INTO result_details(result_id,asn,os,kernel,arch,virtualization,congestion_control,qdisc,uptime,load_avg,has_ipv4,has_ipv6,test_statuses,metrics,services) VALUES(?,?,'Linux','kernel','x86_64','kvm','cubic','fq_codel','1h','0',1,0,'','','')")
      .run(id, reportedAsn);
    if (security) env.DB.sqlite.prepare("INSERT INTO result_security(result_id,verified,verification_level,challenge_id,signature,source_ip_hash,edge_country,edge_asn,edge_org,edge_rtt_ms,edge_colo,external_probe_status,immutable_at) VALUES(?,?,?,NULL,'synthetic-signature','synthetic-hash','NL',?,?,5,'AMS','edge-only',?)")
      .run(id, verified, verified ? "source-bound" : "unverified", edgeAsn, edgeOrg, createdAt);
  };
  return { env, add };
}

function tableReportIds(html) {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  assert.ok(body, "The ASN page must render a server-side results table");
  return [...new Set([...body.matchAll(/href="(?:https:\/\/servergrade\.test)?\/test\/(\d{8})"/g)].map((match) => match[1]))];
}

function htmlAttributes(source) {
  return new Map([...source.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map((match) => [match[1], match[2] ?? ""]));
}

function reportPanels(html) {
  const stack = [], panels = [];
  for (const match of html.matchAll(/<(\/?)section\b([^>]*)>/g)) {
    if (!match[1]) {
      const attributes = htmlAttributes(match[2]);
      stack.push({ attributes, start: match.index + match[0].length });
    } else {
      const section = stack.pop();
      if (section?.attributes.has("data-result-view")) panels.push({ ...section, content: html.slice(section.start, match.index) });
    }
  }
  return panels;
}

function saveReportContent(env, id, { statuses = [], metrics = [], services = [], terminal = "" } = {}) {
  const rows = (values) => values.map((value) => value.join("\x1f")).join("\n");
  env.DB.sqlite.prepare("INSERT INTO result_details(result_id,asn,os,kernel,arch,virtualization,congestion_control,qdisc,uptime,load_avg,has_ipv4,has_ipv6,test_statuses,metrics,services) VALUES(?,'AS64496 · Synthetic provider','Linux','kernel','x86_64','kvm','cubic','fq_codel','1h','0',1,0,?,?,?)")
    .run(id, rows(statuses), rows(metrics), rows(services));
  env.DB.sqlite.prepare("INSERT INTO result_terminal_reports(result_id,content) VALUES(?,?)").run(id, terminal);
}

function assertReportScriptsCompile(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/application\/ld\+json/.test(match[1]));
  assert.ok(scripts.length > 0, "The report includes its browser handlers");
  new Script(scripts.map((match) => match[2]).join("\n;\n"), { filename: "report-inline-bundled.js" });
}

test("Wrangler-bundled admin pages register working browser handlers", async (suite) => {
  const directory = mkdtempSync(join(tmpdir(), "servergrade-admin-bundle-test-"));
  suite.after(() => rmSync(directory, { recursive: true, force: true }));
  const worker = await buildWorker(directory);
  const env = environment();

  await suite.test("login submits its password and reloads after success", async () => {
    const response = await worker.fetch(new Request(origin + "/admin"), env);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /data-authenticated="false"/);
    assert.match(html, /<form\b[^>]*\bmethod="post"[^>]*\baction="\/api\/admin\/login"/);
    const page = browser(false);
    runPage(html, page);
    const submit = page.loginForm.listeners.get("submit");
    assert.equal(typeof submit, "function", "The login submit handler must be registered");
    page.loginForm.elements.password.value = "synthetic-regression-test-password";
    let prevented = false;
    submit({ preventDefault() { prevented = true; } });
    await setImmediate();
    assert.equal(prevented, true);
    assert.equal(page.calls.length, 1);
    assert.equal(page.calls[0].path, "/api/admin/login");
    assert.equal(page.calls[0].options.method, "POST");
    assert.equal(page.calls[0].options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(page.calls[0].options.body), { password: "synthetic-regression-test-password" });
    assert.equal(page.loginForm.elements.password.value, "");
    assert.equal(page.reloads, 1);
  });

  await suite.test("authenticated dashboard fetches state and registers controls", async () => {
    const response = await worker.fetch(new Request(origin + "/admin", { headers: { cookie: sessionCookie() } }), env);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /data-authenticated="true"/);
    const page = browser(true);
    runPage(html, page);
    await setImmediate();
    assert.equal(page.calls.length, 1);
    assert.equal(page.calls[0].path, "/api/admin/state");
    assert.equal(page.calls[0].options.method, "GET");
    assert.equal(typeof page.bannerForm.listeners.get("submit"), "function");
    assert.equal(typeof page.element("[data-result-search]").listeners.get("input"), "function");
    assert.equal(typeof page.element("[data-logout]").listeners.get("click"), "function");
    assert.equal(typeof page.element("[data-reload]").listeners.get("click"), "function");
    assert.equal(page.element("[data-admin-content]").hidden, false);
    assert.equal(page.element("[data-loading]").hidden, true);
  });

  await suite.test("authenticated dashboard renders and edits MP4 banners with a video preview", async () => {
    const response = await worker.fetch(new Request(origin + "/admin", { headers: { cookie: sessionCookie() } }), env);
    const page = browser(true, { banners: [{ id: 12, title: "Synthetic video", image_url: "/api/admin/banners/12/image", image_mime: "video/mp4", target_url: "https://example.test/", enabled: 1, sort_order: 0 }], results: [], pins: [] });
    runPage(await response.text(), page);
    await setImmediate();
    const card = page.element("[data-banner-list]").children[0];
    const video = card.children.find((element) => element.tagName === "VIDEO");
    assert.ok(video, "The MP4 must render as a video rather than a broken image");
    assert.equal(video.muted, true); assert.equal(video.loop, true); assert.equal(video.playsInline, true);
    assert.equal(video.src, "/api/admin/banners/12/image");
    const controls = card.children.find((element) => element.className === "banner-actions");
    controls.children[1].listeners.get("click")();
    assert.equal(page.bannerForm.elements.banner_id.value, 12);
    assert.equal(page.element("[data-image-preview]").querySelector("video").src, "/api/admin/banners/12/image");
  });

  await suite.test("home preloads the current first banner and revalidates its HTML", async () => {
    const banners = [1, 2].map((id) => ({
      id, title: "Synthetic banner " + id, image_url: "", image_mime: "image/webp",
      target_url: "https://example.test/", enabled: 1, sort_order: id,
      has_image: 1, version: String(id).repeat(64),
    }));
    const homeEnv = environment();
    homeEnv.DB.prepare = (sql) => ({
      bind() { return this; },
      async run() { return { meta: { changes: 0 } }; },
      async first() { return {}; },
      async all() { return { results: sql.includes("FROM admin_banners b") ? banners : [] }; },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ stargazers_count: 20 });
    try {
      const response = await worker.fetch(new Request(origin + "/"), homeEnv);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control"), /no-cache/);
      const html = await response.text();
      const firstUrl = "/banners/1?v=" + "1".repeat(64);
      const secondUrl = "/banners/2?v=" + "2".repeat(64);
      assert.ok(html.includes('<link rel="preload" as="image" href="' + firstUrl + '" fetchpriority="high">'));
      const images = [...html.matchAll(/<img src="([^"]+)"[^>]*>/g)].map((match) => match[0]);
      const first = images.find((tag) => tag.includes(firstUrl));
      const second = images.find((tag) => tag.includes(secondUrl));
      assert.match(first, /loading="eager"/);
      assert.match(first, /fetchpriority="high"/);
      assert.match(second, /loading="lazy"/);
      assert.doesNotMatch(second, /fetchpriority="high"/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await suite.test("test reports place current banners above results and preload the first image", async () => {
    const banners = [1, 2].map((id) => ({
      id, title: "Synthetic banner " + id, image_url: "", image_mime: "image/webp",
      target_url: "https://example.test/", enabled: 1, sort_order: id,
      has_image: 1, version: String(id).repeat(64),
    }));
    const row = {
      id: "12345678", created_at: "2026-11-21T12:00:00Z", country: "NL", city: "Amsterdam",
      cpu: "Synthetic test CPU", score: 82, network_score: 80, performance_score: 82,
      quality_score: 84, coverage: 100,
    };
    const reportEnv = environment();
    reportEnv.DB.prepare = (sql) => ({
      bind() { return this; },
      async run() { return { meta: { changes: 0 } }; },
      async first() { return sql.includes("FROM results r") ? { ...row } : {}; },
      async all() {
        if (sql.includes("FROM admin_banners b")) {
          return { results: banners.filter((banner) => banner.enabled).sort((a, b) => a.sort_order - b.sort_order) };
        }
        return { results: [] };
      },
    });
    const response = await worker.fetch(new Request(origin + "/test/" + row.id), reportEnv);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-cache/);
    const html = await response.text();
    const firstUrl = "/banners/1?v=" + "1".repeat(64);
    const secondUrl = "/banners/2?v=" + "2".repeat(64);
    assert.match(html, /<main><aside class="ad-banners"/);
    assert.ok(html.indexOf(firstUrl, html.indexOf("<main>")) < html.indexOf('<a class="back"'));
    assert.ok(html.includes('<link rel="preload" as="image" href="' + firstUrl + '" fetchpriority="high">'));
    const images = [...html.matchAll(/<img src="([^"]+)"[^>]*>/g)].map((match) => match[0]);
    assert.match(images.find((tag) => tag.includes(firstUrl)), /loading="eager"[^>]*fetchpriority="high"/);
    assert.match(images.find((tag) => tag.includes(secondUrl)), /loading="lazy"/);
    assert.match(html, /aspect-ratio:auto 1348 \/ 150/);

    banners[0].version = "a".repeat(64);
    const updated = await worker.fetch(new Request(origin + "/test/" + row.id), reportEnv);
    const updatedHtml = await updated.text();
    assert.ok(updatedHtml.includes("/banners/1?v=" + banners[0].version));
    assert.ok(!updatedHtml.includes(firstUrl), "Refreshing the report must use the latest banner revision");

    banners.forEach((banner) => { banner.enabled = 0; });
    const hidden = await worker.fetch(new Request(origin + "/test/" + row.id), reportEnv);
    const hiddenHtml = await hidden.text();
    assert.doesNotMatch(hiddenHtml, /<aside class="ad-banners"/);
    assert.doesNotMatch(hiddenHtml, /<link rel="preload" as="image"/);
    assert.match(hiddenHtml, /class="result-heading"/);
  });

  await suite.test("report upload atomically stores both formats, social card and one page count", async (t) => {
    const { env, id, token } = resultEnvironment(t);
    const response = await worker.fetch(assetRequest(id, token, { preview_png: previewPng.toString("base64") }), env);
    assert.equal(response.status, 201);
    const published = await response.json();
    assert.equal(published.complete, true);
    assert.equal(published.png_url, origin + "/assets/" + id + "/1.png");
    assert.equal(published.preview_url, origin + "/test/" + id + "/preview.png");
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM result_assets").get().n, 1);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM result_png_assets").get().n, 1);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM result_png_previews").get().n, 1);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM secure_upload_tokens").get().n, 0);
    const png = await worker.fetch(new Request(published.png_url), env);
    assert.equal(png.status, 200); assert.equal(png.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await png.arrayBuffer()), reportPng);
    const head = await worker.fetch(new Request(published.png_url, { method: "HEAD" }), env);
    assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const social = await worker.fetch(new Request(published.preview_url), env);
    assert.deepEqual(Buffer.from(await social.arrayBuffer()), previewPng);
    const repeated = await worker.fetch(assetRequest(id, token), env);
    assert.equal(repeated.status, 403, "A consumed token must not add another format after completion");
  });

  await suite.test("invalid optional PNG cannot commit a partial SVG or consume its token", async (t) => {
    const { env, id, token } = resultEnvironment(t);
    const invalid = await worker.fetch(assetRequest(id, token, { png: Buffer.from("not a PNG").toString("base64") }), env);
    assert.equal(invalid.status, 400);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM result_assets").get().n, 0);
    assert.equal(env.DB.sqlite.prepare("SELECT uploaded_count FROM secure_upload_tokens").get().uploaded_count, 0);
    const wrongPreview = await worker.fetch(assetRequest(id, token, { preview_png: reportPng.toString("base64") }), env);
    assert.equal(wrongPreview.status, 400);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM result_assets").get().n, 0);
  });

  await suite.test("only one concurrent upload may consume the last remaining page", async (t) => {
    const { env, id, token } = resultEnvironment(t);
    const responses = await Promise.all([
      worker.fetch(assetRequest(id, token), env),
      worker.fetch(assetRequest(id, token, { position: "2" }), env),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 403]);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM result_assets").get().n, 1);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM result_png_assets").get().n, 1);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM secure_upload_tokens").get().n, 0);
  });

  await suite.test("individual report SEO, format downloads and crawl endpoints work without client JavaScript", async (t) => {
    const { env, id, token } = resultEnvironment(t);
    assert.equal((await worker.fetch(assetRequest(id, token, { preview_png: previewPng.toString("base64") }), env)).status, 201);
    const response = await worker.fetch(new Request(origin + "/test/" + id + "?utm_source=synthetic"), env);
    const html = await response.text();
    assert.match(html, /<title>Тест Synthetic CPU &lt;script&gt;/);
    assert.ok(html.includes('<link rel="canonical" href="' + origin + '/test/' + id + '">'));
    assert.ok(html.includes('<meta property="og:image" content="' + origin + '/test/' + id + '/preview.png">'));
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
    assert.match(html, /<p class="result-summary"/);
    assert.match(html, /<sub class="brand-version"[^>]*>v2\.0<\/sub>/);
    assert.match(html, /download="ServerGrade-12345678-1\.png"/);
    assert.match(html, /download="ServerGrade-12345678-1\.svg"/);
    const card = html.match(/<article class="report-card">([\s\S]*?)<\/article>/)[1];
    assert.ok(card.indexOf('</a><div class="report-downloads">') > 0, "Download links must sit outside the lightbox anchor");
    assert.match(response.headers.get("x-robots-tag"), /^index/);
    const robots = await worker.fetch(new Request(origin + "/robots.txt"), env);
    assert.ok((await robots.text()).includes("Sitemap: " + origin + "/sitemap.xml"));
    const index = await worker.fetch(new Request(origin + "/sitemap.xml"), env);
    assert.ok((await index.text()).includes(origin + "/sitemap-1.xml"));
    const page = await worker.fetch(new Request(origin + "/sitemap-1.xml"), env);
    assert.ok((await page.text()).includes(origin + "/test/" + id));
    const missing = await worker.fetch(new Request(origin + "/sitemap-2.xml"), env);
    assert.equal(missing.status, 404); assert.equal(missing.headers.get("x-robots-tag"), "noindex, nofollow");
    const privateResponse = await worker.fetch(new Request(origin + "/api/admin/state"), env);
    assert.equal(privateResponse.headers.get("x-robots-tag"), "noindex, nofollow");
    const generic = await worker.fetch(new Request(origin + "/preview.png"), env);
    assert.equal(generic.status, 200); assert.equal(generic.headers.get("content-type"), "image/png");
  });

  await suite.test("report format URLs render accessible selected panels and useful native disclosures without JavaScript", async (t) => {
    const { env, id } = resultEnvironment(t);
    saveReportContent(env, id, {
      statuses: [["run_empty", "Synthetic status only", "ошибка"], ["run_region", "Synthetic IP region", "выполнен"], ["run_network", "Synthetic network", "выполнен"]],
      metrics: [["run_region", "IPv4 region", "NL", "ok"]],
      services: [["run_network", "service", "example.test", "", "ok", "45 ms"]],
    });
    const response = await worker.fetch(new Request(origin + "/test/" + id + "?view=full"), env);
    assert.equal(response.status, 200);
    const html = await response.text();
    const tabs = [...html.matchAll(/<a\b([^>]*\brole="tab"[^>]*)>/g)].map((match) => htmlAttributes(match[1]));
    assert.equal(tabs.length, 3);
    const selected = tabs.filter((attributes) => attributes.get("aria-selected") === "true");
    assert.equal(selected.length, 1);
    assert.equal(selected[0].get("aria-controls"), "report-full");
    assert.ok(selected[0].get("class").split(/\s+/).includes("active"));
    assert.equal(selected[0].get("href"), "?view=full#report-full");
    const panels = reportPanels(html);
    assert.equal(panels.length, 3);
    assert.equal(panels.filter((panel) => !panel.attributes.has("hidden")).length, 1);
    const full = panels.find((panel) => panel.attributes.get("data-result-view") === "full");
    assert.equal(full.attributes.has("hidden"), false);
    assert.equal(full.attributes.get("role"), "tabpanel");
    assert.equal(full.attributes.get("aria-labelledby"), selected[0].get("id"));
    const disclosures = [...full.content.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)];
    assert.equal(disclosures.length, 2, "Status-only tests must not render an empty disclosure");
    assert.ok(htmlAttributes(disclosures[0][1]).has("open"), "The first test with recorded values is expanded");
    assert.match(disclosures[0][2], /Synthetic IP region/);
    assert.match(disclosures[0][2], /IPv4 region/);
    assert.match(disclosures[0][2], />NL</);
    assert.equal(htmlAttributes(disclosures[1][1]).has("open"), false);
    assert.match(disclosures[1][2], /example\.test/);
    assert.match(disclosures[1][2], /45 ms/);
    const empty = full.content.match(/<article\b[^>]*class="[^"]*test-group-empty[^>]*>([\s\S]*?)<\/article>/);
    assert.ok(empty); assert.match(empty[1], /Synthetic status only/);
    assert.match(empty[1], /Для этого теста сохранился только статус/);
    assertReportScriptsCompile(html);

    const fallback = await (await worker.fetch(new Request(origin + "/test/" + id + "?view=invalid"), env)).text();
    assert.equal(reportPanels(fallback).find((panel) => !panel.attributes.has("hidden")).attributes.get("data-result-view"), "images");
  });

  await suite.test("headers-only terminal logs show recorded measurements rather than pretending to preserve raw output", async (t) => {
    const { env, id } = resultEnvironment(t);
    saveReportContent(env, id, {
      statuses: [["run_region", "Synthetic IP region", "выполнен"], ["run_network", "Synthetic network", "выполнен"]],
      metrics: [["run_region", "Latency p95", "2.14 ms", "ok"]],
      services: [["run_network", "sep", "Ignored separator", "", "", ""], ["run_network", "service", "example.test", "", "ok", "NL"]],
      terminal: "\n===== Synthetic IP region =====\n\n===== Synthetic network =====\r\n",
    });
    const html = await (await worker.fetch(new Request(origin + "/test/" + id + "?view=terminal"), env)).text();
    const panel = reportPanels(html).find((item) => !item.attributes.has("hidden"));
    assert.equal(panel.attributes.get("data-result-view"), "terminal");
    assert.match(panel.content, /Исходный вывод не сохранился/);
    assert.match(panel.content, /Latency p95: 2\.14 ms/);
    assert.match(panel.content, /example\.test: NL/);
    assert.doesNotMatch(panel.content, /Ignored separator/);
    assertReportScriptsCompile(html);
  });

  await suite.test("reports with only statuses explain missing details and terminal data honestly", async (t) => {
    const { env, id } = resultEnvironment(t);
    saveReportContent(env, id, {
      statuses: [["run_region", "Synthetic IP region", "выполнен"]],
      terminal: "===== Synthetic IP region =====\n",
    });
    const html = await (await worker.fetch(new Request(origin + "/test/" + id + "?view=full"), env)).text();
    const panels = reportPanels(html);
    const full = panels.find((panel) => panel.attributes.get("data-result-view") === "full");
    assert.doesNotMatch(full.content, /<details\b/);
    assert.match(full.content, /Для этого теста сохранился только статус/);
    const terminal = panels.find((panel) => panel.attributes.get("data-result-view") === "terminal");
    assert.match(terminal.content, /Вывод тестов не сохранился/);
    assert.doesNotMatch(terminal.content, /<pre\b/);
    assertReportScriptsCompile(html);
  });

  await suite.test("saved raw terminal lines remain intact and escaped instead of being replaced by synthetic summaries", async (t) => {
    const { env, id } = resultEnvironment(t);
    const raw = "===== Synthetic CPU =====\nCPU events/sec: 1234.50 <steady>\nLatency p95: 2.14 ms\n";
    saveReportContent(env, id, {
      statuses: [["run_cpu", "Synthetic CPU", "выполнен"]],
      metrics: [["run_cpu", "Parsed value differs", "999", "ok"]], terminal: raw,
    });
    const html = await (await worker.fetch(new Request(origin + "/test/" + id + "?view=terminal"), env)).text();
    const panel = reportPanels(html).find((item) => !item.attributes.has("hidden"));
    const pre = panel.content.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/);
    assert.ok(pre);
    assert.equal(pre[1], "===== Synthetic CPU =====\nCPU events/sec: 1234.50 &lt;steady&gt;\nLatency p95: 2.14 ms\n");
    assert.doesNotMatch(panel.content, /Исходный вывод не сохранился|Parsed value differs|<steady>/);
    assert.equal(env.DB.sqlite.prepare("SELECT content FROM result_terminal_reports WHERE result_id=?").get(id).content, raw);
    assertReportScriptsCompile(html);
  });

  await suite.test("SVG-only reports prepare a bounded PNG download in the browser and report errors accessibly", async (t) => {
    const { env, id, token } = resultEnvironment(t);
    assert.equal((await worker.fetch(assetRequest(id, token, { png: "" }), env)).status, 201);
    const html = await (await worker.fetch(new Request(origin + "/test/" + id), env)).text();
    assert.ok(html.includes('data-png-export data-svg="/assets/' + id + '/1.svg"'));
    assert.ok(!html.includes('<a href="/assets/' + id + '/1.png"'), "A missing stored raster must not become a broken PNG link");
    const source = html.match(/<script data-report-png-export>([\s\S]*?)<\/script>/)[1];
    const button = new Element(), status = new Element(), listeners = new Map(), timers = new Map();
    const images = [], downloads = [], encodings = [], revoked = [];
    let timerId = 0;
    button.dataset = { svg: "/assets/" + id + "/1.svg", filename: "ServerGrade-" + id + "-1.png" };
    button.closest = () => ({ querySelector: () => status });
    class RasterImage {
      constructor() { this.naturalWidth = 2200; this.naturalHeight = 12000; images.push(this); }
      set src(value) { this.source = value; }
      removeAttribute() { this.source = ""; }
    }
    const context = createContext({
      document: {
        documentElement: { lang: "ru" }, body: { append() {} },
        addEventListener: (type, handler) => listeners.set(type, handler),
        createElement: (tag) => tag === "canvas" ? {
          getContext() { return { drawImage() {} }; },
          toBlob(callback, type) { encodings.push({ width: this.width, height: this.height, type }); callback(new Blob([reportPng], { type })); },
        } : { click() { downloads.push({ filename: this.download, href: this.href }); }, remove() {} },
      },
      Image: RasterImage, Blob,
      URL: { createObjectURL: (blob) => { assert.equal(blob.type, "image/png"); return "blob:synthetic"; }, revokeObjectURL: (url) => revoked.push(url) },
      setTimeout: (handler) => { timers.set(++timerId, handler); return timerId; }, clearTimeout: (timer) => timers.delete(timer),
    });
    new Script(source, { filename: "report-png-client-bundled.js" }).runInContext(context);
    const event = () => ({ target: { closest: () => button }, preventDefault() {} });
    const pending = listeners.get("click")(event());
    assert.equal(button.disabled, true); assert.match(status.textContent, /PNG/);
    assert.equal(button.attributes.get("aria-busy"), "true");
    images.at(-1).onload(); await pending;
    assert.equal(downloads[0].filename, "ServerGrade-" + id + "-1.png");
    assert.equal(encodings[0].type, "image/png");
    assert.ok(encodings[0].width <= 8192 && encodings[0].height <= 8192 && encodings[0].width * encodings[0].height <= 12000000);
    assert.equal(button.disabled, false); assert.equal(button.attributes.has("aria-busy"), false);
    assert.equal(status.attributes.get("role"), "status");
    for (const timer of timers.values()) timer(); timers.clear();
    assert.deepEqual(revoked, ["blob:synthetic"]);
    const failed = listeners.get("click")(event());
    images.at(-1).onerror(); await failed;
    assert.equal(downloads.length, 1); assert.equal(button.disabled, false);
    assert.equal(status.attributes.get("role"), "alert"); assert.match(status.textContent, /SVG/);
  });

  await suite.test("MP4 banners use inline playback and never an image preload", async () => {
    const homeEnv = environment();
    homeEnv.DB.prepare = (sql) => ({
      bind() { return this; }, async run() { return { meta: { changes: 0 } }; }, async first() { return {}; },
      async all() { return { results: sql.includes("FROM admin_banners b") ? [{ id: 1, title: "Synthetic film", image_url: "https://example.test/film.MP4", image_mime: "", target_url: "https://example.test/", enabled: 1 }] : [] }; },
    });
    const originalFetch = globalThis.fetch; globalThis.fetch = async () => Response.json({ stargazers_count: 20 });
    try {
      const response = await worker.fetch(new Request(origin + "/"), homeEnv); const html = await response.text();
      assert.match(html, /<video[^>]*autoplay muted loop playsinline/);
      assert.match(html, /prefers-reduced-motion: reduce/);
      assert.doesNotMatch(html, /rel="preload" as="image"[^>]*film\.MP4/);
      assert.match(response.headers.get("content-security-policy"), /media-src 'self' https:/);
    } finally { globalThis.fetch = originalFetch; }
  });

  await suite.test("public ASN API groups by verified edge ASN and keeps partial/zero-coverage rating semantics explicit", async (t) => {
    const { env, add } = asnEnvironment(t);
    add({ id: "41000001", score: 80, coverage: 80, reportedAsn: "AS64500 · Wrong claimed network" });
    add({ id: "41000002", score: 61, coverage: 60, createdAt: "2026-11-21T10:00:00.000Z" });
    add({ id: "41000003", score: 70, coverage: 20, createdAt: "2026-11-22T10:00:00.000Z" });
    add({ id: "41000004", score: 100, coverage: 0, edgeOrg: "Latest trusted edge organization", createdAt: "2026-11-23T10:00:00.000Z" });
    add({ id: "41000005", score: 100, verified: 0, edgeOrg: "Unverified organization", createdAt: "2026-11-24T10:00:00.000Z" });
    add({ id: "41000006", score: 100, edgeAsn: 64500, reportedAsn: "AS64496 · Misdeclared network", createdAt: "2026-11-25T10:00:00.000Z" });
    add({ id: "41000007", score: 100, edgeAsn: null, createdAt: "2026-11-26T10:00:00.000Z" });
    add({ id: "41000008", score: 100, security: false, createdAt: "2026-11-27T10:00:00.000Z" });
    const response = await worker.fetch(new Request(origin + "/api/asn/64496"), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("cache-control"), "public, max-age=60", "The global /api wrapper must preserve this public GET cache policy");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    const data = await response.json();
    assert.equal(data.asn, 64496);
    assert.equal(data.organization, "Latest trusted edge organization");
    assert.equal(data.rating, 70.3);
    assert.equal(data.rating_scale, 100);
    assert.equal(data.verified_reports, 4);
    assert.equal(data.rated_reports, 3);
    assert.equal(data.average_coverage, 40);
    assert.equal(data.last_test_at, "2026-11-23T10:00:00.000Z");
    assert.equal(data.url, origin + "/asn/64496");
    assert.equal(data.latest_report_url, origin + "/test/41000004");
    assert.doesNotMatch(JSON.stringify(data), /source_ip_hash|synthetic-hash|synthetic-signature|nonce|token|terminal_report/);
    const alias = await worker.fetch(new Request(origin + "/api/asn/AS64496"), env);
    assert.equal(alias.status, 200);
    assert.deepEqual(await alias.json(), data);
    const head = await worker.fetch(new Request(origin + "/api/asn/64496", { method: "HEAD" }), env);
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(head.headers.get("cache-control"), "public, max-age=60");
    assert.equal(head.headers.get("access-control-allow-origin"), "*");
  });

  await suite.test("ASN API returns null rating without scored coverage and rejects invalid/unknown/non-read requests", async (t) => {
    const { env, add } = asnEnvironment(t);
    add({ id: "42000001", score: 99, coverage: 0, edgeOrg: "—" });
    add({ id: "42000002", edgeAsn: 64497, verified: 0 });
    const zero = await worker.fetch(new Request(origin + "/api/asn/64496"), env);
    assert.equal(zero.status, 200);
    const data = await zero.json();
    assert.equal(data.rating, null);
    assert.equal(data.rated_reports, 0);
    assert.equal(data.verified_reports, 1);
    assert.equal(data.average_coverage, 0);
    assert.equal(data.organization, null);
    for (const asn of ["abc", "AS64496oops", "64496.1", "0", "4294967296"]) {
      const invalid = await worker.fetch(new Request(origin + "/api/asn/" + asn), env);
      assert.equal(invalid.status, 400, asn);
      assert.equal((await invalid.json()).error, "invalid_asn");
      assert.match(invalid.headers.get("cache-control"), /no-store/);
      assert.equal(invalid.headers.get("x-robots-tag"), "noindex, nofollow");
    }
    for (const asn of ["64497", "64599"]) {
      const missing = await worker.fetch(new Request(origin + "/api/asn/" + asn), env);
      assert.equal(missing.status, 404, asn);
      assert.equal((await missing.json()).error, "asn_not_found");
    }
    for (const method of ["POST", "PUT", "DELETE"]) {
      const rejected = await worker.fetch(new Request(origin + "/api/asn/64496", { method }), env);
      assert.equal(rejected.status, 405, method);
      assert.match(rejected.headers.get("cache-control"), /no-store/);
    }
  });

  await suite.test("ASN HTML table uses the same trusted group, links reports and paginates thirty at a time", async (t) => {
    const { env, add } = asnEnvironment(t);
    const expected = [];
    for (let index = 0; index < 35; index++) {
      const id = String(43000000 + index);
      expected.unshift(id);
      add({ id, createdAt: new Date(Date.UTC(2026, 10, 24, 0, index)).toISOString(), reportedAsn: index === 0 ? "AS64500 · Wrong claimed network" : "AS64496 · Claimed network" });
    }
    add({ id: "43999991", verified: 0, createdAt: "2026-11-25T10:00:00.000Z" });
    add({ id: "43999992", edgeAsn: 64500, createdAt: "2026-11-26T10:00:00.000Z" });
    add({ id: "43999993", edgeAsn: null, createdAt: "2026-11-27T10:00:00.000Z" });
    add({ id: "43999994", security: false, createdAt: "2026-11-28T10:00:00.000Z" });
    const first = await worker.fetch(new Request(origin + "/asn/64496"), env);
    assert.equal(first.status, 200);
    const firstHtml = await first.text();
    assert.match(firstHtml, /AS64496/);
    assert.deepEqual(tableReportIds(firstHtml), expected.slice(0, 30));
    assert.match(firstHtml, /href="(?:\/asn\/64496)?\?page=2"/);
    const second = await worker.fetch(new Request(origin + "/asn/64496?page=2"), env);
    assert.equal(second.status, 200);
    const secondHtml = await second.text();
    assert.deepEqual(tableReportIds(secondHtml), expected.slice(30));
    for (const id of ["43999991", "43999992", "43999993", "43999994"]) assert.ok(!firstHtml.includes("/test/" + id) && !secondHtml.includes("/test/" + id), id);
  });

  await suite.test("oversized streaming uploads stop reading before parsing or writing the payload", async (t) => {
    const { env, id } = resultEnvironment(t);
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(3_100_000)); },
      cancel() { cancelled = true; },
    });
    const response = await worker.fetch(new Request(origin + "/api/results/" + id + "/assets", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, duplex: "half" }), env);
    assert.equal(response.status, 413); assert.equal(cancelled, true);
    assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) n FROM result_assets").get().n, 0);
  });

});
