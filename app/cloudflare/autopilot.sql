CREATE TABLE IF NOT EXISTS social_production (
 slot TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL, due INTEGER NOT NULL,
 stage TEXT NOT NULL, plan TEXT, raw_asset TEXT, final_asset TEXT, quality TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, error TEXT, updated INTEGER NOT NULL, created INTEGER NOT NULL
);
