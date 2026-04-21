

# Auto-launch campaigns from the daily Top 3 Triggers

Make the dashboard's Top 3 trigger cards *automatically* launch outreach campaigns the moment the daily intel scan finds them — so you wake up to running campaigns instead of buttons to press. Once a trigger has spawned a campaign, its card switches from "🚀 Launch" to "📊 View campaign" linking to the run.

## What changes (UX)

**On the dashboard "Today's top triggers" widget:**
- Each item now shows a state:
  - **Auto-launched** (badge) → primary button becomes `📊 View campaign` → navigates to `/campaigns` (with the campaign highlighted) so you can watch lead discovery + sending live.
  - **Pending / failed to auto-launch** → keeps the existing `🚀 Launch` button (manual fallback).
- A small subtitle under the card explains: *"Auto-launched 7:42 AM — 0/20 leads found"* (live count from the run).
- The widget pulls the same Top 3 it always did (highest `relevance_score`, not `acted_on`), but now the auto-launch flag means most of the time they'll already be running.

**Studio dashboard "Active runs":**
- Auto-launched runs already show up here automatically (they're regular `campaign_runs` rows). To make them recognizable, we'll prefix the campaign name with `Auto: ` (matches your existing convention from `startOutreachFromOffering`) and show a small `from intel` badge next to the campaign name.

## How it works (under the hood)

### 1. New edge function: `auto-launch-top-triggers`

Server-side cron job that, for each user:
1. Picks the top 3 unacted-on `intel_items` from the last 24h, ranked by `relevance_score` (skip anything below 60 to avoid junk).
2. For each one, calls the **existing** `launch-campaign-from-intel` logic (refactored into a shared helper) with `dryRun: false` — same AI proposal → offering match/create → campaign + queued run → kick `campaign-tick`.
3. Marks the intel `acted_on = true` (the existing function already does this) and stores the resulting `campaign_id` in a new column so the dashboard widget can render the "View campaign" button.
4. Logs each launch to `run_events` with kind `auto_launched_from_intel`.

Failures are isolated: if one trigger's launch fails (AI couldn't match an offering, etc.), the other two still run, and the failed one falls back to the manual `🚀 Launch` button.

### 2. Tiny refactor of `launch-campaign-from-intel`

Extract the "execute the launch" branch into an exported `runLaunch(supabase, userId, intelItemId, proposal?)` helper so the cron function can call it directly without a second HTTP hop. The HTTP entrypoint stays unchanged — the existing manual button keeps working.

### 3. Schema: one new column on `intel_items`

```
intel_items.spawned_campaign_id uuid null
```

Set when a launch (auto or manual) succeeds. Drives the "View campaign" CTA on the widget.

### 4. Cron schedule

A new pg_cron job runs `auto-launch-top-triggers` once a day at **08:05 WAT** — 5 minutes after the existing daily-briefing tick, ensuring fresh intel from the morning scan is already in the table. (We'll add this via the schedule pattern using the project anon key + service role auth.)

### 5. Wire-up: `TopTriggersWidget.tsx`

- Query also selects `spawned_campaign_id`.
- If set → render `📊 View campaign` button linking to `/campaigns?highlight={id}` (Campaigns page already lists all campaigns; the highlight param can scroll to it — minor add).
- If not set → keep current `🚀 Launch` / `Pitch` / `Post` buttons as fallback.
- Live progress subtitle joins `campaign_runs` (latest run for that campaign) to show `leads_sent / target_lead_count`.

### 6. Wire-up: `Dashboard.tsx` → Active runs

- When loading campaigns, also fetch the campaign name's `auto_from_intel` flag (we'll know via the `Auto: ` name prefix, or cleaner: a new boolean column on `campaigns`. Simpler path: prefix the name and show a `from intel` badge based on prefix match — no schema change). Going with the prefix approach to keep this small.

## Cost & safety

- **AI cost:** 1 Gemini Flash call per top-trigger per day = 3 calls/day max per user. Negligible.
- **Outreach cost:** Each auto-launched run respects your global `email_cap = 20` and `target_lead_count = 20`. Three triggers = up to 60 leads/day discovered, 60 emails/day max — same as if you launched them manually.
- **Safety net:** The cron only runs once daily and only on items not yet acted on. New offerings invented by the AI are saved as `status: 'draft'` (per the prior approved decision). You can pause/end any auto-launched run from the dashboard with the bin icon, same as a manual run.
- **No surprise spam:** If the AI can't pick or invent a sensible offering for a story (returns 422), nothing is created — the trigger stays in the widget for you to handle manually.

## Files

- **New** `supabase/functions/auto-launch-top-triggers/index.ts` — cron orchestrator, loops users → top 3 intel → calls shared helper.
- **Edit** `supabase/functions/launch-campaign-from-intel/index.ts` — extract shared `runLaunch()` helper + write `spawned_campaign_id` after success.
- **New migration** — add `intel_items.spawned_campaign_id uuid` column.
- **New cron migration** (data, via insert tool) — schedule `auto-launch-top-triggers` daily at 08:05 WAT.
- **Edit** `src/components/TopTriggersWidget.tsx` — render "View campaign" CTA when `spawned_campaign_id` is set; show live progress subtitle.
- **Edit** `src/pages/Dashboard.tsx` — small "from intel" badge on auto-launched active runs (detected via `Auto:` name prefix).

## Open question

Should the auto-launch run on **all unacted-on intel from the last 24h** (current plan: top 3 by score, min 60), or also **catch up on yesterday's untouched high-scoring items** the first time the cron runs each day?

- **A:** Top 3 from last 24h only — clean and predictable. Recommended.
- **B:** Top 3 from last 48h, so anything that arrived overnight after a missed day still gets picked up.

Default if no answer: **A**.

