-- Additive migration: existing household, shopping, Thanks and authentication data is retained.
CREATE TABLE wishlist_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'achieved')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  achieved_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((status = 'pending' AND achieved_at IS NULL) OR (status = 'achieved' AND achieved_at IS NOT NULL)),
  FOREIGN KEY (household_id, author_id) REFERENCES household_members(household_id, user_id)
) STRICT;
CREATE INDEX wishlist_household_status_updated ON wishlist_items(household_id, status, updated_at DESC, id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK ((status = 'open' AND resolved_at IS NULL) OR (status = 'resolved' AND resolved_at IS NOT NULL)),
  FOREIGN KEY (household_id, author_id) REFERENCES household_members(household_id, user_id)
) STRICT;
CREATE INDEX notes_household_status_updated ON notes(household_id, status, updated_at DESC, id);

-- One independent preference row per user. Missing rows use the same defaults in the API.
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'KAWASAKI' CHECK (theme IN ('KAWASAKI', 'CHARLOTTE', 'EDOGAWA')),
  show_completed_shopping_items INTEGER NOT NULL DEFAULT 0 CHECK (show_completed_shopping_items IN (0, 1)),
  show_achieved_wishes INTEGER NOT NULL DEFAULT 0 CHECK (show_achieved_wishes IN (0, 1)),
  show_resolved_notes INTEGER NOT NULL DEFAULT 0 CHECK (show_resolved_notes IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at INTEGER NOT NULL
) STRICT;
