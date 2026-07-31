#!/usr/bin/env node
// Converts a CSV export of your book spreadsheet into a seed.sql of INSERT
// statements, ready for:
//   wrangler d1 execute bookdb-db --remote --file=./seed.sql
//
// Usage:
//   node csv-to-seed.js books.csv > seed.sql
//
// Requires a "title" column; "isbn" and "author" are used if present.
// This also accepts OpenReads' CSV export format as-is (see
// https://github.com/mateusz-bak/openreads/blob/main/doc/csv.md) — its
// extra columns (subtitle, status, rating, etc.) are simply ignored, and
// rows with deleted=true are skipped.
//
// "owner" is optional. If present, it should be a name matching a row in
// the `people` table (this script looks up the live list from the
// deployed Worker's `GET /people`, so you write names, not ids). Rows
// with no owner column, or a blank cell, default to the "N/A" person —
// OpenReads has no concept of book ownership, so a bulk import from it
// will default everything to N/A for you to assign later.
//
// Generated INSERTs check for an existing row before inserting, so it's
// safe to import in overlapping chunks — e.g. re-exporting your whole
// growing OpenReads library each time rather than isolating just the
// newly-scanned books — without creating duplicate rows. The dedup key
// differs by source, because "two rows with the same isbn" means
// different things in each:
//   - No owner column (OpenReads): every row defaults to owner_id = N/A,
//     so dedup is on isbn alone. This also means it keeps deduping
//     correctly even after you've since reassigned a book's owner away
//     from N/A in the live data — an isbn-only check still finds it.
//   - Explicit owner column: dedup is on (isbn, owner_id), since two
//     different people legitimately owning a copy of the same isbn is a
//     real, intentional case here, not a duplicate.
// Neither key covers books with no ISBN at all, since there's nothing
// else to key on; those could still double up across chunks.

import { readFileSync } from "node:fs";

const API_BASE = "https://books.asherpayn.uk";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (field !== "" || row.length > 0) {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: node csv-to-seed.js <books.csv> > seed.sql");
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const [header, ...dataRows] = rows;
  const col = (name) => header.indexOf(name);
  const isbnCol = col("isbn");
  const titleCol = col("title");
  const authorCol = col("author");
  const ownerCol = col("owner");
  const deletedCol = col("deleted"); // present in OpenReads exports

  if (titleCol === -1) {
    console.error(`CSV must have a "title" column. Found: ${header.join(", ")}`);
    process.exit(1);
  }

  const peopleRes = await fetch(`${API_BASE}/people`);
  if (!peopleRes.ok) {
    console.error(`Could not fetch people list from ${API_BASE}/people (${peopleRes.status}). Is the Worker deployed and migrated?`);
    process.exit(1);
  }
  const { results: people } = await peopleRes.json();
  const nameToId = new Map(people.map((p) => [p.name.toLowerCase(), p.id]));
  const naId = nameToId.get("n/a");
  if (naId === undefined) {
    console.error(`No "N/A" row in the people table — apply worker/migrations/0004_add_na_person.sql first.`);
    process.exit(1);
  }

  const statements = [];
  const unknownOwners = new Set();

  for (const cells of dataRows) {
    if (cells.every((c) => c === "")) continue; // skip blank lines
    if (deletedCol !== -1 && (cells[deletedCol]?.trim().toLowerCase() ?? "") === "true") continue;

    const ownerName = ownerCol !== -1 ? (cells[ownerCol]?.trim() ?? "") : "";
    let ownerId = naId;
    if (ownerName) {
      const matchedId = nameToId.get(ownerName.toLowerCase());
      if (matchedId === undefined) {
        unknownOwners.add(ownerName);
        continue;
      }
      ownerId = matchedId;
    }

    const isbn = isbnCol !== -1 ? cells[isbnCol]?.trim() : "";
    const title = cells[titleCol]?.trim() ?? "";
    const author = authorCol !== -1 ? cells[authorCol]?.trim() : "";

    const dedupeCondition =
      ownerCol !== -1 ? `isbn = ${sqlString(isbn)} AND owner_id = ${ownerId}` : `isbn = ${sqlString(isbn)}`;

    statements.push(
      `INSERT INTO books (isbn, title, author, owner_id)\n` +
        `SELECT ${sqlString(isbn)}, ${sqlString(title)}, ${sqlString(author)}, ${ownerId}\n` +
        `WHERE NOT EXISTS (SELECT 1 FROM books WHERE ${dedupeCondition});`,
    );
  }

  if (unknownOwners.size > 0) {
    console.error(`Skipped rows with owner names not found in the people table: ${[...unknownOwners].join(", ")}`);
    console.error(`Add them to a new migration and re-run migrations first.`);
  }

  console.log(statements.join("\n"));
}

main();
