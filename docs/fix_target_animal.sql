ALTER TABLE recipe ALTER COLUMN target_animal SET DEFAULT 'other';
UPDATE recipe SET target_animal = 'other' WHERE target_animal IS NULL;
