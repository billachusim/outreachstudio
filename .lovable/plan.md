## Problem

Two rules are choking sends today:

1. **Job-hunt reservation.** Daily budget is split 60 outreach / 25 job-hunt / 15 flex. We never actually email for jobs (you apply manually), so 25–40 emails/day are sitting unused.
2. **Top-3 priority gate.** When more than 3 outreach campaigns are active, anything outside today's top 3 (by intel score) gets paused with "Lower priority than today's top 3 campaigns. Resumes tomorrow." With many intel-spawned campaigns, most get frozen.

Together that's why no email went out today.

## What changes

### 1. All 100 emails/day go to outreach

- `email_budgets`: `outreach_cap = 100`, `jobhunt_cap = 0` for every user, every day.
- `_shared/email-budget.ts`:
  - Remove the bucket split. `checkBudget` only enforces the global 100/day ceiling against `outreach_sent`.
  - If a `job_hunt` campaign somehow tries to send, return `ok: false` with reason "job-hunt sending is disabled" (defense-in-depth — no job campaigns should be auto-sending).
- `allocate-email-budget`:
  - Drop the intel-vs-jobpost signal comparison and the flex math entirely.
  - Each morning just upsert `outreach_cap=100, jobhunt_cap=0` (unless the row has `notes='override'`).
- `daily-briefing` still calls `allocate-email-budget` once a morning — no change there.

### 2. Share the 100 across intel-spawned campaigns by ranking

Replace the "top 3 campaigns/day" gate in `campaign-tick` with a per-campaign daily share derived from intel relevance.

For each tick on an outreach campaign:

1. Load all `active` outreach campaigns for the user.
2. For each, look up the max `intel_items.relevance_score` where `spawned_campaign_id = campaign.id`. Manual campaigns (no intel link) get a baseline score of 50.
3. Compute weights: `weight = max(score, 10)` so nothing is zero.
4. `share = max(5, floor(100 * weight / sum_of_weights))` — every active campaign gets at least 5/day so nothing starves; high-ranked intel campaigns get a bigger slice.
5. Cap `share` at the remaining global budget (`100 - outreach_sent_today`) and at the existing per-campaign `effectiveCap` (channel cap).
6. If this campaign has already sent `>= share` today, pause it with "Daily share reached (X/share). Resumes tomorrow." Otherwise proceed to draft/send.

This removes the binary "top-3 only" cliff. Twenty active intel campaigns with similar scores would each get ~5; one dominant high-score campaign would get the lion's share.

### 3. UI copy

`src/pages/Dashboard.tsx` and any budget chip that shows "Outreach 60 · Jobs 25 · Flex 15" → "Outreach 100 · Jobs 0 (manual)". Only relabel; no behavioral changes here.

## Files touched

- `supabase/functions/_shared/email-budget.ts` — collapse to single 100-cap check.
- `supabase/functions/allocate-email-budget/index.ts` — hard-set 100/0.
- `supabase/functions/campaign-tick/index.ts` — replace top-N gate (lines ~573–636) with the per-campaign share calc above.
- `src/pages/Dashboard.tsx` — label-only update if budget chip is shown.
- Migration to backfill today's `email_budgets` rows to `outreach_cap=100, jobhunt_cap=0` so the change takes effect immediately (not just tomorrow).

## Out of scope

- Job board UI and `scan-jobs` keep working as-is — you still see job opportunities.
- No changes to follow-ups, intel ingestion, or the briefing agent.
