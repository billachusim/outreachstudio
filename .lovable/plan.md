# Briefing action agent

## What exists today
The dashboard's daily briefing ends with a "Next actions" paragraph written by `daily-briefing`. Nothing reads it or executes it — it's display-only text.

## What to build
A new daily agent that, at **18:00 WAT**, reads today's briefing, extracts concrete next actions, queues them, and **auto-runs** them. Initial scope: **send queued follow-ups**. The queue + executor are built generically so we can flip on more action types later without rewiring.

## Pieces

### 1. New table `briefing_actions`
Stores extracted actions and their run state.

Columns: `id`, `user_id`, `briefing_id` (fk → daily_briefings), `briefing_date`, `action_type` (text, e.g. `send_followups`), `payload` (jsonb), `status` (`pending`|`running`|`done`|`skipped`|`failed`), `result` (jsonb, function response or error), `scheduled_for` (timestamptz), `started_at`, `finished_at`, `created_at`.

RLS: owner can SELECT/UPDATE/DELETE their own rows; service_role full access. Standard GRANT block for `authenticated` + `service_role`.

Index on `(user_id, briefing_date)` and `(status, scheduled_for)`.

### 2. New edge function `execute-briefing-actions`
One function does both extract + execute (single cron, simplest). Steps per run:

1. Active-user gate (reuse `_shared/active-user.ts`, 14-day window).
2. For each active user, load today's `daily_briefings` row. Skip if none.
3. Skip if a `briefing_actions` row already exists for that `(user_id, briefing_date)` — idempotent.
4. Send `body` + `metrics` to `gemini-2.5-flash-lite` with a strict JSON schema asking it to classify each next-action sentence into one of the supported `action_type` values. Unknown/ambiguous items → dropped.
5. Insert rows into `briefing_actions` with `status='pending'` and `scheduled_for = now()`.
6. Immediately run the executor pass:
   - Select `status='pending' AND scheduled_for <= now()` for this user.
   - For each row, mark `running`, call the matching handler, then write `done`/`failed` + `result`.

Supported handlers (v1):
- `send_followups` → POST to existing `follow-up-tick` function (service-role auth). Records returned counts in `result`.

Future-ready stubs (registered but no-op + status `skipped` with reason):
- `draft_pitch_for_warm_leads`
- `launch_campaign_from_intel`
- `apply_to_top_jobs`

This keeps the table + extractor schema stable when we turn them on.

### 3. Cron
New migration: schedule `execute-briefing-actions` daily at **17:00 UTC** (18:00 WAT) via `pg_cron` + `pg_net` POST, same pattern as the other crons.

### 4. Dashboard surface (small)
Below the daily briefing card, render a "Today's actions" list reading from `briefing_actions` for today: action type, status badge, short result line, timestamp. Read-only — execution is automatic. No new buttons.

## Files

New:
- `supabase/migrations/<ts>_briefing_actions.sql` — table, GRANTs, RLS, indexes, cron schedule
- `supabase/functions/execute-briefing-actions/index.ts`

Edited:
- `src/pages/Dashboard.tsx` — add the Today's actions list under the briefing
- `src/integrations/supabase/types.ts` — regenerated for the new table

## Out of scope (call out for later)
- The other 3 action types stay registered-but-skipped until you say go (they each spend credits or send messages, and you only greenlit follow-ups).
- No per-action approval UI — current mode is fully automatic per your choice.
- No retry/backoff on failed actions beyond logging; next day's run is the retry.
