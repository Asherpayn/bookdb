-- Holds either an Open Library cover URL or a data: URI for a cover photo
-- the user took/uploaded themselves (see docs/app.js) — both render fine
-- in an <img src="...">, so one column covers both cases.
ALTER TABLE books ADD COLUMN cover_url TEXT;
