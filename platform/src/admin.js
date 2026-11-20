const COOKIE_NAME = "__Host-servergrade_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_IMAGE_BYTES = 750 * 1024;
const encoder = new TextEncoder();
const bytesHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const schemaPromises = new WeakMap();
const BANNER_COLUMNS = "b.id,b.title,b.image_url,b.image_mime,b.target_url,b.enabled,b.sort_order,b.created_at,CASE WHEN b.image_data<>'' THEN 1 ELSE 0 END has_image,i.version";
const validImageVersion = (value) => /^[a-f0-9]{64}$/.test(value || "");

export async function ensureAdminSchema(env) {
  let promise = schemaPromises.get(env.DB);
  if (promise) return promise;
  promise = env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_banners (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '', image_mime TEXT NOT NULL DEFAULT '', image_data TEXT NOT NULL DEFAULT '', target_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_banner_images (banner_id INTEGER PRIMARY KEY REFERENCES admin_banners(id) ON DELETE CASCADE, version TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS result_pins (result_id TEXT PRIMARY KEY, pinned_at TEXT NOT NULL, FOREIGN KEY(result_id) REFERENCES results(id) ON DELETE CASCADE)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_login_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, expires_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS admin_login_attempts_expires_at ON admin_login_attempts(expires_at)"),
  ]).then(() => undefined);
  schemaPromises.set(env.DB, promise);
  try {
    await promise;
  } catch (failure) {
    if (schemaPromises.get(env.DB) === promise) schemaPromises.delete(env.DB);
    throw failure;
  }
}

function imageBytes(data) {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}

async function imageVersion(data) {
  return bytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", imageBytes(data))));
}

async function publicBanner(env, id) {
  return env.DB.prepare(`SELECT ${BANNER_COLUMNS} FROM admin_banners b LEFT JOIN admin_banner_images i ON i.banner_id=b.id WHERE b.id=? AND b.enabled=1`).bind(id).first();
}

async function backfillImageVersion(env, id) {
  // A concurrent upload may replace the image while it is being hashed. The
  // guarded INSERT only publishes a revision for the exact bytes we read.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await publicBanner(env, id);
    if (!current || !current.has_image || validImageVersion(current.version)) return current;
    const image = await env.DB.prepare("SELECT image_mime,image_data FROM admin_banners WHERE id=? AND enabled=1 AND image_data<>''").bind(id).first();
    if (!image) return null;
    const version = await imageVersion(image.image_data);
    await env.DB.prepare("INSERT INTO admin_banner_images(banner_id,version) SELECT id,? FROM admin_banners WHERE id=? AND image_data=? AND image_mime=? ON CONFLICT(banner_id) DO UPDATE SET version=excluded.version")
      .bind(version, id, image.image_data, image.image_mime).run();
  }
  const current = await publicBanner(env, id);
  return current && (!current.has_image || validImageVersion(current.version)) ? current : null;
}

export async function publicBanners(env) {
  await ensureAdminSchema(env);
  const rows = await env.DB.prepare(`SELECT ${BANNER_COLUMNS} FROM admin_banners b LEFT JOIN admin_banner_images i ON i.banner_id=b.id WHERE b.enabled=1 ORDER BY b.sort_order,b.id`).all();
  const banners = await Promise.all((rows.results || []).map(async (row) => {
    const current = row.has_image && !validImageVersion(row.version) ? await backfillImageVersion(env, row.id) : row;
    if (!current) return null;
    const { has_image, version, ...banner } = current;
    if (has_image) banner.image_url = `/banners/${banner.id}?v=${version}`;
    return banner;
  }));
  return banners.filter(Boolean);
}

function configured(env) {
  return /^[a-f0-9]{64}$/i.test(env.ADMIN_PASSWORD_HASH || "") && /^[a-f0-9]{64}$/i.test(env.ADMIN_SESSION_SECRET || "");
}

function json(value, status = 200, extraHeaders = {}) {
  return Response.json(value, { status, headers: { "cache-control": "no-store", ...extraHeaders } });
}

function error(code, message, status, extraHeaders) {
  return json({ error: code, message }, status, extraHeaders);
}

async function sessionKey(env, usages) {
  return crypto.subtle.importKey("raw", encoder.encode(env.ADMIN_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

function encodePayload(value) {
  return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function isAdmin(request, env) {
  if (!configured(env)) return false;
  const entry = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(COOKIE_NAME + "="));
  if (!entry) return false;
  const token = entry.slice(COOKIE_NAME.length + 1);
  if (token.length > 512) return false;
  const [payload, signature, extra] = token.split(".");
  if (extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload || "") || !/^[a-f0-9]{64}$/.test(signature || "")) return false;
  const key = await sessionKey(env, ["verify"]);
  const signatureBytes = Uint8Array.from(signature.match(/../g), (byte) => Number.parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode("servergrade-admin-session-v1." + payload))) return false;
  try {
    const session = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    const now = Math.floor(Date.now() / 1000);
    return Number.isInteger(session.issued_at) && Number.isInteger(session.expires_at) && session.issued_at <= now + 60 && session.expires_at > now && session.expires_at - session.issued_at === SESSION_SECONDS;
  } catch {
    return false;
  }
}

async function readJson(request, maxBytes = 16_384) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) return error("invalid_content_type", "Ожидается JSON.", 415);
  try {
    const reader = request.body?.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let size = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return error("payload_too_large", "Слишком большой запрос.", 413);
        }
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode();
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : error("invalid_json", "Некорректный JSON.", 400);
  } catch {
    return error("invalid_json", "Некорректный JSON.", 400);
  }
}

function uploadedImage(value) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length % 4 !== 0) return null;
  try {
    const binary = atob(match[2]);
    if (!binary.length || binary.length > MAX_IMAGE_BYTES || btoa(binary) !== match[2]) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.length >= 12 && binary.slice(0, 4) === "RIFF" && binary.slice(8, 12) === "WEBP";
    let mp4 = false;
    if (bytes.length >= 16 && binary.slice(4, 8) === "ftyp") {
      const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
      const accepted = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "avc1", "M4V ", "dash", "cmfc", "cmfs", "MSNV"]);
      const major = binary.slice(8, 12);
      if (boxSize >= 16 && boxSize <= bytes.length && boxSize % 4 === 0 && !["qt  ", "avif", "avis", "heic", "heix", "mif1", "msf1", "M4A "].includes(major)) {
        mp4 = accepted.has(major);
        for (let offset = 16; !mp4 && offset < boxSize; offset += 4) mp4 = accepted.has(binary.slice(offset, offset + 4));
      }
    }
    if (!(match[1] === "image/png" && png || match[1] === "image/jpeg" && jpeg || match[1] === "image/webp" && webp || match[1] === "video/mp4" && mp4)) return null;
    return { mime: match[1], data: match[2] };
  } catch {
    return null;
  }
}

async function imageResponse(request, banner, privateImage = false) {
  if (!banner) return new Response(request.method === "HEAD" ? null : "Not found", { status: 404, headers: privateImage ? { "cache-control": "private, no-store" } : {} });
  const bytes = Uint8Array.from(atob(banner.image_data), (character) => character.charCodeAt(0));
  const headers = {
    "content-type": banner.image_mime,
    "cache-control": privateImage ? "private, no-store" : "public, max-age=0, must-revalidate",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "accept-ranges": "bytes",
    "content-length": String(bytes.byteLength),
  };
  if (!privateImage) {
    const digest = bytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    const etag = '"' + digest + '"';
    headers.etag = etag;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  }
  return mediaResponse(request, new Response(request.method === "HEAD" ? null : bytes, { headers }));
}

function missingBanner(request) {
  return new Response(request.method === "HEAD" ? null : "Not found", { status: 404, headers: { "cache-control": "no-store" } });
}

function imageEtagMatches(request, etag) {
  return (request.headers.get("if-none-match") || "").split(",").some((value) => {
    const tag = value.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

function byteRange(value, length) {
  if (value.length > 160) return null;
  const match = value.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || !match[1] && !match[2] || length < 1) return null;
  const size = BigInt(length);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    return suffix > 0n ? { start: Number(suffix >= size ? 0n : size - suffix), end: length - 1 } : null;
  }
  const start = BigInt(match[1]), requestedEnd = match[2] ? BigInt(match[2]) : size - 1n;
  if (start >= size || requestedEnd < start) return null;
  return { start: Number(start), end: Number(requestedEnd >= size ? size - 1n : requestedEnd) };
}

async function mediaResponse(request, response) {
  if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  const requested = request.headers.get("range");
  if (requested === null) return response;
  const ifRange = request.headers.get("if-range");
  // Only a matching strong ETag can validate our immutable representation.
  // We do not advertise Last-Modified, so date/weak validators get full bytes.
  if (ifRange !== null && (!response.headers.has("etag") || ifRange !== response.headers.get("etag"))) return response;
  let bytes;
  let length = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length < 1) {
    bytes = new Uint8Array(await response.arrayBuffer());
    length = bytes.byteLength;
  }
  const range = byteRange(requested, length), headers = new Headers(response.headers);
  if (!range) {
    headers.set("content-range", `bytes */${length}`);
    headers.set("content-length", "0");
    headers.set("cache-control", "no-store");
    return new Response(null, { status: 416, headers });
  }
  if (!bytes) bytes = new Uint8Array(await response.arrayBuffer());
  const part = bytes.subarray(range.start, range.end + 1);
  headers.set("content-range", `bytes ${range.start}-${range.end}/${length}`);
  headers.set("content-length", String(part.byteLength));
  return new Response(part, { status: 206, headers });
}

export async function bannerImageResponse(request, env, ctx) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/banners\/(\d+)$/);
  if (!match || !["GET", "HEAD"].includes(request.method)) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) return missingBanner(request);
  await ensureAdminSchema(env);
  let banner = await publicBanner(env, id);
  if (banner?.has_image && !validImageVersion(banner.version)) banner = await backfillImageVersion(env, id);
  if (!banner?.has_image || !validImageVersion(banner.version)) return missingBanner(request);

  const path = `/banners/${id}?v=${banner.version}`;
  if (!url.searchParams.has("v")) {
    return new Response(null, { status: 307, headers: { location: new URL(path, url.origin).href, "cache-control": "no-store" } });
  }
  if (url.searchParams.get("v") !== banner.version) return missingBanner(request);
  const headers = {
    "content-type": banner.image_mime,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "accept-ranges": "bytes",
    etag: '"' + banner.version + '"',
  };
  if (imageEtagMatches(request, headers.etag)) return new Response(null, { status: 304, headers });

  // Check current visibility/revision before looking in the edge cache. A
  // cache hit never reads or hashes the potentially large database image.
  const origin = new URL(env.PUBLIC_ORIGIN || url.origin).origin;
  const cacheKey = new Request(new URL(path, origin), { method: "GET" });
  const cache = globalThis.caches?.default;
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return mediaResponse(request, cached);
    } catch {
      // Cache availability must not prevent the image from being served.
    }
  }
  if (request.method === "HEAD") {
    if (banner.image_mime === "video/mp4") {
      const size = await env.DB.prepare("SELECT length(b.image_data) encoded_length,substr(b.image_data,-2) ending FROM admin_banners b JOIN admin_banner_images i ON i.banner_id=b.id WHERE b.id=? AND b.enabled=1 AND i.version=?")
        .bind(id, banner.version).first();
      if (!size) return missingBanner(request);
      headers["content-length"] = String(size.encoded_length / 4 * 3 - (size.ending.endsWith("==") ? 2 : size.ending.endsWith("=") ? 1 : 0));
    }
    return new Response(null, { headers });
  }
  const image = await env.DB.prepare("SELECT b.image_mime,b.image_data FROM admin_banners b JOIN admin_banner_images i ON i.banner_id=b.id WHERE b.id=? AND b.enabled=1 AND b.image_data<>'' AND i.version=?")
    .bind(id, banner.version).first();
  if (!image) return missingBanner(request);
  const bytes = imageBytes(image.image_data);
  headers["content-length"] = String(bytes.byteLength);
  const response = new Response(bytes, { headers });
  if (cache) {
    const put = cache.put(cacheKey, response.clone()).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return mediaResponse(request, response);
}

async function login(request, env, data) {
  if (typeof data.password !== "string" || data.password.length > 1024) return error("invalid_password", "Введите пароль.", 400);
  const key = await sessionKey(env, ["sign"]);
  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const attemptKey = bytesHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("servergrade-admin-login-v1." + ip))));
  await env.DB.prepare("DELETE FROM admin_login_attempts WHERE expires_at <= datetime('now')").run();
  const attempt = await env.DB.prepare("INSERT INTO admin_login_attempts(key,failures,expires_at) VALUES(?,1,datetime('now','+15 minutes')) ON CONFLICT(key) DO UPDATE SET failures=admin_login_attempts.failures+1 WHERE admin_login_attempts.failures<5")
    .bind(attemptKey).run();
  if (!attempt.meta?.changes) return error("rate_limited", "Слишком много попыток. Повторите через 15 минут.", 429, { "retry-after": "900" });

  const digest = bytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(data.password))));
  const expected = env.ADMIN_PASSWORD_HASH.toLowerCase();
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= digest.charCodeAt(index) ^ expected.charCodeAt(index);
  if (difference !== 0) return error("invalid_credentials", "Неверный пароль.", 401);
  await env.DB.prepare("DELETE FROM admin_login_attempts WHERE key=?").bind(attemptKey).run();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = encodePayload({ issued_at: issuedAt, expires_at: issuedAt + SESSION_SECONDS });
  const signature = bytesHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("servergrade-admin-session-v1." + payload))));
  return json({ ok: true }, 200, { "set-cookie": `${COOKIE_NAME}=${payload}.${signature}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict` });
}

function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}

async function changeBanner(env, data) {
  const action = data.action || (data.id == null ? "create" : "update");
  if (!["create", "update", "delete"].includes(action)) return error("invalid_action", "Неизвестное действие.", 400);
  let existing;
  if (action !== "create") {
    if (!/^\d+$/.test(String(data.id || "")) || !Number.isSafeInteger(Number(data.id))) return error("invalid_id", "Некорректный ID баннера.", 400);
    existing = await env.DB.prepare("SELECT id,title,image_url,image_mime,image_data,target_url,enabled,sort_order FROM admin_banners WHERE id=?").bind(Number(data.id)).first();
    if (!existing) return error("banner_not_found", "Баннер не найден.", 404);
  }
  if (action === "delete") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM admin_banner_images WHERE banner_id=?").bind(existing.id),
      env.DB.prepare("DELETE FROM admin_banners WHERE id=?").bind(existing.id),
    ]);
    return json({ ok: true });
  }
  const title = typeof data.title === "string" ? data.title.trim() : existing?.title || "";
  const targetUrl = httpsUrl(data.target_url ?? existing?.target_url);
  let imageUrl = existing?.image_url || "";
  let imageMime = existing?.image_mime || "";
  let imageData = existing?.image_data || "";
  const imageProvided = Boolean(data.image_data || data.image_url);
  if (data.image_data) {
    const image = uploadedImage(data.image_data);
    if (!image) return error("invalid_image", "Выберите PNG, JPEG, WebP или MP4 размером до 750 КБ.", 400);
    imageUrl = "";
    imageMime = image.mime;
    imageData = image.data;
  } else if (data.image_url) {
    imageUrl = httpsUrl(data.image_url);
    imageMime = "";
    imageData = "";
  }
  const enabled = data.enabled ?? Boolean(existing?.enabled ?? true);
  const sortOrder = data.sort_order ?? existing?.sort_order ?? 0;
  if (!title || title.length > 120 || !(imageUrl || imageData) || !targetUrl || typeof enabled !== "boolean" || !Number.isSafeInteger(sortOrder)) {
    return error("invalid_banner", "Укажите название до 120 символов, HTTPS-ссылки и целый порядок сортировки.", 400);
  }
  if (action === "create") {
    const statements = [env.DB.prepare("INSERT INTO admin_banners(title,image_url,image_mime,image_data,target_url,enabled,sort_order,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))")
      .bind(title, imageUrl, imageMime, imageData, targetUrl, enabled ? 1 : 0, sortOrder)];
    if (imageData) statements.push(env.DB.prepare("INSERT INTO admin_banner_images(banner_id,version) VALUES(last_insert_rowid(),?)").bind(await imageVersion(imageData)));
    const inserted = await env.DB.batch(statements);
    return json({ ok: true, id: inserted[0].meta.last_row_id }, 201);
  }
  if (imageProvided) {
    const statements = [env.DB.prepare("UPDATE admin_banners SET title=?,image_url=?,image_mime=?,image_data=?,target_url=?,enabled=?,sort_order=? WHERE id=?")
      .bind(title, imageUrl, imageMime, imageData, targetUrl, enabled ? 1 : 0, sortOrder, existing.id)];
    if (imageData) {
      statements.push(env.DB.prepare("INSERT INTO admin_banner_images(banner_id,version) SELECT id,? FROM admin_banners WHERE id=? ON CONFLICT(banner_id) DO UPDATE SET version=excluded.version")
        .bind(await imageVersion(imageData), existing.id));
    } else {
      statements.push(env.DB.prepare("DELETE FROM admin_banner_images WHERE banner_id=?").bind(existing.id));
    }
    await env.DB.batch(statements);
  } else {
    // A title/order/link edit must not restore an image from an older admin
    // form while another request has just uploaded a replacement.
    await env.DB.prepare("UPDATE admin_banners SET title=?,target_url=?,enabled=?,sort_order=? WHERE id=?")
      .bind(title, targetUrl, enabled ? 1 : 0, sortOrder, existing.id).run();
  }
  return json({ ok: true, id: existing.id });
}

async function changePin(env, data) {
  if (!/^\d{8}$/.test(data.result_id || "") || typeof data.pinned !== "boolean") return error("invalid_pin", "Укажите ID теста и состояние закрепления.", 400);
  const result = await env.DB.prepare("SELECT id FROM results WHERE id=?").bind(data.result_id).first();
  if (!result) return error("result_not_found", "Тест не найден.", 404);
  if (data.pinned) {
    await env.DB.prepare("INSERT INTO result_pins(result_id,pinned_at) VALUES(?,datetime('now')) ON CONFLICT(result_id) DO NOTHING").bind(data.result_id).run();
  } else {
    await env.DB.prepare("DELETE FROM result_pins WHERE result_id=?").bind(data.result_id).run();
  }
  return json({ ok: true, pinned: data.pinned });
}

export async function handleAdminRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin/")) return null;
  if (!configured(env)) return error("admin_unconfigured", "Админ-панель ещё не настроена.", 503);
  if (request.method === "POST") {
    const origin = new URL(env.PUBLIC_ORIGIN || request.url).origin;
    if (url.origin !== origin || request.headers.get("origin") !== origin) return error("invalid_origin", "Запрос должен исходить с этого сайта.", 403);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    const data = await readJson(request);
    return data instanceof Response ? data : login(request, env, data);
  }
  if (!await isAdmin(request, env)) return error("unauthorized", "Войдите в админ-панель.", 401);
  const preview = url.pathname.match(/^\/api\/admin\/banners\/(\d+)\/image$/);
  if (preview && ["GET", "HEAD"].includes(request.method)) {
    const id = Number(preview[1]);
    if (!Number.isSafeInteger(id) || id < 1) return error("invalid_id", "Некорректный ID баннера.", 400);
    const banner = await env.DB.prepare("SELECT image_mime,image_data FROM admin_banners WHERE id=? AND image_data<>''").bind(id).first();
    return imageResponse(request, banner, true);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/state") {
    const search = (url.searchParams.get("search") || "").trim();
    if (search.length > 120) return error("invalid_search", "Поисковый запрос должен быть короче 121 символа.", 400);
    const pattern = "%" + search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_") + "%";
    const [banners, results, pins] = await Promise.all([
      env.DB.prepare("SELECT id,title,CASE WHEN image_data<>'' THEN '/api/admin/banners/'||id||'/image' ELSE image_url END image_url,image_mime,target_url,enabled,sort_order,created_at FROM admin_banners ORDER BY sort_order,id").all(),
      env.DB.prepare("SELECT r.id,r.created_at,r.country,r.city,r.cpu,r.cores,r.ram,r.score,CASE WHEN p.result_id IS NULL THEN 0 ELSE 1 END pinned FROM results r LEFT JOIN result_pins p ON p.result_id=r.id WHERE ?='' OR r.id LIKE ? ESCAPE '\\' OR r.cpu LIKE ? ESCAPE '\\' OR r.country LIKE ? ESCAPE '\\' OR r.city LIKE ? ESCAPE '\\' ORDER BY (p.result_id IS NOT NULL) DESC,r.created_at DESC LIMIT 100")
        .bind(search, pattern, pattern, pattern, pattern).all(),
      env.DB.prepare("SELECT result_id,pinned_at FROM result_pins ORDER BY pinned_at DESC").all(),
    ]);
    return json({ banners: banners.results || [], results: results.results || [], pins: pins.results || [] });
  }
  if (request.method !== "POST") return error("not_found", "Страница не найдена.", 404);
  if (url.pathname === "/api/admin/logout") return json({ ok: true }, 200, { "set-cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
  const data = await readJson(request, url.pathname === "/api/admin/banners" ? 1_050_000 : 16_384);
  if (data instanceof Response) return data;
  if (url.pathname === "/api/admin/banners") return changeBanner(env, data);
  if (url.pathname === "/api/admin/pins") return changePin(env, data);
  return error("not_found", "Страница не найдена.", 404);
}
