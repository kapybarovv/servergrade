export const ASN_PAGE_SIZE = 30;

const VERIFIED_ASN = `FROM result_security s
  JOIN results r ON r.id = s.result_id
  WHERE s.verified = 1 AND s.edge_asn = ?`;

export function parseAsn(value) {
  const match = /^(?:AS)?(\d{1,10})$/i.exec(value || "");
  const number = match ? Number(match[1]) : 0;
  return number >= 1 && number <= 4_294_967_295 ? number : null;
}

export async function readAsnSummary(db, asn, origin) {
  const row = await db.prepare(`WITH verified AS (
    SELECT r.id, r.created_at, r.score, r.coverage, s.edge_org
    ${VERIFIED_ASN}
  ), latest AS (
    SELECT id, created_at, edge_org FROM verified ORDER BY created_at DESC, id DESC LIMIT 1
  )
  SELECT COUNT(*) verified_reports,
    COUNT(CASE WHEN coverage > 0 THEN 1 END) rated_reports,
    ROUND(AVG(CASE WHEN coverage > 0 THEN score END), 1) rating,
    ROUND(AVG(coverage), 1) average_coverage,
    (SELECT id FROM latest) latest_id,
    (SELECT created_at FROM latest) last_test_at,
    (SELECT edge_org FROM latest) organization
  FROM verified`).bind(asn).first();
  if (!row?.verified_reports) return null;
  const organization = row.organization?.trim();
  return {
    asn,
    organization: organization && organization !== "—" ? organization : null,
    rating: row.rating,
    rating_scale: 100,
    verified_reports: row.verified_reports,
    rated_reports: row.rated_reports,
    average_coverage: row.average_coverage,
    last_test_at: row.last_test_at,
    url: `${origin}/asn/${asn}`,
    latest_report_url: `${origin}/test/${row.latest_id}`,
  };
}

export async function listAsnReports(db, asn, page) {
  const rows = await db.prepare(`SELECT r.id, r.created_at, r.score, r.country, r.city,
    r.cpu, r.cores, r.ram, r.ram_type, r.disk, r.disk_type, r.server_vendor, s.verified
    ${VERIFIED_ASN} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`)
    .bind(asn, ASN_PAGE_SIZE, (page - 1) * ASN_PAGE_SIZE).all();
  return rows.results;
}

const cors = { "access-control-allow-origin": "*" };
const allow = "GET, HEAD, OPTIONS";

export async function asnApiResponse(request, db, slug, origin) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      ...cors, allow, "access-control-allow-methods": allow, "access-control-max-age": "600",
    } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { ...cors, allow } });
  }
  const asn = parseAsn(slug);
  if (asn === null) return Response.json({ error: "invalid_asn" }, { status: 400, headers: cors });
  const summary = await readAsnSummary(db, asn, origin);
  if (!summary) return Response.json({ error: "asn_not_found", asn }, { status: 404, headers: cors });
  return Response.json(summary, { headers: { ...cors, "cache-control": "public, max-age=60" } });
}
