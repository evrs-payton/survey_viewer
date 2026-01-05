-- 002_create_manual_regions.sql
-- Manual regions table for user-created frequency region overlays

BEGIN;

CREATE TABLE IF NOT EXISTS manual_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  site                TEXT NOT NULL,

  freq_start_hz       BIGINT NOT NULL,
  freq_stop_hz        BIGINT NOT NULL,

  label               TEXT,
  color               TEXT DEFAULT 'rgba(255, 200, 0, 0.3)',
  created_by          TEXT,

  created_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT manual_regions_freq_bounds_ck CHECK (freq_start_hz <= freq_stop_hz)
);

-- Index for fast lookup by site and frequency range
CREATE INDEX IF NOT EXISTS manual_regions_site_freq_idx
  ON manual_regions (site, freq_start_hz);

COMMIT;
