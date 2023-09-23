CREATE TABLE images (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  tag TEXT
);