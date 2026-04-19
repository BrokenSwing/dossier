PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT    NOT NULL PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,   -- argon2id hash of authKey, NOT the raw password (see key derivation in STACK.md)
  totp_secret   TEXT    NOT NULL,
  totp_confirmed INTEGER NOT NULL DEFAULT 0,
  encrypted_dek TEXT    NOT NULL,
  dek_iv        TEXT    NOT NULL,
  kdf_params    TEXT    NOT NULL,   -- JSON { memory, iterations, parallelism, salt }
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE sessions (
  id         TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT NULL
);
CREATE INDEX sessions_user_id    ON sessions(user_id);
CREATE INDEX sessions_expires_at ON sessions(expires_at);

CREATE TABLE documents (
  id             TEXT    NOT NULL PRIMARY KEY,
  user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  format         TEXT    NOT NULL CHECK(format IN ('pdf','jpg','png')),
  blob_key       TEXT    NOT NULL UNIQUE,
  encrypted_size INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX documents_user_id            ON documents(user_id);
CREATE INDEX documents_user_id_created_at ON documents(user_id, created_at);
CREATE INDEX documents_user_id_name       ON documents(user_id, name COLLATE NOCASE);

CREATE TABLE tags (
  id      TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL COLLATE NOCASE,
  UNIQUE(user_id, name)
);
CREATE INDEX tags_user_id ON tags(user_id);

CREATE TABLE document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags(id)      ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);
CREATE INDEX document_tags_tag_id ON document_tags(tag_id);

CREATE TABLE collections (
  id             TEXT NOT NULL PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  parent_id      TEXT NULL REFERENCES collections(id) ON DELETE RESTRICT,
  watermark_text TEXT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(user_id, parent_id, name)
  -- NOTE: SQLite treats NULL != NULL in UNIQUE constraints, so root-level name
  -- uniqueness (parent_id IS NULL) must be enforced in application code.
);
CREATE INDEX collections_user_id_parent_id ON collections(user_id, parent_id);

CREATE TABLE collection_documents (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  document_id   TEXT NOT NULL REFERENCES documents(id)   ON DELETE CASCADE,
  PRIMARY KEY (collection_id, document_id)
);
CREATE INDEX collection_documents_document_id ON collection_documents(document_id);
