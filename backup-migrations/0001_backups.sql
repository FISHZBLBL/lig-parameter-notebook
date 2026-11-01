-- Independent backup database: notebook content only, never authentication tables.
CREATE TABLE IF NOT EXISTS lig_backup_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK(source_revision > 0),
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('daily','manual')),
  slot TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 1024),
  state_bytes INTEGER NOT NULL CHECK(state_bytes BETWEEN 1 AND 8388608),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  UNIQUE(owner_id,kind,slot)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS lig_backup_owner_time ON lig_backup_snapshots(owner_id,kind,created_at);
CREATE TABLE IF NOT EXISTS lig_backup_chunks (
  snapshot_id TEXT NOT NULL REFERENCES lig_backup_snapshots(snapshot_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK(chunk_index BETWEEN 0 AND 1023),
  state_chunk TEXT NOT NULL CHECK(length(CAST(state_chunk AS BLOB)) BETWEEN 1 AND 1500000),
  PRIMARY KEY(snapshot_id,chunk_index)
) WITHOUT ROWID;
