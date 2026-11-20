import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
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

  setAttribute() {}
  removeAttribute() {}
  focus() {}
  scrollIntoView() {}

  append(...elements) {
    this.children.push(...elements);
  }

  replaceChildren(...elements) {
    this.children = elements;
  }
}

function browser(authenticated) {
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
      createElement: () => new Element(),
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
          ? { banners: [], results: [], pins: [] }
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
    cwd: platformDirectory,
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

});
