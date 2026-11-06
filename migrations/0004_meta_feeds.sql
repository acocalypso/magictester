CREATE TABLE meta_feeds (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 url text NOT NULL UNIQUE,
 format text NOT NULL,
 interval_hours integer NOT NULL CHECK(interval_hours BETWEEN 1 AND 720),
 permission text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 next_check_at timestamptz NOT NULL DEFAULT now(),
 last_checked_at timestamptz,
 last_success_at timestamptz,
 last_error text,
 digest text,
 etag text,
 snapshot_id uuid REFERENCES meta_snapshots(id)
);
CREATE INDEX feeds_due_idx ON meta_feeds(next_check_at) WHERE enabled;
