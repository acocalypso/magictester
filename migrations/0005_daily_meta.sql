ALTER TABLE meta_feeds ADD COLUMN provider text NOT NULL DEFAULT 'json' CHECK(provider IN ('json','mtgtop8','mtgdecks'));
ALTER TABLE meta_feeds ADD COLUMN max_decks integer NOT NULL DEFAULT 10 CHECK(max_decks BETWEEN 1 AND 50);
ALTER TABLE meta_feeds DROP CONSTRAINT meta_feeds_url_key;
CREATE UNIQUE INDEX feed_source_format_idx ON meta_feeds(provider,url,format);
CREATE TABLE source_http_cache (
 url text PRIMARY KEY, body text NOT NULL, sha256 text NOT NULL,
 etag text, last_modified text, checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE source_hosts (host text PRIMARY KEY, next_allowed_at timestamptz NOT NULL DEFAULT now());
