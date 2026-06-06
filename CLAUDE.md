# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A philosophical personality test (灵魂地图 / "Soul Map") — 40 questions across 10 dimensions producing one of 16 archetypes (e.g. `FVSW` · 道家顶流 · #松弛通透型). It's Chinese-first, dark-academia in tone, and the content (slogans, microfiction, opponent characters, practices) is deliberately literary — not BuzzFeed.

The user experience has three "Acts":
- **Act I**: signup → 40-question quiz → axes reveal → rarity reveal → archetype reveal → result page.
- **Act II** (meaning journey): values bull's-eye (`compass`) → signature strengths (`signature` / 三盏灯) → Best Possible Self (`possible-self`) → manifesto (`bullseye-result`).
- **Act III**: weekly seed `commitment` + a cron that mails a Socratic "letter from the archetype's opponent" every Monday.

Anonymous is the default entry path. Email is collected post-result (the inline `#resultEmailCard` and the `upgradeEmailModal`) — this is what unlocks Act II/III.

## Architecture in 60 seconds

```
public/index.html      ← the entire frontend (single ~4600-line SPA). EDIT THIS.
public/admin.html      ← ops dashboard (sees raw D1 tables).
src/worker.js          ← Cloudflare Worker: 12 /api/* endpoints + scheduled() cron handler.
schema.sql             ← canonical schema reference (not auto-applied).
migration-v{3,5,6}.sql ← incremental D1 migrations, applied manually via wrangler d1 execute.
wrangler.toml          ← binds DB (soul-map-db), assets dir (./public), weekly cron.
.github/workflows/deploy.yml  ← GitHub Actions auto-deploys to Cloudflare on push to main.
```

**There is a stale `index.html` at the repo root — IGNORE IT.** Cloudflare serves `public/index.html` (the [assets] directory in `wrangler.toml`). The root file is an old snapshot that diverged.

Frontend SPA pattern: every "page" is a `<section class="screen">` toggled by `showScreen(id)`. The screen IDs in order are:
`intro → prologue → journey-intro → quiz → calculating → axes-reveal → reveal → result → compass → signature → possible-self → bullseye-result → commitment → commitment-done`

State lives in a single `state` object plus `safeStorage` (localStorage wrapper); session continuity is by `state.sessionId` (UUID generated client-side, stored in `soulmap_session`).

### Backend endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/submit` | Stores a completed quiz row in `submissions`. Updates leads row if `session_id` matches. |
| `POST /api/lead` | Upserts a `leads` row (key = `session_id`). Optional `archetype_code/display_code/poetic_name` lets the post-result upgrade flow create the row already 'completed'. |
| `POST /api/lead/progress` | Pinged at Q10/Q20/Q30 to track funnel drop-off. |
| `GET  /api/lookup?email=` | Returning-user lookup (most recent submission for an email). |
| `GET  /api/counts` | Per-archetype submission counts. |
| `GET  /api/stats` | Aggregate stats for `admin.html`. |
| `GET  /api/export` | CSV/JSON export (admin-key gated). |
| `GET  /api/referral` | Compatibility check between two referral codes. |
| `POST /api/send-report` | Sends the result PDF via Resend (rate-limited per email). |
| `POST /api/journey` | Persists Act II artifacts (`values_json` / `strengths_json` / `bps_text`) onto the lead. |
| `POST /api/commit` | Inserts an Act III `commitments` row with `reminded_at = next Monday 09:00 Beijing`. |
| `POST /api/cron-test` | Manually triggers the scheduled handler (admin-key gated). |
| `scheduled()` | Mondays 01:00 UTC: sends opponent-letter emails for all active commitments due this week, advances `reminded_at` by 7 days; auto-marks `status='done'` after `WEEKS_TOTAL` (12). |

### D1 tables

- `submissions` — one row per completed quiz (email is **nullable** — anonymous users land here).
- `leads` — funnel + Act II/III state by `session_id` (email is **NOT NULL** — only created when user opts in).
- `commitments` — Act III weekly seeds + cron schedule.
- `archetype_counts`, `referrals`, `email_sends` — counters & integrity tables.

### Sync points to remember

- The archetype list lives in `public/index.html` (`ARCHETYPES[]`) and also in `src/worker.js` as `ARCHETYPE_OPPONENTS` (just the opponent name + Socratic challenge, for the cron emails). **Keep both in sync** when adding or renaming archetypes.

## Commands

### Deploy

`git push origin main` is the deploy. GitHub Actions runs `wrangler deploy` automatically (see `.github/workflows/deploy.yml`). No `npm install` needed — there's no `package.json`; the workflow uses the bundled wrangler.

Watch a deploy:
```
gh run watch --repo wxydayie8888/soul-map $(gh run list --repo wxydayie8888/soul-map --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```

Manual deploy (rarely needed):
```
npx wrangler deploy
```

### D1 database

Apply a migration:
```
npx wrangler d1 execute soul-map-db --remote --file=migration-v7.sql
```

Read a query:
```
npx wrangler d1 execute soul-map-db --remote --command="SELECT count(*) FROM leads WHERE archetype_code IS NOT NULL"
```

For local dev D1 (no remote write), drop `--remote`.

### Secrets

Live secrets are in Cloudflare (`wrangler secret put RESEND_API_KEY`, `ADMIN_KEY`, `CRON_TEST_KEY`). GitHub Actions has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (`7d52c39e13d57c5af3d10dd8b498c893`). Never commit `.dev.vars` (already gitignored).

### No tests

There is no test suite. Smoke testing is manual — point a browser at the live URL, or use Chrome MCP / `curl` against `https://soul-map.wangxingyu-will.workers.dev/`.

## Conventions that matter

- **Edit `public/index.html`, not root `index.html`.** Always.
- **Chinese-first copy.** Functional UI (buttons, hints) is Chinese. English appears only as subtitle eyebrow text (`PHILOSOPHICAL SOUL CARTOGRAPHY`) or section titles for typographic contrast. Don't introduce English UI strings.
- **Tone is dark academia / philosophical**, not BuzzFeed. Avoid emoji in copy unless it's already established (e.g. `💘 灵魂 CP`, `💔 灵魂克星`, `🤝 灵魂契约`). Avoid exclamation marks.
- **Anonymous-first.** Never gate the quiz behind email collection. The opt-in is post-result via `#resultEmailCard` → `upgradeEmailModal` → `/api/lead` (with archetype info forwarded so the leads row is born `completed`).
- **`$('foo')?.value` everywhere.** The hero is form-less now; any code that reads `nameInput`/`emailInput` must be null-safe — those elements only exist inside modals.
- **iOS-safe inputs.** Modal/result email inputs must use `font-size: 16px` (anything smaller triggers iOS focus zoom). Touch targets ≥ 44×44 (Apple HIG); use `min-height: 48px` on CTAs.
- **Three.js is mobile-degraded.** `setupThreeBg()` halves particle count and skips mouse-lerp when `(pointer: coarse)` or viewport <700px. Don't undo this when adding new visuals.
- **Modals are bottom-drawers on mobile** (existing `.modal-backdrop .modal` rule at the 700px breakpoint). New modals should reuse `.modal-backdrop` / `.modal` / `.modal-title` so they inherit this automatically.
- **Email card sits in result-page natural scroll** (`#resultEmailCard` rendered by `renderResultEmailCard()`). Don't auto-pop modals on the result page — the card on its own converts without interrupting.
- **No `package.json`.** Wrangler is invoked via `npx`; there's nothing to `npm install`. If you need a build step, you'll need to introduce one and update the deploy workflow.

## Watch-outs (things that have actually bitten)

1. **Two `index.html` files exist.** Root is stale. Editing it does nothing — the deploy serves `public/index.html`. Verify your edits land in `public/`.
2. **Quiz progress counter** says "X / 36" but the marketing copy says "40 道题". The 4 dimension-bridging questions (one between each pair) make the visible total 36 while the discovery still uses the 40 framing. Don't "fix" by changing one number without changing the other.
3. **Screen transitions use opacity, not display.** `.screen { opacity: 0; visibility: hidden }` → `.active { opacity: 1; visibility: visible }` with a 0.7s transition. Any JS that "is this element visible" check must include `opacity === '0'` (not just display/visibility) for modal-backdrop, but must check `visibility` for screens (which always render).
4. **`/api/lead` requires email.** Anonymous quiz completion writes `/api/submit` only — no leads row exists until the user opts in via the post-result email card. That's why `/api/journey` and the cron silently no-op for anonymous-only users (the UPDATE matches 0 rows).
5. **OG image generation can't go through ImageMagick.** Its SVG renderer doesn't resolve Chinese font-family lists. The 1200×630 share card was rendered via browser Canvas; the workflow lives in this CLAUDE.md memory only (not committed). If you need to regenerate, do it in a browser tab and POST the blob.
6. **Cron is real.** The Monday 09:00 Beijing cron will fire against production D1 and Resend. Test via `/api/cron-test` with `CRON_TEST_KEY` first.
