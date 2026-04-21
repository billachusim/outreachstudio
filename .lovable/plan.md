

# Discover & auto-promote intel sources

Two related upgrades to Intel sources, both about turning your real lead-discovery activity into a self-growing list of news/listicle sources.

## Part 1 — "Discover sources" button (manual, AI-powered)

A new button on **Intel → Sources** that asks the AI: *"given everything this user knows and targets, what news sites, blogs, and directories would be richest sources of triggers and lead lists?"* Then it validates each suggestion with Firecrawl and shows them as clickable cards you can add with one click.

**Where:** `src/pages/IntelSources.tsx` — new card *"Discover new sources"* between "Add a custom source" and "Your sources":

```
┌─ Discover new sources ───────────────────────────────────┐
│ Find news sites, blogs and directories that match your    │
│ offerings and region.                  [ ✨ Discover ]    │
│                                                            │
│ ▸ Disrupt Africa  https://disrupt-africa.com/             │
│   Pan-African startup news — matches your fintech ICP     │
│                                            [ + Add ]      │
│ ▸ Ventures Africa  https://venturesafrica.com/             │
│   ...                                       [ + Add ]      │
└────────────────────────────────────────────────────────────┘
```

**Backend** — new edge function `supabase/functions/discover-intel-sources/index.ts`:

1. Gather context (same shape as `fetch-leads` planner): `profiles.outreach_region`, `offerings` (titles, audiences, keywords), `agent_memories`, `campaigns` (categories), and existing `intel_sources` + the built-in `DEFAULT_SOURCES` so we don't suggest dupes.
2. **One AI call** (`gemini-2.5-flash`, structured tool call) — returns 5–8 candidates: `{name, url, why_relevant, type: "news"|"blog"|"directory"|"listicle"}`.
3. **Validate each candidate** — parallel Firecrawl `/v2/map?limit=5` calls (5 cheap credits total). Drops any URL that fails to map. Filters out anything already in user's sources or `DEFAULT_SOURCES`.
4. Returns `{ suggestions: [...] }` to the frontend (does not insert — user decides).

Frontend then offers a one-click `+ Add` per suggestion that inserts into `intel_sources` exactly like the existing manual form. A `Refresh` button re-runs discovery to get a different batch.

**Cost per click:** 1 cheap AI call + up to 8 Firecrawl `/map` calls (≈ 8 credits) — runs once on demand, not on a schedule.

## Part 2 — Auto-promote aggregators that produce quality leads

When `fetch-leads` explodes a listicle/aggregator and that listicle yields **≥3 leads that end up scoring ≥50** (after the enrichment burst), we auto-add the aggregator's host to `intel_sources` so the next nightly `scan-intel` keeps mining it.

### How we track it

New table `aggregator_performance`:

```sql
create table public.aggregator_performance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  host text not null,              -- e.g. "techcabal.com"
  source_url text not null,        -- last seen aggregator page URL (for naming)
  total_extracted int not null default 0,    -- businesses pulled from this host
  total_high_quality int not null default 0, -- of those, how many scored >=50
  promoted_to_intel bool not null default false,
  promoted_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, host)
);
-- RLS: own rows only.
```

### Wiring inside `fetch-leads/index.ts`

In the `explodeAggregators()` helper (after children inserted), upsert a row keyed on `(user_id, host)`:
- `total_extracted` += businesses extracted from this host this run
- `total_high_quality` += inserted leads scoring ≥50 from this host this run
- `last_seen_at = now()`, `source_url = agg.hit.url`

**Then immediately after the enrichment burst** (so scores are settled), one pass:

```sql
-- pseudo
for each row in aggregator_performance
  where user_id = $1 and not promoted_to_intel
    and total_high_quality >= 3
    and host not in (DEFAULT_SOURCES) and host not in (existing intel_sources):
  insert into intel_sources (user_id, name, url, enabled) values
    ($1, <Title-cased host>, 'https://<host>/', true);
  update aggregator_performance set promoted_to_intel = true, promoted_at = now() where id = $row;
  log event "Auto-added intel source: <host> (3+ quality leads from listicles)"
```

### What the user sees

- A new line in the fetch-leads run summary card: *"Promoted 2 new intel sources: techcabal.com, disrupt-africa.com"* (when applicable).
- The new sources appear automatically in **Intel → Sources** under "Your sources" with a small `Auto-promoted` badge so you know how they got there.
- A toast on the Leads page when a run finishes if any promotions happened: *"2 new intel sources auto-added — view"* (link to `/intel/sources`).

## Schema changes

1. New migration: `aggregator_performance` table + RLS (own rows: select/insert/update/delete) + unique index `(user_id, host)`.
2. Add column to `intel_sources`: `auto_promoted bool not null default false` so the UI can show the badge.

## Files to change

**Backend**
- New: `supabase/functions/discover-intel-sources/index.ts` (AI + Firecrawl map validation).
- Edit: `supabase/functions/fetch-leads/index.ts` — track per-host stats during explosion, run promotion check after enrichment, include promoted hosts count in final `update({...})` so frontend sees them.
- Edit: `src/integrations/supabase/types.ts` (auto-regenerated after migration).

**Frontend**
- Edit: `src/pages/IntelSources.tsx` — add "Discover new sources" card, suggestion list with `+ Add` buttons, `Auto-promoted` badge in user sources list.
- Edit: `src/components/FetchLeadsProgress.tsx` — read a new `promoted_sources_count` field from the run row (added to migration) and render it in the post-run summary as *"Promoted N source(s) to Intel."* Also surface a toast → link.

**Migration**
- `aggregator_performance` table.
- `intel_sources.auto_promoted` boolean.
- `lead_fetch_runs.promoted_sources_count int default 0` for surfacing in the run summary.

## Cost & safety

- Discover button: ≤9 credits per click (1 AI + 8 map calls), user-initiated only.
- Auto-promotion: zero extra cost — piggy-backs on the existing fetch-leads run. Only adds 1 small SQL query at the end of each run.
- Promotion threshold (3+ quality leads from one host) prevents one-off accidental promotions.
- Hard guard: never promote hosts in `HOST_BLOCKLIST` (social/search/marketplaces) even if they somehow appear.
- All promoted sources start `enabled = true` but the user can toggle them off in the existing Sources UI.

