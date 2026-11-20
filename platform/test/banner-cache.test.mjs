import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as admin from "../src/admin.js";

const origin = "https://servergrade.test";
const sessionSecret = "b".repeat(64);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=", "base64");
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==", "base64");

// SQLite executes the production SQL while this adapter exposes D1's response
// shape. Keeping the schema real catches migrations and stale-row joins that a
// canned prepare()/first() stub would otherwise accept.
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE results(id TEXT PRIMARY KEY)");
    this.reads = [];
  }

  prepare(sql) {
    const database = this;
    const statement = (bindings = []) => ({
      bind(...values) { return statement(values); },
      async first(column) {
        database.reads.push(sql);
        const row = database.sqlite.prepare(sql).get(...bindings);
        if (!row) return null;
        return column ? row[column] : { ...row };
      },
      async all() {
        database.reads.push(sql);
        return { success: true, results: database.sqlite.prepare(sql).all(...bindings).map((row) => ({ ...row })) };
      },
      async run() {
        const result = database.sqlite.prepare(sql).run(...bindings);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    });
    return statement();
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  get imageReads() {
    return this.reads.filter((sql) => {
      const projection = sql.match(/\bSELECT\s+([\s\S]*?)\s+FROM\b/i)?.[1] || "";
      const directColumns = projection.replace(/\bCASE\b[\s\S]*?\bEND\b/gi, "");
      return /\badmin_banners\b/i.test(sql) && /\bimage_data\b|\*/i.test(directColumns);
    }).length;
  }
}

class TestCache {
  constructor() {
    this.entries = new Map();
    this.matches = [];
    this.puts = [];
  }

  async match(request) {
    if (typeof request === "string") request = new Request(request);
    this.matches.push(request.url);
    const response = this.entries.get(request.url);
    if (!response) return undefined;
    const condition = request.headers.get("if-none-match");
    if (condition && condition.split(",").map((value) => value.trim()).includes(response.headers.get("etag"))) {
      return new Response(null, { status: 304, headers: response.headers });
    }
    return response.clone();
  }

  async put(request, response) {
    if (typeof request === "string") request = new Request(request);
    assert.equal(request.method, "GET", "Cache API accepts GET keys only");
    assert.equal(response.status, 200, "Only full successful image responses belong in this cache");
    assert.equal(response.headers.has("set-cookie"), false);
    this.puts.push(request.url);
    this.entries.set(request.url, response.clone());
  }

  async delete(request) {
    if (typeof request === "string") request = new Request(request);
    return this.entries.delete(request.url);
  }
}

function sessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ issued_at: now, expires_at: now + 12 * 60 * 60 })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update("servergrade-admin-session-v1." + payload).digest("hex");
  return `__Host-servergrade_admin=${payload}.${signature}`;
}

async function fixture(suite) {
  const DB = new TestD1();
  const env = { DB, PUBLIC_ORIGIN: origin, ADMIN_PASSWORD_HASH: "a".repeat(64), ADMIN_SESSION_SECRET: sessionSecret };
  const cache = new TestCache();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: cache } });
  suite.after(() => {
    DB.sqlite.close();
    if (previous) Object.defineProperty(globalThis, "caches", previous);
    else delete globalThis.caches;
  });
  await admin.ensureAdminSchema(env);
  DB.sqlite.prepare("INSERT INTO admin_banners(id,title,image_url,image_mime,image_data,target_url,enabled,sort_order,created_at) VALUES(1,'First banner','','image/png',?,'https://example.com',1,0,'2026-11-20 00:00:00')").run(png.toString("base64"));
  const pending = [];
  const context = { waitUntil(promise) { pending.push(promise); } };
  const drain = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  const image = async (url, options) => {
    const response = await admin.bannerImageResponse(new Request(new URL(url, origin), options), env, context);
    await drain();
    return response;
  };
  const change = async (data) => {
    const request = new Request(origin + "/api/admin/banners", {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: sessionCookie() },
      body: JSON.stringify({ action: "update", id: 1, ...data }),
    });
    const response = await admin.handleAdminRequest(request, env);
    assert.ok(response.ok, await response.text());
    await drain();
  };
  return { env, DB, cache, image, change };
}

function expectedVersion(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function bannerUrl(env) {
  const banners = await admin.publicBanners(env);
  assert.equal(banners.length, 1);
  return new URL(banners[0].image_url, origin);
}

test("legacy uploaded banner gains a version and its stable URL redirects without caching", async (suite) => {
  const { env, image } = await fixture(suite);
  const response = await image("/banners/1");
  assert.ok(response.status >= 300 && response.status < 400 && response.status !== 304);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const target = new URL(response.headers.get("location"), origin);
  assert.equal(target.pathname, "/banners/1");
  assert.equal(target.searchParams.get("v"), expectedVersion(png));
  assert.equal((await bannerUrl(env)).href, target.href);
});

test("versioned image has immutable bytes and a cache hit avoids reading the base64 again", async (suite) => {
  const { env, DB, cache, image } = await fixture(suite);
  const url = await bannerUrl(env);
  const first = await image(url);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control"), /immutable/);
  assert.match(first.headers.get("cache-control"), /max-age=31536000/);
  assert.equal(first.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), png);
  const readsAfterMiss = DB.imageReads;
  assert.ok(cache.puts.length > 0, "The first response should populate the edge cache");
  const equivalentUrl = new URL(url);
  equivalentUrl.searchParams.set("tracking", "ignored");
  const second = await image(equivalentUrl);
  assert.equal(second.status, 200);
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), png);
  assert.equal(DB.imageReads, readsAfterMiss);
  assert.equal(cache.puts.length, 1, "Unrelated query parameters should reuse the canonical versioned cache key");
});

test("HEAD and conditional GET preserve image headers and never cache an empty body", async (suite) => {
  const { env, DB, cache, image } = await fixture(suite);
  const url = await bannerUrl(env);
  const readsBeforeHead = DB.imageReads;
  const head = await image(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(head.headers.get("content-type"), "image/png");
  assert.equal(DB.imageReads, readsBeforeHead, "A cold HEAD can use the metadata without loading the entire image");
  const get = await image(url);
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), png);
  const cachedHead = await image(url, { method: "HEAD" });
  assert.equal((await cachedHead.arrayBuffer()).byteLength, 0);
  assert.equal(Number(cachedHead.headers.get("content-length")), png.length);
  const etag = get.headers.get("etag");
  assert.ok(etag);
  const conditional = await image(url, { headers: { "if-none-match": etag } });
  assert.equal(conditional.status, 304);
  assert.equal((await conditional.arrayBuffer()).byteLength, 0);
  assert.equal(conditional.headers.get("etag"), etag);
  for (const response of cache.entries.values()) {
    assert.deepEqual(Buffer.from(await response.clone().arrayBuffer()), png);
  }
});

test("replacing an image changes its URL while a title-only edit preserves the version", async (suite) => {
  const { env, DB, cache, image, change } = await fixture(suite);
  const firstUrl = await bannerUrl(env);
  await image(firstUrl);
  await change({ title: "Renamed banner" });
  assert.equal((await bannerUrl(env)).href, firstUrl.href);
  await change({ image_data: "data:image/webp;base64," + webp.toString("base64") });
  assert.equal(DB.sqlite.prepare("SELECT image_mime FROM admin_banners WHERE id=1").get().image_mime, "image/webp");
  const secondUrl = await bannerUrl(env);
  assert.equal(secondUrl.searchParams.get("v"), expectedVersion(webp));
  assert.notEqual(secondUrl.href, firstUrl.href);
  const matchesBeforeStale = cache.matches.length;
  const stale = await image(firstUrl, { headers: { "if-none-match": '"' + expectedVersion(png) + '"' } });
  assert.equal(stale.status, 404);
  assert.match(stale.headers.get("cache-control"), /no-store/);
  assert.equal(cache.matches.length, matchesBeforeStale, "The current revision must be validated before cache.match");
  const current = await image(secondUrl);
  assert.equal(current.headers.get("content-type"), "image/webp");
  assert.deepEqual(Buffer.from(await current.arrayBuffer()), webp);
});

test("disabled and deleted banners cannot be served from an already primed edge cache", async (suite) => {
  const { env, cache, image, change } = await fixture(suite);
  const url = await bannerUrl(env);
  await image(url);
  assert.ok(cache.entries.size);
  await change({ enabled: false });
  const beforeDisabled = cache.matches.length;
  const disabled = await image(url);
  assert.equal(disabled.status, 404);
  assert.match(disabled.headers.get("cache-control"), /no-store/);
  assert.equal(cache.matches.length, beforeDisabled);
  assert.deepEqual(await admin.publicBanners(env), []);
  await change({ enabled: true });
  assert.equal((await image(url)).status, 200);
  await change({ action: "delete" });
  const beforeDeleted = cache.matches.length;
  const deleted = await image(url);
  assert.equal(deleted.status, 404);
  assert.match(deleted.headers.get("cache-control"), /no-store/);
  assert.equal(cache.matches.length, beforeDeleted);
});

test("admin preview remains private and uncached even when the banner is disabled", async (suite) => {
  const { env, cache, change } = await fixture(suite);
  await change({ enabled: false });
  const request = new Request(origin + "/api/admin/banners/1/image", { headers: { cookie: sessionCookie() } });
  const response = await admin.handleAdminRequest(request, env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(cache.matches.length, 0);
  assert.equal(cache.puts.length, 0);
  const unauthorized = await admin.handleAdminRequest(new Request(request.url), env);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get("cache-control"), /no-store/);
});
