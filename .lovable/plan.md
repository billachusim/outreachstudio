

# Squeeze individual leads out of list/blog/aggregator pages

You're right — right now when Firecrawl search returns a page like *"Top 10 Universities in Nigeria"* on TechCabal, the system stores **TechCabal's article URL** as one lead and you end up drafting pitches to the blog instead of to the 10 universities the article actually mentions. We'll detect aggregator pages and **explode each one into the real businesses it lists**.

## What changes

A new step inserted between "Firecrawl search returns hits" and "insert leads":

```
Firecrawl hit
   │
   ├─► Looks like a real business homepage?  ──► insert as ONE lead (today's behaviour)
   │
   └─► Looks like a list / blog / directory? ──► EXPLODE
                                                  │
                                                  ├─ Scrape the article (markdown + links)
                                                  ├─ AI extracts every business mentioned:
                                                  │     [{name, website, why_listed}, …]
                                                  ├─ Validate each website (resolve → root domain)
                                                  └─ Insert each as its own raw lead
                                                     (skip the aggregator URL itself)
```

## How we detect "this is a list/aggregator page"

A hit is treated as an aggregator when **any** of these are true:
- Host is on a known **publisher/listicle host** list (already in our blocklist as outright-skip — we'll move them to a new `LISTICLE_HOSTS` set instead): `techcabal.com`, `techpoint.africa`, `businessday.ng`, `medium.com`, `substack.com`, `forbes.com`, `inc.com`, `entrepreneur.com`, `clutch.co`, `goodfirms.co`, `g2.com`, `producthunt.com`, blog platforms, etc.
- Title matches listicle patterns: `/^(top|best|leading|\d+\s+best|\d+\s+top)\b/i`, contains `"list of"`, `"directory"`, `"companies in"`, `"startups in"`, `"agencies in"`.
- URL path contains `/blog/`, `/articles/`, `/news/`, `/posts/`, `/list/`, `/directory/`.

If matched → explode. If not matched → insert as today.

## Explosion step (new)

For each aggregator hit (capped — see budget below):

1. **Scrape** the page with Firecrawl (`markdown` + `links`, `onlyMainContent: true`) — 1 credit.
2. **AI extract** with `gemini-2.5-flash` (single tool call, structured output):
   ```json
   {
     "businesses": [
       { "name": "University of Lagos", "website": "https://unilag.edu.ng", "snippet": "..." },
       { "name": "Covenant University", "website": "https://covenantuniversity.edu.ng", "snippet": "..." }
     ],
     "is_listicle": true,
     "list_topic": "Top universities in Nigeria"
   }
   ```
   The model gets the scraped markdown + the page's outbound links list (so it can resolve names that lack inline URLs by matching against link anchor text).
3. **Validate & filter** each extracted business:
   - Must have a website (or resolvable name → we'll skip name-only hits to keep quality high).
   - Run through existing `HOST_BLOCKLIST`, `isExcludedTld`, dedupe vs `existingDomains`.
   - Drop entries where the website host equals the aggregator host (self-references).
4. **Insert as raw leads** with notes `"Source: AI fetch — extracted from list "{list_topic}" on {aggregator_host}"`. Each gets the existing autoscore + queues for the enrichment burst.
5. **Aggregator URL itself is NOT inserted** as a lead.

## Cost & safety budget

To keep this efficient (the user has been clear about Firecrawl spend):

| Knob | Value | Why |
|---|---|---|
| Aggregator hits exploded per run | **max 8** | Each costs 1 scrape + 1 cheap AI call ≈ ~8 extra credits per run |
| Businesses extracted per aggregator | **max 15** | Listicles are usually 5–25 items; cap protects against runaway results |
| Aggregator scrape concurrency | **3** | Mirrors search concurrency, finishes fast |
| Selection rule | First 8 aggregator-classified hits in arrival order, **prioritising hits whose title contains region keywords** | Most relevant first |
| Skip explosion when | Total inserted already ≥ `hardCeiling - 20` | Don't burn credits if ceiling is near |

**Net added cost per Fetch run:** up to **~8 scrape credits + 8 cheap AI calls** ≈ negligible. In exchange you get potentially **40–120 real business leads** instead of 8 blog URLs.

## Visible changes for you

- **Lead notes** now show provenance: *"Source: AI fetch — extracted from list 'Top fintech startups Nigeria' on techcabal.com (2024-03)"*. So you can always trace back where a lead came from.
- **Progress panel** gets one more counter: `Exploded N list pages → M businesses` so you can see the multiplier in action.
- **Run summary** ("Why zero leads?" card) now also shows: `Aggregators exploded: 6 · Businesses extracted: 47 · Inserted after dedupe: 31`.
- **`lead_fetch_runs` schema:** add two columns `aggregators_exploded int` and `extracted_businesses int` (additive, defaulted to 0).

## Files to change

**Backend**
- Edit `supabase/functions/fetch-leads/index.ts`:
  - Add `LISTICLE_HOSTS` set + `looksLikeAggregator(hit)` classifier.
  - Split `processBatch`: classify each hit → bucket as `directLeads[]` or `aggregatorHits[]`. Insert direct leads as today; pass aggregators to a new `explodeAggregators()` helper.
  - New `explodeAggregators(hits, ...)`: scrape (concurrency 3) → AI extract (one call per page) → validate → bulk insert child leads. Tracks `aggregators_exploded` + `extracted_businesses`.
  - Update credits estimate to include scrape + AI calls.
  - Update the failure-reason composer to mention extraction stats when zero leads.

**Frontend**
- Edit `src/components/FetchLeadsProgress.tsx`:
  - Show new counters in live progress: *"Exploded 6 list pages → 47 businesses"*.
  - Show in post-run summary card.

**Migration**
- New migration: `ALTER TABLE lead_fetch_runs ADD COLUMN aggregators_exploded int NOT NULL DEFAULT 0, ADD COLUMN extracted_businesses int NOT NULL DEFAULT 0;`
- Regenerate `src/integrations/supabase/types.ts` (auto-handled).

## Edge cases handled

- **AI returns junk websites** (e.g. `example.com`, broken URLs) → URL parsing + TLD/blocklist filter drops them silently.
- **Listicle is paywalled / scrape fails** → log, skip that aggregator, continue with the rest. Doesn't fail the run.
- **Same business appears in multiple lists** → existing `existingDomains` dedupe catches it; only first occurrence inserted.
- **Aggregator host is in the strict outright-block list today** (e.g. `medium.com`) — we'll move *blog/listicle hosts that we want to mine but not pitch to* into `LISTICLE_HOSTS` (allow scrape, never insert as lead). The hard blocklist (`facebook.com`, `google.com`, etc.) stays as today.
- **Hard ceiling still respected** — explosion stops inserting once `hardCeiling` is reached.

