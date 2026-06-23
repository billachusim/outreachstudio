# Inbox "(deleted lead)" fix

## Root cause

In `src/pages/Inbox.tsx`, threads are built from `pitches`, `pitch_events`, and `channel_messages`, then each thread's lead is looked up in a map populated by:

```ts
supabase.from("leads").select("id,business_name,contact_email,phone,status,reply_intent,score,last_activity_at")
```

That query has no `.limit()`, and PostgREST caps responses at **1000 rows by default**. Your account has **8,676 leads** but only **~358 distinct leads** appear in pitches and ~16 in messages. The 1000-row cap is applied in lead-table order (effectively most-recent or arbitrary), so any thread whose lead isn't in that first 1000-row page renders as `(deleted lead)` even though the lead still exists.

Database check confirms **zero orphaned rows** across `pitches`, `pitch_events`, and `channel_messages` — no leads were actually deleted. `pitches.lead_id` is also `ON DELETE CASCADE`, so a real deletion would remove the pitch entirely, not leave a dangling reference.

## Fix

Stop fetching the entire leads table. Instead, after collecting `lead_id`s referenced by the loaded pitches / events / messages, fetch just those leads by id:

1. Run the three activity queries first (`pitches`, `pitch_events`, `channel_messages`) as today.
2. Collect the distinct `lead_id`s referenced across all three result sets.
3. Fetch leads with `.in("id", ids)` — chunked into batches of 500 ids to stay under URL-length limits — instead of selecting the whole table.
4. Build `leadsMap` from the chunked results and proceed unchanged.

This makes the lookup correct regardless of how many total leads the user has, and is also cheaper (we no longer pull thousands of rows we don't render).

## Scope

- Edit only `src/pages/Inbox.tsx` (the `load` function).
- No schema changes, no edge function changes, no behavior change for users beyond the names appearing correctly.
- Leaves the existing realtime subscriptions and filtering logic untouched.
