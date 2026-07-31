CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  isbn TEXT,
  title TEXT NOT NULL,
  author TEXT,
  owner_id INTEGER REFERENCES people(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ISBN lookup is the hot path (every barcode scan), so index it.
CREATE INDEX idx_books_isbn ON books(isbn);
