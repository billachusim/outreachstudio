
## Goal
Permanently stop the runaway follow-up cascade and the same-lead repeat-sends, so when we resume, every lead gets at most one initial pitch + at most 3 follow-ups (3/7/14 days), and any reply — including auto-replies — actually halts the chain.

## Root cause (confirmed against your DB)
1. **Recursive follow-up cascade in `resend-webhook`**. On every `email.delivered` event it schedules a new 3-step follow-up chain with `parent_pitch_id = <the pitch that just delivered>`. Follow-ups themselves are new `pitches` rows, they also fire `delivered`, so each one spawns 3 more. The existing dedup (`haveSteps` scoped to `parent_pitch_id`) doesn't catch it because each new parent_pitch_id is unique. Evidence: lead `5a93…` (Covenant University) has 32 sends across 14 days, all subjects `Re: Quick thought on Covenant University's outreach`, from one campaign, all `pitch_sequences` rows carry different `parent_pitch_id`s.
2. **No lead-level rate guard in `follow-up-tick`**. The existing duplicate-recipient guard only blocks the same email address across *different* campaigns/leads. Same-lead piling-up is allowed.
3. **Auto-replies aren't matching, so `lead.status` never leaves `sent`**. `gmail-reply-sync` matches by `In-Reply-To`/`References` → `pitches.message_id_header`, with a fallback to `from` address → `leads.contact_email`. Auto-replies usually come from a *different* sender (`noreply@…`, `mailer-daemon@…`, `postmaster@…`) and many strip threading headers, so neither path fires. The lead stays `sent`, the cascade keeps targeting it.

## What I'll change

### Fix 1 — `supabase/functions/resend-webhook/index.ts`: don't cascade from follow-ups
Only schedule a follow-up chain when the delivered pitch is the **initial** pitch for the lead in that campaign. Implementation: before scheduling, check whether any other sent `pitch_sequences` row already exists for `lead_id` (any parent). If yes → this delivery is itself a follow-up → don't schedule anything more. Also skip scheduling if the lead already has any scheduled or sent sequences for this campaign.

Net effect: one initial pitch → exactly 3 follow-ups, ever. Future `delivered` events for those follow-ups are recorded as `pitch_events` but never schedule more.

### Fix 2 — `supabase/functions/follow-up-tick/index.ts`: hard lead-level guard
Before sending a follow-up:
- If this lead has had **any** outbound (`pitches.sent_at`) in the last 24 hours → skip this sequence row with reason `lead cooldown`.
- If this lead already has `>= 3` total sent follow-ups for this campaign → cancel the remaining sequence rows with reason `max follow-ups reached`.
- Keep the existing skip for `status in ('replied','won','lost')`.

### Fix 3 — `gmail-reply-sync`: match auto-replies that come from a different address
Add a third matching path: if header threading fails AND from-address fallback fails, try matching by Subject. Auto-replies almost always preserve `Re: <original subject>`. Look up the most recent pitch whose `subject` matches the inbound subject minus the `Re:`/`Fwd:` prefixes; if the inbound's `To:` is our outreach mailbox and the subject matches, attribute the reply to that pitch's lead. Only do this within a recent window (e.g. 30 days) to avoid false positives.

Also extend the heuristic for the **lead's contact domain**: if the from address ends with the same domain as `leads.contact_email` (e.g. `noreply@covenantuniversity.edu.ng` ↔ `registrar@covenantuniversity.edu.ng`), accept that as a match.

When matched, behavior stays as today: insert `channel_messages` (inbound), set `lead.status='replied'`, `reply_intent` via `classify-reply`, cancel all scheduled `pitch_sequences` for that lead.

### Fix 4 — Data cleanup
- **Already done by the halt**: all `pitch_sequences` for the looping leads are `cancelled` with reason `global outreach halt`. Nothing is queued. Confirmed in DB.
- Add a one-time backfill query (run via insert tool after migration) to set `lead.status='replied'` and cancel any future sequences for any lead that already has at least one inbound `channel_messages` row but is still `status='sent'`. Stops re-sends to anyone who has historically replied even once.

### Fix 5 — Safety rails I want to add while we're here
- Add a small DB **trigger or unique partial index** to prevent more than one `pitch_sequences` row per `(lead_id, step)` regardless of `parent_pitch_id`. This makes the recursion structurally impossible going forward.
- Keep cron jobs (`campaign-tick`, `follow-up-tick`, `auto-launch-top-triggers`) **off**. We only turn them back on after you've reviewed and approved.

## What this means operationally
When you next resume:
- Any lead currently `replied` / `won` / `lost` is untouched (already the rule).
- Any lead with a prior inbound message gets marked replied by the cleanup → untouched.
- For a brand-new lead: 1 initial + at most 3 follow-ups (day 3, 7, 14). Total emails per lead, cap. No more daily repeats.
- An auto-reply from any address on the lead's own domain, or with `Re: <our subject>`, will now halt the chain.

## On the forwarder (your manual step)
I can't add `outreach@techfaculty.ng → thetechfaculty@gmail.com` from here — that's configured at the DNS / email host where the MX records for `techfaculty.ng` are managed (your registrar, or Cloudflare Email Routing, or Google Workspace Admin, etc.). Tell me which host you use and I'll give you the exact click-path; or paste a screenshot of your DNS / email-routing panel and I'll point at the field.

## Files touched
- `supabase/functions/resend-webhook/index.ts` — guard against cascading.
- `supabase/functions/follow-up-tick/index.ts` — per-lead cooldown + max-follow-ups guard.
- `supabase/functions/gmail-reply-sync/index.ts` — subject-match + same-domain match for auto-replies.
- `supabase/migrations/<new>.sql` — unique partial index on `pitch_sequences(lead_id, step)`.
- One-off data cleanup via insert tool (mark already-replied leads).

## Out of scope (intentionally not touching)
- Resend connector, sending domain, Message-ID format.
- The reply-flow change we just shipped (no Reply-To).
- Campaign/run state — stays paused. We do not auto-resume.
