# Family Book Index

A household tool so we stop buying duplicate books: scan a barcode in a
shop to see instantly whether it's already on the shelf at home, or
browse/add books when cataloguing. One person maintains it; everyone else
just needs the URL.

Live at:
- **`https://shelf.asherpayn.uk`** — the frontend (scan / lookup / add)
- **`https://books.asherpayn.uk`** — the API

## How it works

Scan a barcode → the ISBN is looked up against [Open
Library](https://openlibrary.org/) for title/author/cover → the API is
checked for existing copies → if it's already owned, it shows who by; if
not, it offers to add it. Adding a book requires passing a Turnstile
challenge first — that's the only thing gating writes. Lookups stay
completely open and fast, since the whole point is not adding friction to
the in-shop "do we own this?" check.

## Architecture

- **Frontend** (`docs/`) — plain HTML/JS, no framework or build step,
  served by GitHub Pages. Barcode scanning tries the browser's native
  `BarcodeDetector` API first (hardware-accelerated, near-instant where it
  actually works) and falls back to a pure-JS decoder
  (`html5-qrcode`) if native detection doesn't produce a result within a
  few seconds — Safari's implementation of that API exists but is
  currently non-functional, so this fallback is what makes scanning work
  at all on iPhone.
- **API** (`worker/`) — a Cloudflare Worker (TypeScript): `GET /books`,
  `GET /people`, and a Turnstile-gated `POST /books`. Two native Rate
  Limiting bindings cap reads and writes separately, generous on reads
  (scanning shouldn't feel throttled) and strict on writes.
- **Data** — Cloudflare D1. `people` is a proper lookup table rather than
  a fixed enum, seeded with the family (by role — Mum, Dad, Sister, etc. —
  rather than real names) plus a `Shared` entry for jointly-owned books
  and an `N/A` entry that's the default owner for anything not yet
  assigned (in particular, bulk-imported books — see `seed/`).
- **Bot protection** — Cloudflare Turnstile, checked server-side on every
  write via the `siteverify` API. Reads are never gated.
- Both `shelf.asherpayn.uk` and `books.asherpayn.uk` are subdomains added
  to the existing `asherpayn.uk` Cloudflare zone; the pre-existing
  `asherpayn.github.io` site and its DNS records are untouched.
- `robots.txt` and a `noindex` meta tag keep the site out of search
  engines — not a security measure, just reduced exposure.

## Repo layout

- `worker/` — the Worker source and D1 migrations
- `docs/` — the frontend, served from this folder by GitHub Pages
- `seed/` — converts a CSV export of an existing book collection into SQL
  `INSERT`s, loaded directly into D1 via `wrangler d1 execute`, bypassing
  the Worker and Turnstile entirely (see `seed/README.md`)

## Open item

`mapOpenLibraryBook()` in `docs/app.js` is still a stub — how to handle
editions missing an author or cover (blank fields? skip pre-filling
entirely?) hasn't been decided yet.
