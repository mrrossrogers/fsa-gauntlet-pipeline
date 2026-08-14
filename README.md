# FSA Gauntlet — Setup

One system, all three categories. No per-category activation, no manual copy-paste.

## 1. Database
Run `supabase-schema.sql` in your Supabase SQL editor. Creates `fsa_articles` with
the full status flow (`submitted` → `briefed` → `drafted` → `text_approved` →
`image_drafted` → `ready_for_review` / `needs_human`).

## 2. Environment variables (Vercel project settings)
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=       # service role key, not anon — this runs server-side only
ANTHROPIC_API_KEY=
```

## 3. Deploy
Drop `api/submit-idea.js` and `api/process-article.js` into your existing Vercel
project (they're plain serverless functions — Next.js API routes or Vercel
Functions both work with minor path adjustment). `lib/prompts.js` holds every
agent's system prompt — this file is now your masthead, edit it directly to
tune agents rather than the original .md files.

## 4. Wire the loop
`process-article.js` advances ONE article ONE stage per call — it does not
loop internally, so something needs to call it repeatedly.

**Note: Vercel's Hobby (free) plan only allows built-in cron jobs that run
once a day** — too slow for this. `vercel.json` no longer defines a cron for
that reason. Use a free external cron service instead:

1. Sign up at cron-job.org (or similar) — free.
2. Point it at `https://<your-deployment-url>/api/process-article`
3. Set it to fire every 5 minutes, HTTP GET.

This runs outside Vercel entirely, so the Hobby plan's restriction doesn't
apply — it's just an external service hitting a public URL on a schedule.

If you later upgrade to Vercel Pro, you can restore the built-in cron instead:
```json
{ "crons": [{ "path": "/api/process-article", "schedule": "*/5 * * * *" }] }
```

- **Faster still: self-chaining.** Have `process-article.js` call itself again
  with the same `id` after each successful stage update, so one article runs
  start to finish in seconds instead of waiting on the next external cron
  tick. Worth adding once the external cron is confirmed working.

## 5. Submit an idea
```
POST /api/submit-idea
{ "category": "food", "seed": "the new tasting counter on 3rd", "issue": "current" }
```
That's the only manual step. The system takes it from `submitted` all the way
to `ready_for_review` (your dashboard) or `needs_human` (something needs your
judgment — check `final_notes` and `critique_log` on the row).

## 6. Image generation — one gap to fill
`process-article.js` calls the Art Director for a brief/prompt but does not
call an image model. Wire your image generation call into the `text_approved`
case (where `image_brief` is created), write the result to `image_url`, then
the pipeline will pick it up automatically at the `image_drafted` stage and
run it through the Photo Critic.

## 7. Your role now
You show up at two points only: `ready_for_review` (final publish/hold/kill
call — this is where you'd wire the Editor-in-Chief prompt in, or make that
call yourself) and `needs_human` (pipeline got stuck or hit a hard fail —
`critique_log` has the full trail of what every agent said).

## 8. Dashboard
`public/index.html` is a static, no-build dashboard served automatically at
your deployment's root URL. Two tabs:

**Gauntlet tab** (the original view):
- **Send an idea to the desk** — instant submit, same as calling
  `/api/submit-idea`. This is your quick-idea path — goes straight into the
  pipeline, no staging.
- **In the gauntlet** — three columns (Food / Sex / Alcohol), every
  non-terminal article. `ready_for_review` cards get Publish / Hold / Kill
  buttons. Click any card for the full draft and critique trail.
- **Archive** — everything published, held, or killed.

**Content Funnel tab** (new):
- **Drop a candidate into the funnel** — adds a row to
  `fsa_content_candidates`, status `pending`. This is the staging area for
  ideas that need a look before they enter the gauntlet — distinct from the
  Gauntlet tab's instant-submit, which skips staging entirely.
- **Pending candidates** — each card has Approve → Gauntlet (creates the
  `fsa_articles` row and starts the pipeline, same as instant-submit) or
  Reject. When a Scout agent exists later, it inserts rows into this same
  table (`source: 'scout'` instead of `'manual'`) — the queue and the approve
  flow don't change, only where the candidates come from.

Auto-refreshes every 30 seconds. No login on this page yet — worth adding
Vercel's Deployment Protection once this is in real use.

## 9. Cron — free, no Vercel Pro needed
Vercel's Hobby plan only allows built-in cron jobs that run once a day —
too slow here. Instead, `.github/workflows/process-article.yml` runs it via
GitHub Actions on a free 5-minute schedule:

1. Put this repo (or just this one workflow file) in any GitHub repo you
   control — doesn't need to be the app's own code repo.
2. In that repo: Settings → Secrets and variables → Actions → New repository
   secret, name `FSA_APP_URL`, value = your deployed Vercel URL.
3. Push. Check the repo's Actions tab to confirm the workflow's enabled and
   the schedule shows up — you can also trigger it manually from there to
   test immediately rather than waiting for the next tick.

If you upgrade to Vercel Pro later, you can switch back to native Vercel
Cron instead — just re-add the `crons` block to `vercel.json`.
