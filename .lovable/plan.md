# Credit-burn audit & reduction plan

## What's running today

13 active cron jobs (all hitting AI gateway + Firecrawl in various ways):

| Job | Schedule | AI calls per run | Firecrawl per run | Notes |
|---|---|---|---|---|
| campaign-tick | every 2 min | 1 per due lead × users | none | Heaviest tick — runs 720×/day even when nothing is due |
| follow-up-tick | every 10 min | up to 5 (1 per due seq) | none | 144×/day |
| gmail-reply-sync | every 10 min | 1 per new reply (classify-reply) | none | 144×/day; AI only on new mail |
| scan-jobs | every 3 hours | ~1 per source (flash-lite) | 1 scrape per source | **8×/day** — biggest scheduled spend |
| scan-intel | daily 6am | ~1 per 20 articles (flash-lite) | 3 defaults + user sources | OK |
| auto-launch-top-triggers | daily 6am | varies (drafts pitches) | none | Can fan out many drafts |
| draft-social-from-intel | daily 5:30am | 1 per top intel item (flash) | none | OK |
| **daily-briefing-8am-wat** | daily 7am | 1 (flash-lite) | none | **Duplicate of next row** |
| **daily-briefing-morning** | daily 7am | 1 (flash-lite) | none | **Same function, same time — runs twice** |
| daily-journal-nightly | daily 9:30pm | 1 | none | OK |
| cleanup-intel | daily 4am | 0 | none | Free |
| score-leads-nightly | daily 2am | 0 (DB only) | none | Free |
| weekly-intel-digest | weekly Sun 5pm | small | none | OK |

Models in use: mostly `gemini-2.5-flash` and `gemini-2.5-flash-lite` (cheap). Only `tailor-cv` and `apply-assistant` use `gemini-2.5-pro` — those are user-triggered, not cron.

## Where the burn actually comes from

1. **Duplicate daily-briefing cron** — same function fires twice every morning. Pure waste.
2. **scan-jobs every 3 hours** — job boards don't change that fast; 8 Firecrawl scrapes per source per day is the largest scheduled Firecrawl cost.
3. **campaign-tick every 2 minutes** — fine when you're actively running campaigns, wasteful when idle (still queries DB 720×/day; emits 0 AI calls when nothing's due, so cost is low but it's the noisiest job).
4. **No "is this user active?" gate** on daily jobs — they run for every user with offerings even if you haven't opened the app in weeks.
5. **scan-intel + auto-launch-top-triggers + draft-social-from-intel** all fire on the same morning window and can fan out many AI drafts per user per day.

## Proposed changes (cron only — no app behavior change unless noted)

1. **Remove the duplicate** `daily-briefing-8am-wat` (keep `daily-briefing-morning`). −50% briefing cost immediately.
2. **scan-jobs: every 3h → every 12h** (e.g. `0 6,18 * * *`). Cuts Firecrawl scrape volume by 4×. Manual "Scan now" button stays available in the Jobs page.
3. **campaign-tick: every 2 min → every 5 min**. Worst case: 3 extra minutes of delay before an email goes out. Cuts cron invocations by 60%.
4. **follow-up-tick: every 10 min → every 30 min**. Follow-ups are not time-critical to the minute.
5. **Add an "active user" gate** to `scan-intel`, `auto-launch-top-triggers`, `draft-social-from-intel`, `daily-briefing`, `daily-journal`, `weekly-intel-digest`: skip any user with no app activity (no `run_events`, no `pitches`, no logged-in session) in the last 14 days. One-line query at the top of each loop.
6. **Cap fan-out on auto-launch-top-triggers**: hard limit to top N=3 triggers per user per day (currently unbounded), so a noisy intel day can't draft 20 pitches in one go.

Optional (ask before doing):
- Disable `auto-launch-top-triggers` entirely and require manual launch from the Intel page. Biggest single saver if you don't want auto-drafting at all.
- Switch `draft-social-from-intel` and `draft-pitch-from-intel` from `flash` → `flash-lite` (good enough for short drafts; ~5× cheaper per call).

## Files touched

- New migration: `cron.unschedule('daily-briefing-8am-wat')` + reschedule `scan-jobs-every-3h`, `campaign-tick-every-2min`, `follow-up-tick-every-10min` with new names + cadences.
- `supabase/functions/scan-intel/index.ts`, `auto-launch-top-triggers/index.ts`, `draft-social-from-intel/index.ts`, `daily-briefing/index.ts`, `daily-journal/index.ts`, `weekly-intel-digest/index.ts` — add active-user gate helper.
- `supabase/functions/auto-launch-top-triggers/index.ts` — add `LIMIT 3` cap.

## Out of scope

- Per-user budget UI (you already have `email_budgets`; AI-credit budget is a bigger feature).
- Changing on-demand functions (`tailor-cv`, `apply-assistant`, `draft-application`) — those only run when you click a button.

Want me to also flip the two optional items (kill `auto-launch-top-triggers`, downgrade draft models to flash-lite)?
