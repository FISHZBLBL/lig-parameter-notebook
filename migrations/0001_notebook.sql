-- Migration-owned schema. Apply through Wrangler/D1 migrations before deploying.
-- One owner has one current notebook. Large JSON is split to respect D1's 2 MB
-- maximum value/row size. All chunks and the CAS revision change in one batch.
CREATE TABLE IF NOT EXISTS lig_user_states (
  owner_id TEXT PRIMARY KEY NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 1024),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  schema_version INTEGER NOT NULL CHECK (schema_version = 3),
  chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 32),
  state_bytes INTEGER NOT NULL CHECK (state_bytes BETWEEN 1 AND 8388608),
  write_token TEXT NOT NULL CHECK (length(write_token) = 36),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS lig_state_chunks (
  owner_id TEXT NOT NULL REFERENCES lig_user_states(owner_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 31),
  state_chunk TEXT NOT NULL CHECK (length(CAST(state_chunk AS BLOB)) BETWEEN 1 AND 1500000),
  PRIMARY KEY (owner_id, chunk_index)
) WITHOUT ROWID;
