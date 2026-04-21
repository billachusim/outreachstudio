

# Adjust send limits: 50/campaign, 300/day total

Right now everything defaults to `20`. We'll bump per-campaign caps to **50** and add a **global 300 emails/day** ceiling that no single campaign can punch through, regardless of its own cap.

## What changes (UX)

**Campaigns page** — defaults shown as `50` for Email/day and WApp/day (Social/day stays `10`). Existing campaigns sitting at 20 get bumped to 50.

**Studio dashboard / active runs** — unchanged visually, but each run now respects both its own cap (50) and the global daily ceiling (300). When the global ceiling hits, the run pauses with the message *"Global daily cap reached (300/300). Resumes tomorrow."*

**No new UI controls** for the global cap — it's a workspace constant for now (300), exactly like `DEFAULT_DAILY_CAP` is today.

## Numbers, in one place

| Setting | Old | New |
|---|---|---|
| Per-campaign `email_cap` default | 20 | **50** |
| Per-campaign `whatsapp_cap` default | 20 | **50** |
| Per-campaign `social_cap` default | 10 | 10 (unchanged) |
| `campaign_runs.daily_send_cap` default | 50 (DB) / 20 (code) | **50** everywhere |
| `campaign_runs.target_lead_count` default | 20 | **50** (so a run can actually reach its 50/day cap) |
| **NEW:** Global daily email ceiling | — | **300/user/day** |
| `send-pitch` `DEFAULT_DAILY_CAP` (manual sends) | 20 | **300** (global ceiling) |

## Files to change

### 1. `supabase/functions/campaign-tick/index.ts` — enforce global cap

In the `sending` branch (around line 475), the existing `sentToday` count already covers ALL pitches for the user across campaigns. Add a second check before the per-campaign one:

```ts
const GLOBAL_DAILY_CAP = 300;
if ((sentToday ?? 0) >= GLOBAL_DAILY_CAP) {
  await logEvent("info", `Global daily cap reached (${sentToday}/${GLOBAL_DAILY_CAP}). Pausing for today.`);
  await updateRun({ state: "paused", error: "Global daily cap reached" });
  return json(200, { ok: true, paused: true });
}
// then existing per-channel cap check stays
```

This is the key safety net — even if you spin up 10 campaigns each with `email_cap: 50`, the user-level total stops at 300.

### 2. `supabase/functions/send-pitch/index.ts`
- `DEFAULT_DAILY_CAP = 300` (manual one-off sends share the same global ceiling).

### 3. `supabase/functions/_shared/launch.ts` (auto-launched campaigns)
- `email_cap: 50` (was 20)
- `target_lead_count: 50` (was 20)
- `daily_send_cap: 50` (was 20)

### 4. `src/lib/startOutreach.ts`
- `targetLeadCount` fallback → `50`
- `dailySendCap` fallback → `50`

### 5. `src/pages/Campaigns.tsx`
- `email_cap ?? 20` → `?? 50`
- `whatsapp_cap ?? 20` → `?? 50`
- (`social_cap ?? 10` stays)

### 6. Database migration (schema defaults)
```sql
ALTER TABLE public.campaigns ALTER COLUMN email_cap SET DEFAULT 50;
ALTER TABLE public.campaigns ALTER COLUMN whatsapp_cap SET DEFAULT 50;
ALTER TABLE public.campaign_runs ALTER COLUMN target_lead_count SET DEFAULT 50;
-- daily_send_cap default is already 50, leave it
```

### 7. Data backfill (existing rows currently at 20)
```sql
UPDATE public.campaigns SET email_cap = 50 WHERE email_cap = 20;
UPDATE public.campaigns SET whatsapp_cap = 50 WHERE whatsapp_cap = 20;
UPDATE public.campaign_runs SET daily_send_cap = 50 WHERE daily_send_cap = 20;
UPDATE public.campaign_runs SET target_lead_count = 50 WHERE target_lead_count = 20 AND state IN ('queued','discovering','enriching','drafting','sending');
```

## Behaviour after this lands

- Each campaign sends up to **50 emails/day**.
- Across all your campaigns combined, you'll never exceed **300 emails/day** — the next tick after 300 pauses any further runs until tomorrow's cron resets.
- Auto-launched campaigns from intel triggers also use 50 (so 3 daily triggers × 50 = 150, well within 300, leaving headroom for manual campaigns).
- Tomorrow at 00:00 user-time the `sentToday` count resets naturally and paused runs get resumed by the next `campaign-tick`.

