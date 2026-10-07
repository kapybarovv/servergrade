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

-- Remove the retired synthetic seed range without touching user results.
DELETE FROM result_assets WHERE result_id BETWEEN '91000001' AND '91000056';
DELETE FROM secure_upload_tokens WHERE result_id BETWEEN '91000001' AND '91000056';
DELETE FROM result_upload_tokens WHERE result_id BETWEEN '91000001' AND '91000056';
DELETE FROM result_security WHERE result_id BETWEEN '91000001' AND '91000056';
DELETE FROM result_details WHERE result_id BETWEEN '91000001' AND '91000056';
DELETE FROM results WHERE id BETWEEN '91000001' AND '91000056';
