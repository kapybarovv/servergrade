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
