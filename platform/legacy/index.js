const TARGET_ORIGIN = "https://servergrade.cc";
const MAX_BODY_BYTES = 1_500_000;
const encoder = new TextEncoder();
const bytesHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = `${TARGET_ORIGIN}${url.pathname}${url.search}`;
    if (request.method === "GET" || request.method === "HEAD") {
      return Response.redirect(target, 308);
    }
    const supported = /^\/api\/(?:challenges|runs|results)$/.test(url.pathname) || /^\/api\/results\/\d{8}\/assets$/.test(url.pathname);
    if (request.method !== "POST" || !supported) return new Response("Not found", { status: 404 });

    const chunks = [];
    let size = 0;
    const reader = request.body?.getReader();
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        const bodyLimit = /^\/api\/results\/\d{8}\/assets$/.test(url.pathname) ? 9_000_000 : MAX_BODY_BYTES;
        if (size > bodyLimit) {
          await reader.cancel();
          return new Response("Payload too large", { status: 413 });
        }
        chunks.push(value);
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // The source database is read only after cutover. Its existing key is
    // copied together with the reports and challenges into the target account.
    const secret = await env.DB.prepare("SELECT value FROM app_secrets WHERE name='attestation-v1'").first();
    if (!secret?.value) return new Response("Migration key unavailable", { status: 503 });
    const cf = request.cf || {};
    const client = {
      ip: request.headers.get("CF-Connecting-IP") || "0.0.0.0",
      cf: {
        country: String(cf.country || "—"),
        asn: cf.asn ?? null,
        asOrganization: String(cf.asOrganization || "—").slice(0, 160),
        clientTcpRtt: cf.clientTcpRtt ?? undefined,
        clientQuicRtt: cf.clientQuicRtt ?? undefined,
        colo: String(cf.colo || "—"),
      },
    };
    const metadata = btoa(Array.from(encoder.encode(JSON.stringify(client)), (byte) => String.fromCharCode(byte)).join(""));
    const timestamp = String(Date.now());
    const digest = bytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
    const message = JSON.stringify(["servergrade-migration-v1", timestamp, request.method, url.pathname + url.search, metadata, digest]);
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret.value), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = bytesHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
    const headers = new Headers({
      "x-servergrade-bridge-time": timestamp,
      "x-servergrade-bridge-client": metadata,
      "x-servergrade-bridge-signature": signature,
    });
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    try {
      return await fetch(target, { method: "POST", headers, body, redirect: "manual" });
    } catch {
      return new Response("Migration upstream unavailable", { status: 502 });
    }
  },
};
