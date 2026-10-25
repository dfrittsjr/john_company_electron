// Secrets (`wrangler secret put`) are not in wrangler.jsonc, so `wrangler types` only lists them
// when a local .dev.vars happens to exist. Declaring them here keeps the type check the same on a
// clean checkout. If the generated file also lists the secret, the identical declaration merges.
interface Env {
  TURNSTILE_SECRET: string;
}
