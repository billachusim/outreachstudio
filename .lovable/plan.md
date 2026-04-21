

# Fetch Leads — global, context-aware lead discovery (revised)

A new **`✨ Fetch leads`** button on the Leads page that runs one big AI-driven discovery sweep. Reads everything the system knows (memory, offerings, intel, campaigns, region) and pulls fresh raw leads from Firecrawl, biased to your region (Nigeria-first, Africa-wide).

## Efficiency-first limits (revised)

Instead of a flat 100-lead cap, we optimize around **Firecrawl spend** — the actual cost driver. One Firecrawl search returns up to 20 results for a single credit, so **8 well-crafted queries ≈ 8 credits ≈ up to 160 raw candidates**. We keep what we find.

| Knob | Value | Why |
|---|---|---|
| AI-planned search queries | **6–10** (target 8) | Sweet spot for coverage without burning credits |
| Firecrawl results per query | **20** (max) | Same cost as 5 results — no reason to ask for less |
| Concurrent Firecrawl calls | **4** | Respects API rate limits, finishes in ~15s |
| Hard ceiling on inserted leads | **200** | Safety net only — virtually never hit if queries are good |
| Soft target | **~120 raw leads** | What 8 queries naturally yield after dedupe/blocklist |
| Initial enrichment burst | **top 25 candidates** by signal strength | Surfaces 70–90 score leads same run; ~25 cheap scrapes |
| Stop conditions (any one ends the run) | • Hit 200 inserted<br>• All planned queries done<br>• User clicks Stop<br>• Firecrawl returns 402 (out of credits) | Whichever comes first |

**Net cost per Fetch run:** ~8 search credits + up to 25 scrape credits ≈ **~33 Firecrawl credits**. Plus 1 cheap `gemini-2.5-flash` planning call + up to 25 `gemini-2.5-flash-lite` contact-name calls.

**Why this is more efficient than "cap at 100":** Capping inserts means we waste already-paid-for search results. Capping queries instead means we cap *spend*, and keep every lead the spend produced.

## What you'll see

**Leads page** — next to Import CSV / Add lead:

```
[ ✨ Fetch leads ]                     ← idle
[ ⏳ Fetching… 87 found · 19 hot ]      ← live, click for details
```

Click while running → popover with:
- Progress bar (queries done / planned)
- Live counters: queries run, candidates seen, inserted, high-quality (≥50)
- Current search query being executed
- `Stop` button (graceful — finishes current query then exits)

Newly inserted leads stream into the **Raw** tab as they land (Realtime).

**Studio dashboard** — a new **"Lead fetch run"** card above Active runs, only when a run is in-flight or finished within last 24h. Same counters + "View raw leads →" link. Done state shows: *"Fetched 134 raw leads (28 high-quality) · 8 queries · ~33 credits"*.

## How it works (one click → a lot happens)

1. **Gather context** server-side:
   - `profiles.outreach_region` + `outreach_country_code` (Nigeria / ng)
   - All `agent_memories` (slug + title + content snippet)
   - All `offerings` (title, target_audience, problem_solved, ideal_customer, trigger_keywords)
   - Recent high-relevance `intel_items` (last 30d, score ≥40 — title + tags)
   - All `campaigns` (name, category, keywords, city)

2. **AI plans the search** (one `gemini-2.5-flash` call):
   Returns a structured JSON of **6–10 queries** + ICP labels (e.g. *"boutique hotels in Lagos"*, *"fintech startups Nigeria"*, *"D2C fashion West Africa"*). Each query goes through `buildRegionalQuery` + `firecrawlLocationParam`. For Nigeria-region: 60% Nigeria-specific, 30% other African countries (GH/KE/ZA/EG), 10% diaspora.

3. **Run Firecrawl searches in parallel** — 4 concurrent, 20 results each. Background loop keeps going until all queries done or hard ceiling (200) hit.

4. **Filter + dedupe** as results arrive:
   - Drop blocklisted hosts (`HOST_BLOCKLIST`)
   - Drop `.edu`/`.gov`/non-target country TLDs once we have plenty of local
   - Drop existing leads (any campaign or raw) by root domain
   - Stop inserting at 200 (safety net)

5. **Insert as raw leads** (`campaign_id: null`) with notes snippet. Auto-score trigger fires per insert.

6. **Enrichment burst** — top **25 candidates** by initial signal strength (long description, clear business name, target-region TLD) get a single `enrich-lead` call each. This finds emails/phones/socials and pushes those leads to 70–90 scores.

## Real-time progress

New table `lead_fetch_runs`:

```sql
create table public.lead_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  state text not null default 'planning',          -- planning | searching | enriching | done | failed | stopped
  hard_ceiling int not null default 200,
  queries_planned int not null default 0,
  queries_run int not null default 0,
  candidates_seen int not null default 0,
  inserted_count int not null default 0,
  high_quality_count int not null default 0,       -- score ≥50
  enriched_count int not null default 0,
  current_query text,
  credits_estimate int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: own rows only, enabled on supabase_realtime publication
```

Frontend subscribes via Realtime — no polling.

## Files to change

**Backend**
- New edge function `supabase/functions/fetch-leads/index.ts` — context gather → AI plan → Firecrawl loop → insert → enrichment burst → updates `lead_fetch_runs`. Returns immediately after creating the run row; uses `EdgeRuntime.waitUntil` to keep work going in background. Checks `state='stopped'` between queries for graceful cancellation. Catches Firecrawl 402 → state=`failed`, error=`"Firecrawl credits exhausted"`.
- Edit `supabase/functions/_shared/enrichment.ts` — add `buildAfricanRegionalQuery(baseQuery, region)` that, for `ng/ke/gh/za/eg`, expands to multi-country bias.
- New migration: `lead_fetch_runs` table + RLS + add to realtime publication.

**Frontend**
- Edit `src/pages/Leads.tsx` — `Fetch leads` button + live progress popover, Realtime subscription on active `lead_fetch_runs` row, auto-refresh leads on insert events, `Stop` button.
- New `src/components/FetchLeadsProgress.tsx` — progress UI, reused on Leads page and Dashboard.
- Edit `src/pages/Dashboard.tsx` — render `FetchLeadsProgress` card above "Active runs" when an in-flight or recent (last 24h) `lead_fetch_runs` row exists.

## Cost & safety

- **Firecrawl per Fetch run:** ~33 credits (8 searches + 25 scrapes).
- **AI per Fetch run:** 1 cheap planning call + ≤25 micro contact-name calls. Negligible.
- **Hard safety ceiling:** 200 inserted leads. In practice almost never reached after dedupe — natural ceiling is ~120–140.
- **402 handling:** if Firecrawl returns "out of credits", the run halts, state=`failed`, the popover shows a clear "Firecrawl credits exhausted — top up to continue" message.
- **Concurrency guard:** only one in-flight `lead_fetch_runs` per user; button disabled while `state ∈ {planning, searching, enriching}`.
- **Stop button:** sets `state='stopped'`; loop checks before each query batch and exits gracefully (already-inserted leads stay).

