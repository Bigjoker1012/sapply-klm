-- Add created_at and created_by columns
ALTER TABLE sku_alias ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE sku_alias ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES "user"(id);

-- Update existing rows
UPDATE sku_alias SET created_at = now() WHERE created_at IS NULL;

-- Add unique constraint on alias (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS sku_alias_lower_unique ON sku_alias(lower(alias));
