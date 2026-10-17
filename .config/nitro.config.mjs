// .config/nitro.config.mjs
//
// Project-level Nitro configuration. Nitro loads this file on its own (via
// c12) during every `vite build` / `vite dev`; the Lovable TanStack config
// wrapper does NOT inject Cloudflare options outside a Lovable sandbox, so this
// is the isolated place for project-level Nitro overrides.
//
// PURPOSE — TEST isolation only
// -----------------------------
// Nitro's `cloudflare-module` preset writes `.output/server/wrangler.json` and
// derives its `name` from the production `wrangler.toml`. Under the TEST build
// only, this file pins the TEST Worker name so the generated deploy config
// targets the TEST Worker.
//
// Source of truth (nitro/dist/_presets.mjs -> writeWranglerConfig):
//     wranglerConfig = defu(overrides, nitro.options.cloudflare.wrangler,
//                           wrangler.toml, defaults)
// `nitro.options.cloudflare.wrangler` (ctxConfig) takes precedence over
// `wrangler.toml`, so setting only `name` overrides just the Worker name; every
// other generated field (main, assets, compatibility_date, compatibility_flags,
// no_bundle, rules) is preserved and Nitro defaults are untouched.
//
// FAIL-CLOSED
// -----------
// The override activates ONLY when the build is explicitly the TEST build:
//   * `npm run build:test`  ->  npm exposes npm_lifecycle_event="build:test"
//   * or an explicit SLMM_BUILD_TARGET="test"
// For every production/default build this module returns an empty object, so
// the override does not activate and Nitro falls back to `wrangler.toml`
// (production Worker name unchanged).
//
// This file contains no secrets and no environment/resource bindings.

const isTestBuild =
  process.env.npm_lifecycle_event === "build:test" ||
  process.env.SLMM_BUILD_TARGET === "test";

export default isTestBuild
  ? { cloudflare: { wrangler: { name: "slmm-boyar-matrimony-test" } } }
  : {};
