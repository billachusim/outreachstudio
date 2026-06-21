## How matches are currently found

`supabase/functions/scan-jobs/index.ts` runs Firecrawl JSON extraction against:

1. Two hard-coded defaults: **Remote OK** and **We Work Remotely**.
2. Your `intel_sources` rows where `kind = 'job_board'` AND `enabled = true`.

Each extracted posting is scored by Lovable AI against your freelance profile + offering, then upserted into `job_posts` with a `source` column already holding the board's name. Rows scoring ≥ 60 also get mirrored into `leads` under the `job_hunt` campaign.

## Why you don't see jobs from MicroOne / Macro etc.

Two likely reasons, both fixable:

1. **They were added as `talent_marketplace`, not `job_board`.** The scanner's query (`scan-jobs/index.ts` line 104) filters `kind = 'job_board'`, so marketplace sources are silently skipped.
2. **Login-walled listing pages.** Firecrawl scrapes anonymously. Marketplaces that require an account return a login page → 0 extracted jobs. We have no per-source diagnostic surfaced today, so it looks like "nothing happened".

## What I'll change (UI + scanner, no auto-apply work)

### 1. Show the source on every match
`JobMatchesList.tsx`: add a small **source badge** next to the title (uses the existing `source` column) and a **Source filter dropdown** alongside the search / min-score / status filters. Source list is derived from the loaded posts. The hostname link stays — it's the actual posting URL, separate from the board name.

### 2. Let custom marketplace sources actually run
`scan-jobs/index.ts`: change the source query to include `kind IN ('job_board', 'talent_marketplace')` so MicroOne / Macro / etc. are scraped on the next run. Each posting keeps the source name you typed when adding it, so they'll show up in the new filter.

### 3. Per-source scan diagnostics
In `scan-jobs/index.ts`, log per-source `{ name, fetched, kept_new }` to `run_events` (already used elsewhere in the project) and surface a tiny **"Last scan"** summary under each row in `JobSourcesPanel.tsx`:

```text
MicroOne — 0 jobs found (likely requires login)
Macro     — 12 jobs found, 3 new
```

That makes it obvious which sources are productive vs login-walled, so you know which to keep and which to drop, and you can match the badge on the Matches tab to the account you already have on that site.

### Out of scope (per your message)
- No auto-apply / form-filling work. The existing Apply Kit stays as the copy-paste workflow.

## Files touched

- `src/components/jobs/JobMatchesList.tsx` — source badge + source filter
- `src/components/jobs/JobSourcesPanel.tsx` — per-source last-scan summary
- `supabase/functions/scan-jobs/index.ts` — include `talent_marketplace`, write per-source `run_events`
- (no schema change; `source` and `run_events` already exist)
