// `wrangler types` regenerates worker-configuration.d.ts from wrangler.jsonc,
// but it only knows about bindings/vars declared there. TURNSTILE_SECRET_KEY
// is set via `wrangler secret put` (deployed) / `.dev.vars` (local), so it
// never appears in wrangler.jsonc — this merges it into the same global
// `Env` interface by declaration merging.
declare global {
  interface Env {
    TURNSTILE_SECRET_KEY: string;
  }
}

export {};
