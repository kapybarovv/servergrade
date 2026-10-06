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
