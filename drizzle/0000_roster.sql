CREATE TABLE roster_user (
  key TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  masked_id TEXT NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0,
  credential TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE roster_session (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_key TEXT NOT NULL REFERENCES roster_user(key) ON DELETE CASCADE,
  user_revision INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX roster_session_expiry ON roster_session(expires_at);
--> statement-breakpoint
CREATE TABLE roster_setup (
  name TEXT PRIMARY KEY NOT NULL
);
