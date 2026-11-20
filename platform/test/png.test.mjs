import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { ensurePngSchema, listReportPngs, parsePng, pngImageResponse, prepareReportPng, preparePreviewPng, previewImageResponse, storePreviewPng, storeReportPng } from "../src/png.js";

const origin = "https://servergrade.test";
const id = "12345678";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="white"/></svg>';
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=", "base64");

// A valid PNG generated locally, with real compressed pixels and chunk CRCs.
function raster(width, height) {
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length);
    name.copy(output, 4);
    data.copy(output, 8);
    output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk("IEND", Buffer.alloc(0))]);
}
const preview = raster(1200, 630);

class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE results(id TEXT PRIMARY KEY); CREATE TABLE result_assets(result_id TEXT,position INTEGER,name TEXT,mime TEXT,data TEXT,PRIMARY KEY(result_id,position)); CREATE TABLE secure_upload_tokens(result_id TEXT PRIMARY KEY,token_hash TEXT,expires_at TEXT,expected_count INTEGER,uploaded_count INTEGER DEFAULT 0)");
    this.blobReads = 0;
  }

  prepare(sql) {
    const database = this;
    const statement = (bindings = []) => ({
      bind(...values) {
        return statement(values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value));
      },
      async run() {
        const result = database.sqlite.prepare(sql).run(...bindings);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      async first() {
        if (/SELECT data FROM result_png_(assets|previews)/.test(sql)) database.blobReads++;
        const row = database.sqlite.prepare(sql).get(...bindings);
        if (!row) return null;
        // Cloudflare D1 converts BLOBs to number arrays in its binding API.
        return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? Array.from(value) : value]));
      },
      async all() {
        return { results: database.sqlite.prepare(sql).all(...bindings).map((row) => ({ ...row })) };
      },
    });
    return statement();
  }
}

async function fixture(suite) {
  const DB = new TestD1();
  DB.sqlite.prepare("INSERT INTO results VALUES(?)").run(id);
  DB.sqlite.prepare("INSERT INTO result_assets VALUES(?,1,'Overview','image/svg+xml',?)").run(id, svg);
  const env = { DB, PUBLIC_ORIGIN: origin };
  const entries = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        async match(request) { return entries.get(request.url)?.clone(); },
        async put(request, response) {
          assert.equal(request.method, "GET");
          assert.equal(response.status, 200);
          entries.set(request.url, response.clone());
        },
      },
    },
  });
  suite.after(() => {
    DB.sqlite.close();
    if (previous) Object.defineProperty(globalThis, "caches", previous);
    else delete globalThis.caches;
  });
  await ensurePngSchema(env);
  const pending = [];
  const context = { waitUntil(promise) { pending.push(promise); } };
  const image = async (options, pathname = `/assets/${id}/1.png`) => {
    const response = await pngImageResponse(new Request(origin + pathname, options), env, context);
    await Promise.all(pending.splice(0));
    return response;
  };
  return { DB, env, entries, image };
}

test("PNG parser accepts real binary and base64 files and rejects SVG or truncated data", () => {
  const parsed = parsePng(png);
  assert.equal(parsed.width, 1);
  assert.equal(parsed.height, 1);
  assert.deepEqual(Buffer.from(parsePng(png.toString("base64")).bytes), png);
  assert.deepEqual(Buffer.from(parsePng("data:image/png;base64," + png.toString("base64")).bytes), png);
  assert.throws(() => parsePng(Buffer.from(svg)), /PNG/);
  assert.throws(() => parsePng(png.subarray(0, 35)), /PNG/);
  assert.throws(() => parsePng("not base64"), /PNG/);
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(40_000, 16);
  assert.throws(() => parsePng(oversized), /dimensions/);
});

test("a stored report PNG is served as actual image bytes with cache headers", async (suite) => {
  const { DB, env, entries, image } = await fixture(suite);
  const saved = await storeReportPng(env, id, 1, svg, png);
  assert.equal(saved.created, true);
  assert.deepEqual(await listReportPngs(env, id), [{ position: 1, width: 1, height: 1, byte_length: png.length }]);
  const response = await image();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(Number(response.headers.get("content-length")), png.length);
  assert.match(response.headers.get("cache-control"), /max-age=31536000, immutable/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(entries.size, 1);
  const reads = DB.blobReads;
  const cached = await image(undefined, `/assets/${id}/1.png?tracking=ignored`);
  assert.deepEqual(Buffer.from(await cached.arrayBuffer()), png);
  assert.equal(DB.blobReads, reads);
  assert.equal(entries.size, 1);
});

test("HEAD and 304 requests use metadata without loading PNG blobs", async (suite) => {
  const { DB, env, entries, image } = await fixture(suite);
  await storeReportPng(env, id, 1, svg, png);
  const head = await image({ method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(Number(head.headers.get("content-length")), png.length);
  const conditional = await image({ headers: { "if-none-match": "W/" + head.headers.get("etag") } });
  assert.equal(conditional.status, 304);
  assert.equal((await conditional.arrayBuffer()).byteLength, 0);
  assert.equal(DB.blobReads, 0);
  assert.equal(entries.size, 0);
});

test("legacy SVG can receive a PNG backfill without modifying its original asset", async (suite) => {
  const { DB, env, image } = await fixture(suite);
  const missing = await image();
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("cache-control"), /no-store/);
  await storeReportPng(env, id, 1, svg, png.toString("base64"));
  assert.equal((await image()).status, 200);
  assert.equal(DB.sqlite.prepare("SELECT data FROM result_assets WHERE result_id=? AND position=1").get(id).data, svg);
});

test("PNG uploads are source-bound, immutable and idempotent for identical retries", async (suite) => {
  const { env } = await fixture(suite);
  await assert.rejects(storeReportPng(env, id, 1, svg + " ", png), /source/);
  await assert.rejects(storeReportPng(env, "87654321", 1, svg, png), /source/);
  await storeReportPng(env, id, 1, svg, png);
  assert.equal((await storeReportPng(env, id, 1, svg, png)).created, false);
  const otherPng = Buffer.from(png);
  otherPng[otherPng.length - 1] ^= 1;
  await assert.rejects(storeReportPng(env, id, 1, svg, otherPng), /immutable/);
});

test("deleting the SVG source prevents a primed cache from serving orphaned PNG data", async (suite) => {
  const { DB, env, entries, image } = await fixture(suite);
  await storeReportPng(env, id, 1, svg, png);
  await image();
  assert.equal(entries.size, 1);
  DB.sqlite.prepare("DELETE FROM result_assets WHERE result_id=? AND position=1").run(id);
  const missing = await image();
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("cache-control"), /no-store/);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM result_png_assets").get().count, 0);
});

test("dedicated social cards have real 1200×630 PNG bytes, HEAD and ETag support", async (suite) => {
  const { DB, env } = await fixture(suite);
  const request = (options) => new Request(`${origin}/test/${id}/preview.png`, options);
  const pending = await previewImageResponse(request(), env);
  assert.equal(pending.status, 307);
  assert.equal(pending.headers.get("location"), "/preview.png");
  assert.equal(pending.headers.get("cache-control"), "no-store");
  assert.equal((await storePreviewPng(env, id, preview)).created, true);
  assert.equal((await storePreviewPng(env, id, preview.toString("base64"))).created, false);
  const head = await previewImageResponse(request({ method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(DB.blobReads, 0);
  const response = await previewImageResponse(request(), env);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), preview);
  const conditional = await previewImageResponse(request({ headers: { "if-none-match": head.headers.get("etag") } }), env);
  assert.equal(conditional.status, 304);
  DB.sqlite.prepare("DELETE FROM results WHERE id=?").run(id);
  assert.equal((await previewImageResponse(request(), env)).status, 404);
});

test("social cards reject wrong dimensions and unknown results without storing data", async (suite) => {
  const { DB, env } = await fixture(suite);
  await assert.rejects(storePreviewPng(env, id, png), /1200.*630/);
  await assert.rejects(storePreviewPng(env, "87654321", preview), /missing/);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) count FROM result_png_previews").get().count, 0);
});

test("prepared PNG writes recheck expiring upload credentials inside their own SQL", async (suite) => {
  const { DB, env } = await fixture(suite);
  const reportWrite = await prepareReportPng(env, id, 1, svg, png, { tokenHash: "token" });
  const previewWrite = await preparePreviewPng(env, id, preview, { tokenHash: "token" });
  assert.equal((await reportWrite.statement.run()).meta.changes, 0);
  assert.equal((await previewWrite.statement.run()).meta.changes, 0);
  DB.sqlite.prepare("INSERT INTO secure_upload_tokens VALUES(?,'token',datetime('now','-1 minute'),1,0)").run(id);
  assert.equal((await reportWrite.statement.run()).meta.changes, 0);
  assert.equal((await previewWrite.statement.run()).meta.changes, 0);
  DB.sqlite.prepare("UPDATE secure_upload_tokens SET expires_at=datetime('now','+1 minute'),uploaded_count=1").run();
  assert.equal((await reportWrite.statement.run()).meta.changes, 0);
  assert.equal((await previewWrite.statement.run()).meta.changes, 0);
  DB.sqlite.prepare("UPDATE secure_upload_tokens SET uploaded_count=0").run();
  assert.equal((await reportWrite.statement.run()).meta.changes, 1);
  assert.equal((await previewWrite.statement.run()).meta.changes, 1);
});
