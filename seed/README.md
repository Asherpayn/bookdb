# Bulk import tooling

`csv-to-seed.js` converts a CSV of books into SQL `INSERT` statements,
which get loaded into D1 with a direct `wrangler d1 execute` call — a
plain CLI operation, not an HTTP request, so it bypasses the Worker and
Turnstile entirely. That's the intended route for a big one-off import of
an existing collection, rather than adding hundreds of books one at a
time through the Turnstile-gated form.

It's designed to accept two shapes of input:

- **[OpenReads](https://github.com/mateusz-bak/openreads)'s own CSV
  export format**
  ([documented here](https://github.com/mateusz-bak/openreads/blob/main/doc/csv.md)),
  used as-is with no editing — since OpenReads' scanner is far more
  reliable than this site's browser-based one, scanning a whole shelf
  there and importing the export is the practical way to catalogue a
  large physical collection. OpenReads has no concept of book ownership
  (it's a single-user reading tracker), so every row it produces gets
  `owner_id` set to the `N/A` person, to be reassigned per-book later.
  Rows OpenReads marks `deleted=true` are skipped.
- **A plain spreadsheet export**, with a header row of `title` plus
  optionally `isbn`, `author`, and `owner`. `owner` is matched
  case-insensitively against the live `people` table (fetched from
  `GET /people`, so names are looked up as ids automatically); an
  unrecognised name is skipped and reported rather than silently
  discarded, and a missing or blank `owner` cell also defaults to `N/A`.

Rather than a one-off dump, this is meant to support importing in
chunks — the generated `INSERT`s are conditioned on `(isbn, owner_id)` not
already existing, so re-running against overlapping data (e.g.
re-exporting the whole, growing OpenReads library each time rather than
isolating just the newly-scanned books) doesn't create duplicate rows.
That dedup key doesn't help for books with no ISBN at all, since there's
nothing else to key on — those could still double up across chunks.

`seed/*.csv` and `seed/seed.sql` are gitignored, since they'd contain a
full personal book list.
