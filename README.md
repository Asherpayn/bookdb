# Family Book Index

Barcode-scan lookup so we stop buying duplicate books. Frontend on GitHub
Pages, API on a Cloudflare Worker, data in Cloudflare D1. See
`/Users/asherpayn/.claude/plans/family-book-index-validated-pretzel.md` for
the full design rationale.

- `worker/` — Cloudflare Worker (TypeScript) + D1 migrations
- `docs/` — static frontend, served by GitHub Pages
- `seed/` — turns a CSV export of your existing books into `seed.sql`

## One-time setup

Run these roughly in order — later steps depend on earlier ones.

### 1. Install worker dependencies

```sh
cd worker
npm install
```

### 2. Log in to Cloudflare

```sh
npx wrangler login
```

Opens a browser to authorize `wrangler` against your Cloudflare account
(the same one with `asherpayn.uk`).

### 3. Create the D1 database

```sh
npx wrangler d1 create bookdb-db
```

This prints a `database_id` — copy it into `worker/wrangler.jsonc`,
replacing `<DATABASE_ID>` in the `d1_databases` block.

### 4. Generate binding types

```sh
npm run types
```

Reads `wrangler.jsonc` and writes `worker/worker-configuration.d.ts` with a
generated `Env` interface (the `DB`, `READ_LIMITER`, etc. types your editor
and `tsc` use) — it's gitignored since it's regenerated from config, not
hand-maintained. Re-run this any time you change a binding in
`wrangler.jsonc`.

### 5. Set your family's names

Edit `worker/migrations/0002_seed_people.sql` — replace the placeholder
names with your actual family members (keep or rename the `Shared` row).

### 6. Apply migrations

```sh
npm run db:migrate:local   # for local `wrangler dev` testing
npm run db:migrate:remote  # for the live database
```

### 7. Create a Turnstile widget

In the Cloudflare dashboard: **Turnstile → Add widget**.
- Domains: add both `shelf.asherpayn.uk` and `localhost` (for local testing).
- Widget mode: "Managed" is a good default (invisible unless it suspects a bot).

This gives you a **site key** (public) and a **secret key** (private).

- Site key → paste into `docs/app.js`, replacing `<TURNSTILE_SITE_KEY>`.
- Secret key → set as a Worker secret (next step). Never commit it.

### 8. Set the Turnstile secret

```sh
cd worker
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Paste the secret key when prompted — running this yourself (rather than
asking an assistant to run it) keeps it out of any chat/session log.

For local `wrangler dev` testing, secrets come from a `.dev.vars` file
instead:

```sh
cp worker/.dev.vars.example worker/.dev.vars
```

The example file already contains Cloudflare's public "always passes" test
secret key, so local dev doesn't need your real secret.

### 9. Deploy the Worker

```sh
cd worker
npm run deploy
```

First deploy also provisions the `books.asherpayn.uk` custom domain (DNS +
cert) automatically, since `asherpayn.uk` is already on this Cloudflare
account — it only adds that one subdomain record, nothing on the apex
domain or your existing `asherpayn.github.io` site is touched.

Sanity check: `curl https://books.asherpayn.uk/people` should return your
seeded family members as JSON.

### 10. Publish the frontend on GitHub Pages

- Create a new GitHub repo (e.g. `bookdb`) and push this project to it.
- Repo **Settings → Pages**: source = "Deploy from a branch", branch =
  `main`, folder = `/docs`.
- Cloudflare DNS: add a `CNAME` record, name `shelf`, target
  `asherpayn.github.io`, proxy status **DNS only** (grey cloud) — GitHub's
  certificate issuance for Pages custom domains can fail behind Cloudflare's
  orange-cloud proxy. You can switch it to proxied afterwards if you want.
- Back in repo **Settings → Pages**: set custom domain to
  `shelf.asherpayn.uk`, wait for the certificate, then tick "Enforce HTTPS".

### 11. Load your existing collection

See `seed/README.md` — export your spreadsheet to CSV, generate `seed.sql`,
and load it with a direct `wrangler d1 execute --remote` call (bypasses the
Worker/Turnstile entirely, as intended).

## Local development

```sh
cd worker && npm run dev        # Worker on http://127.0.0.1:8787, local D1
npx serve docs                  # frontend on http://localhost:3000
```

Point `CONFIG.apiBase` in `docs/app.js` at `http://127.0.0.1:8787` while
testing locally, and remember to set it back to
`https://books.asherpayn.uk` before deploying. Camera access requires a
secure context — `http://localhost` counts, `file://` does not, which is
why the frontend needs `npx serve` (or similar) even for local testing.

To exercise the full add-book flow locally (not just `curl`), the
Turnstile hostname check needs to line up with wherever you're serving the
frontend from. In `worker/.dev.vars`, add
`ALLOWED_ORIGIN=http://localhost:3000` (or whatever `npx serve` prints) —
this only overrides the local `wrangler dev` value, the deployed Worker
still uses `https://shelf.asherpayn.uk` from `wrangler.jsonc`. Also swap
`docs/app.js`'s `turnstileSiteKey` to Cloudflare's test key
`1x00000000000000000000AA` (always passes) while doing this, so you don't
need your real widget for local testing. A raw `curl -X POST .../books`
with a made-up token will still correctly get rejected with 403, even
using the "always passes" test secret — Cloudflare's siteverify still
checks that the token came from the expected hostname, and a fabricated
token reports `hostname: "example.com"` instead. That's the security check
working, not a bug; only a token minted by a real rendered widget on the
right page will pass.

## One thing intentionally left for you

`mapOpenLibraryBook()` in `docs/app.js` is stubbed with a `TODO` — deciding
how to handle editions missing an author or cover (blank fields? a
placeholder image? skip pre-filling entirely?) is a real UX call about the
scanning flow, not boilerplate, so it's left for you to fill in.
