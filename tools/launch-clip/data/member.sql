CREATE TABLE IF NOT EXISTS member_profiles (user_id TEXT PRIMARY KEY,line_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS member_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS member_links (user_id TEXT NOT NULL,club TEXT NOT NULL,player_id TEXT,name TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,club));
INSERT OR REPLACE INTO member_profiles VALUES ('Ubeer','เบียร์');
INSERT OR REPLACE INTO member_sessions VALUES ('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb','Ubeer',1797404178000);
INSERT OR REPLACE INTO member_links VALUES ('Ubeer','sena','p11','เบียร์','existing','approved','2026-11-01T00:00:00Z');
