# Seeding your existing books

## Option A: scan with OpenReads, then import its export

Since OpenReads' own barcode scanning is fast and reliable (unlike this
site's browser-based scanner — see the project history for why), the
easiest way to catalogue a big physical shelf is to scan everything into
OpenReads, then import its export here:

1. In OpenReads, scan your whole collection into one library.
2. Export it as CSV (OpenReads' own format — [documented
   here](https://github.com/mateusz-bak/openreads/blob/main/doc/csv.md)).
3. Run it straight through the converter, no editing needed:

   ```sh
   node seed/csv-to-seed.js seed/books.csv > seed/seed.sql
   ```

   OpenReads has no concept of "who owns this" (it's a single-user reading
   tracker), so every imported book gets `owner_id` set to the `N/A`
   person — same default the add-book form uses. Edit ownership later,
   either directly in D1 or by re-running with an `owner` column added
   (see Option B). Rows marked `deleted=true` in OpenReads are skipped
   automatically.

## Option B: your own spreadsheet, with owners

If you'd rather assign owners upfront, export/build a CSV with a header
row containing at least `title`, plus optionally `isbn`, `author`, and
`owner`:

```csv
isbn,title,author,owner
9780547928227,The Hobbit,J.R.R. Tolkien,Shared
```

`owner` must match a name in the `people` table (case-insensitive) —
rows with an unrecognised name are skipped and listed on stderr so you
can fix the spreadsheet or add the missing person via a new migration.
Rows with no `owner` column, or a blank cell, default to `N/A`.

## Either way

Make sure the `people` table is already seeded on the **remote** D1
database and the Worker is deployed, so `https://books.asherpayn.uk/people`
returns your real list — `csv-to-seed.js` reads it live to turn owner
names into ids.

Generate the SQL, then load it directly into the remote database — this
is a plain `wrangler` CLI call, so it bypasses the Worker and Turnstile
entirely:

```sh
node seed/csv-to-seed.js seed/books.csv > seed/seed.sql
cd worker
npx wrangler d1 execute bookdb-db --remote --file=../seed/seed.sql
```

`seed/*.csv` and `seed/seed.sql` are gitignored since they contain your
personal book list.
