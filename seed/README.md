# Seeding your existing books

1. Make sure the `people` table is already seeded on the **remote** D1
   database (apply `worker/migrations/0002_seed_people.sql` with your real
   family member names — see the top-level README) and the Worker is
   deployed, so `https://books.asherpayn.uk/people` returns your real people
   list. `csv-to-seed.js` reads that list live to turn owner names into ids.

2. Export your book spreadsheet to CSV with a header row containing at
   least `title` and `owner`, plus optionally `isbn` and `author`:

   ```csv
   isbn,title,author,owner
   9780547928227,The Hobbit,J.R.R. Tolkien,Shared
   ```

   `owner` must match a name in the `people` table (case-insensitive).

3. Generate the SQL:

   ```sh
   node seed/csv-to-seed.js seed/books.csv > seed/seed.sql
   ```

   Any rows with an unrecognised owner name are skipped and listed on
   stderr so you can fix the spreadsheet or add the missing person.

4. Load it directly into the remote database — this is a plain `wrangler`
   CLI call, so it bypasses the Worker and Turnstile entirely:

   ```sh
   cd worker
   npx wrangler d1 execute bookdb-db --remote --file=../seed/seed.sql
   ```

`seed/*.csv` and `seed/seed.sql` are gitignored since they contain your
personal book list.
