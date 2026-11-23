-- Epoch timestamps are UTC milliseconds. No application/demo data is seeded.
PRAGMA foreign_keys = ON;

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE CHECK (length(google_sub) BETWEEN 1 AND 255),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL
) STRICT;

-- This installation is explicitly limited to the two offline-provisioned users.
CREATE TRIGGER users_two_account_limit BEFORE INSERT ON users
WHEN (SELECT count(*) FROM users) >= 2
BEGIN
  SELECT RAISE(ABORT, 'Only two registered accounts are supported');
END;

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (household_id, user_id)
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at <= absolute_expires_at)
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX shopping_household_created ON shopping_items(household_id, created_at, id);

CREATE TABLE thanks_posts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (household_id, author_id) REFERENCES household_members(household_id, user_id)
) STRICT;
CREATE INDEX thanks_household_created ON thanks_posts(household_id, created_at DESC, id DESC);

CREATE TABLE thanks_reactions (
  post_id TEXT NOT NULL REFERENCES thanks_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_code TEXT NOT NULL CHECK (reaction_code IN ('super-thanks','thanks','awesome','heart','clap')),
  PRIMARY KEY (post_id, user_id, reaction_code)
) STRICT;

-- Short-lived, one-use OAuth transactions. Only hashes of browser secrets are stored.
CREATE TABLE oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  verifier_hash TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  return_to TEXT NOT NULL CHECK (return_to IN ('/shopping-list', '/thanks-board')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;
CREATE INDEX oauth_transaction_expiry ON oauth_transactions(expires_at);
