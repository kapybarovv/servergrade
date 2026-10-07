CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade TEXT NOT NULL,
  network_score INTEGER NOT NULL CHECK (network_score BETWEEN 0 AND 100),
  performance_score INTEGER NOT NULL CHECK (performance_score BETWEEN 0 AND 100),
  quality_score INTEGER NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  coverage INTEGER NOT NULL CHECK (coverage BETWEEN 0 AND 100),
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  cpu TEXT NOT NULL,
  cores TEXT NOT NULL,
  ram TEXT NOT NULL,
  ram_type TEXT NOT NULL,
  disk TEXT NOT NULL,
  disk_type TEXT NOT NULL,
  disk_model TEXT NOT NULL,
  server_vendor TEXT NOT NULL,
  report_url TEXT NOT NULL,
  runner_version TEXT NOT NULL,
  source_ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS results_created_at ON results(created_at DESC);

CREATE TABLE IF NOT EXISTS result_details (
  result_id TEXT PRIMARY KEY,
  asn TEXT NOT NULL,
  os TEXT NOT NULL,
  kernel TEXT NOT NULL,
  arch TEXT NOT NULL,
  virtualization TEXT NOT NULL,
  congestion_control TEXT NOT NULL,
  qdisc TEXT NOT NULL,
  uptime TEXT NOT NULL,
  load_avg TEXT NOT NULL,
  has_ipv4 INTEGER NOT NULL DEFAULT 0,
  has_ipv6 INTEGER NOT NULL DEFAULT 0,
  test_statuses TEXT NOT NULL,
  metrics TEXT NOT NULL,
  services TEXT NOT NULL,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS result_upload_tokens (
  result_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS result_assets (
  result_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/svg+xml',
  data TEXT NOT NULL,
  PRIMARY KEY (result_id, position),
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS active_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS active_runs_updated_at ON active_runs(updated_at);

-- Server-owned security state. Kept separate from legacy tables so existing
-- installations can migrate idempotently without ALTER TABLE bookkeeping.
CREATE TABLE IF NOT EXISTS app_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS result_challenges (
  id TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  source_ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  edge_country TEXT NOT NULL,
  edge_asn INTEGER,
  edge_org TEXT NOT NULL,
  edge_rtt_ms INTEGER,
  edge_colo TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS result_challenges_ip_created
  ON result_challenges(source_ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS result_security (
  result_id TEXT PRIMARY KEY,
  verified INTEGER NOT NULL DEFAULT 0,
  verification_level TEXT NOT NULL,
  challenge_id TEXT,
  signature TEXT NOT NULL,
  source_ip_hash TEXT NOT NULL,
  edge_country TEXT NOT NULL,
  edge_asn INTEGER,
  edge_org TEXT NOT NULL,
  edge_rtt_ms INTEGER,
  edge_colo TEXT NOT NULL,
  external_probe_status TEXT NOT NULL,
  immutable_at TEXT NOT NULL,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS result_security_verified
  ON result_security(verified, result_id);

CREATE TABLE IF NOT EXISTS secure_upload_tokens (
  result_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  expected_count INTEGER NOT NULL,
  uploaded_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (result_id) REFERENCES results(id) ON DELETE CASCADE
);

-- Synthetic fixtures make a fresh installation useful for layout/testing.
-- They are explicitly marked DEMO, excluded from production counters/rankings,
-- and use a reserved 91xxxxxx ID range so they can be removed safely.
WITH RECURSIVE demo(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM demo WHERE n < 56
)
INSERT OR IGNORE INTO results(
  id,created_at,score,grade,network_score,performance_score,quality_score,coverage,
  country,city,cpu,cores,ram,ram_type,disk,disk_type,disk_model,server_vendor,
  report_url,runner_version
)
SELECT
  printf('91%06d',n),datetime('now','-' || (n % 45) || ' days'),
  55 + ((n * 7) % 44),
  CASE WHEN 55 + ((n * 7) % 44) >= 90 THEN 'A' WHEN 55 + ((n * 7) % 44) >= 80 THEN 'B' WHEN 55 + ((n * 7) % 44) >= 70 THEN 'C' WHEN 55 + ((n * 7) % 44) >= 60 THEN 'D' ELSE 'E' END,
  50 + ((n * 11) % 49),55 + ((n * 13) % 44),45 + ((n * 17) % 54),100,
  CASE n % 8 WHEN 0 THEN 'NL' WHEN 1 THEN 'DE' WHEN 2 THEN 'FI' WHEN 3 THEN 'FR' WHEN 4 THEN 'PL' WHEN 5 THEN 'SE' WHEN 6 THEN 'GB' ELSE 'US' END,
  CASE n % 8 WHEN 0 THEN 'Amsterdam' WHEN 1 THEN 'Frankfurt' WHEN 2 THEN 'Helsinki' WHEN 3 THEN 'Paris' WHEN 4 THEN 'Warsaw' WHEN 5 THEN 'Stockholm' WHEN 6 THEN 'London' ELSE 'New York' END,
  CASE n % 6 WHEN 0 THEN 'AMD EPYC 7B13' WHEN 1 THEN 'AMD EPYC 7763' WHEN 2 THEN 'Intel Xeon Gold 6230' WHEN 3 THEN 'AMD EPYC 7502P' WHEN 4 THEN 'Intel Xeon E5-2697 v4' ELSE 'AMD EPYC 9454P' END,
  CAST(1 << (n % 5) AS TEXT),printf('%d GiB',1 << ((n % 5) + 1)),CASE WHEN n % 4 = 0 THEN 'DDR5' ELSE 'DDR4' END,
  printf('%d GiB',40 + (n % 8) * 40),CASE WHEN n % 5 = 0 THEN 'SSD' ELSE 'NVMe SSD' END,
  CASE WHEN n % 5 = 0 THEN 'Virtual SSD' ELSE 'Virtual NVMe' END,
  CASE n % 10 WHEN 0 THEN 'Hetzner' WHEN 1 THEN 'OVHcloud' WHEN 2 THEN 'Vultr' WHEN 3 THEN 'DigitalOcean' WHEN 4 THEN 'Akamai Linode' WHEN 5 THEN 'Contabo' WHEN 6 THEN 'Netcup' WHEN 7 THEN 'Scaleway' WHEN 8 THEN 'Leaseweb' ELSE 'UpCloud' END,
  '','demo-fixture'
FROM demo;

WITH RECURSIVE demo(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM demo WHERE n < 56
)
INSERT OR IGNORE INTO result_details(
  result_id,asn,os,kernel,arch,virtualization,congestion_control,qdisc,uptime,
  load_avg,has_ipv4,has_ipv6,test_statuses,metrics,services
)
SELECT printf('91%06d',n),'DEMO ASN','Debian 12','6.1.x','x86_64','KVM','bbr','fq','demo','0.00',1,1,'','','' FROM demo;

WITH RECURSIVE demo(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM demo WHERE n < 56
)
INSERT OR IGNORE INTO result_security(
  result_id,verified,verification_level,challenge_id,signature,source_ip_hash,
  edge_country,edge_asn,edge_org,edge_rtt_ms,edge_colo,external_probe_status,immutable_at
)
SELECT printf('91%06d',n),0,'demo',NULL,printf('demo-fixture-%02d',n),'demo','—',NULL,'—',NULL,'—','not-run',datetime('now') FROM demo;
