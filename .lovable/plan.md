

# ✨ Work leads — bulk enrichment only

Scoped down per your call: the button **only enriches**. Drafting and sending stay with campaigns, which already pick eligible leads and reuse them across different campaigns.

## Where it lives

A new **`✨ Work leads`** button + batch-size picker in the Leads page header, next to `✨ Fetch leads`.

```
[ ✨ Fetch leads ] [ ✨ Work leads  ▾ ] [ Import CSV ] [ + Add lead ]
                          │
                          └─ Batch: 50 ▾
                             Need enrichment in view: 184
                             [ Start ]
```

Popover contents:
- **Batch size**: `25 · 50 · 100 · 200 · 500` (default 50).
- **Live counter**: how many leads in the current filtered view actually need enrichment.
- **Start** button (disabled if counter is 0 or a job is already running).

If leads are selected, the worker uses the selection (still capped to batch size). Otherwise it picks the first N leads from the current filter that need enrichment.

## What "needs enrichment" means

A lead is enrichable when **all** are true:
- Has a `website` (otherwise `enrich-lead` returns 400 — nothing to do).
- `last_enriched_at IS NULL` **OR** `contact_email IS NULL` (i.e. never enriched, or enrichment didn't yield contact info worth keeping).
- Status is not `won` / `lost` / `unsubscribed` (don't waste credits on dead leads).

Anything else → skipped (counted, not failed).

## How it runs

Pure client-side orchestration, mirroring the existing `BulkDraftBar` pattern — calls the existing `enrich-lead` edge function once per lead. No new backend, no schema changes.

- Sequential for batches ≤ 50.
- 2 in parallel for batches ≥ 100 (small worker pool — keeps Firecrawl happy).
- One sticky progress strip with live counts:

```
Enriching leads…  ▓▓▓▓▓▓░░░  34 / 50
✓ 28 enriched · ⊘ 4 skipped (no website) · ✗ 2 failed       [ Stop ]
```

- **Stop** cancels gracefully between leads — already-enriched leads stay enriched.
- Final summary toast: *"Enriched 28 leads · 4 skipped · 2 failed."*
- Re-pressing while running is disabled.

## Header counter (small UX win)

Add one chip to the existing counter line so you can see at a glance whether the button will do anything:

> 312 leads · 18 hot · 47 ready · **184 need enrichment** · 22 raw

## Files to change

**Frontend only — no backend, no DB**
- New: `src/components/WorkLeadsButton.tsx` — button, popover, router (just enrichment), progress strip, calls `enrich-lead` edge fn (already exists).
- Edit: `src/pages/Leads.tsx`
  - Render `<WorkLeadsButton leads={filtered} selectedIds={...} onComplete={load} />` in the header next to `Fetch leads`.
  - Extend the existing `counters` `useMemo` to compute `needsEnrichment` (website present + (`last_enriched_at` null OR no email) + not won/lost/unsubscribed).

## Edge cases handled

- **No website** → skipped, not failed. Counter explains it.
- **`enrich-lead` returns "no email found"** → still counts as enriched success (Firecrawl ran, summary saved); it just won't become a campaign target until you give it an email another way.
- **Firecrawl rate limit / 402 credits** → that lead counts as failed; loop continues; final toast surfaces failure count.
- **Filter/tab changed mid-run** → batch IDs locked at start, finishes the chosen N.
- **Lead already fully enriched (has email + `last_enriched_at`)** → not selected by the counter; if forced via selection, still skipped.

## Why this is the right call

You're right — keeping enrich/draft/send fused on one button risks burning AI credits drafting pitches that the campaign system would have drafted anyway with its own targeting + rotation logic. Splitting them means:
- `Work leads` = cheap prep (Firecrawl scrape + tiny AI summary per lead).
- Campaigns = the orchestrator that picks quality leads, drafts in its tone, and avoids reusing the same lead inside the same campaign.

