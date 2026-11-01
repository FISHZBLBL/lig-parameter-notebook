-- Optional AUTH_MODE=code. Bootstrap/reset is an administrator operation only.
-- These auth tables deliberately do not own/reference notebook state, so an
-- administrator can rotate auth while preserving owner:<email> experiment data.
CREATE TABLE IF NOT EXISTS lig_auth_owner (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  owner_id TEXT NOT NULL UNIQUE CHECK (length(owner_id) BETWEEN 1 AND 400),
  access_code_hash TEXT NOT NULL CHECK (length(access_code_hash) = 64),
  initialized_at INTEGER NOT NULL CHECK (initialized_at > 0)
);

CREATE TABLE IF NOT EXISTS lig_auth_sessions (
  session_hash TEXT PRIMARY KEY NOT NULL CHECK (length(session_hash) = 64),
  owner_id TEXT NOT NULL REFERENCES lig_auth_owner(owner_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS lig_auth_sessions_expiry ON lig_auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS lig_auth_rate_limits (
  bucket_key TEXT PRIMARY KEY NOT NULL CHECK (length(bucket_key) BETWEEN 1 AND 100),
  window_started INTEGER NOT NULL,
  failures INTEGER NOT NULL CHECK (failures >= 1),
  blocked_until INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
