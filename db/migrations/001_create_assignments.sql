-- 001_create_assignments.sql
-- Minimal overlay assignments table (low classification risk fields only)

BEGIN;

-- Needed for GiST index that combines site (btree) + range (gist)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS assignments (
  id BIGSERIAL PRIMARY KEY,

  site                TEXT NOT NULL,

  assignment_serial   TEXT NOT NULL,
  source_name         TEXT NOT NULL DEFAULT 'SFAF',

  center_frequency_hz BIGINT NOT NULL,
  bandwidth_hz        BIGINT NOT NULL,

  freq_start_hz       BIGINT NOT NULL,
  freq_stop_hz        BIGINT NOT NULL,

  -- Generated range for overlap queries
  freq_range          int8range GENERATED ALWAYS AS (
                        int8range(freq_start_hz, freq_stop_hz, '[]')
                      ) STORED,

  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,

  valid_from          DATE,
  valid_to            DATE,

  ingested_at_utc     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assignments_serial_per_site_uk UNIQUE (site, assignment_serial),

  CONSTRAINT assignments_freq_bounds_ck CHECK (freq_start_hz <= freq_stop_hz),
  CONSTRAINT assignments_bw_positive_ck CHECK (bandwidth_hz > 0),
  CONSTRAINT assignments_center_positive_ck CHECK (center_frequency_hz > 0)
);

-- Query pattern:
-- WHERE site = $1 AND freq_range && int8range($band_start, $band_stop, '[]')
CREATE INDEX IF NOT EXISTS assignments_site_freqrange_gist
  ON assignments
  USING GIST (site, freq_range);

CREATE INDEX IF NOT EXISTS assignments_site_serial_idx
  ON assignments (site, assignment_serial);

COMMIT;
