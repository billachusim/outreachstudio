## What I think of the suggestion

It's a strong fit for Outreach Studio. We already have the downstream pieces — `leads`, `enrich-lead`, `draft-pitch`, intel → campaign flow, daily briefing. What's missing is a **buyer-intent signal at the top of the funnel**. Apify gives us exactly that: businesses *currently spending money on ads* are far warmer than businesses pulled from a generic Firecrawl search. The last section (the AI lead-gen agent loop) maps almost 1:1 onto what we already run nightly — we just need a new discovery source and a personalization hook.

## What we'll integrate

### 1. New secret + shared client
- Request `APIFY_API_TOKEN` via `add_secret`.
- New `supabase/functions/_shared/apify.ts` — thin wrapper that runs an actor synchronously (`run-sync-get-dataset-items`) with timeout + error normalization. Used by all callers below.

### 2. Apify as an intel source (`kind: 'ad_signal'`)
Extend the existing `intel_sources` table (no schema change — `kind` is already free-text) with three new built-in / addable sources:

- **Meta Ads Library** — actor `apify/facebook-ads-scraper`. Config: `keyword`, `country`. Output: ads with page name, landing page, CTA, copy, start date.
- **Google Ads Transparency** — actor `apify/google-ads-transparency-scraper`. Config: `keyword` or `domain`.
- **Google Maps** — actor `compass/crawler-google-places`. Config: `category`, `city`. Used as a base list (no ad signal, but feeds enrichment).

`scan-intel` (cron) gets an `ad_signal` branch that:
1. For each enabled ad_signal source, runs the actor with the user's offering keywords + region.
2. Dedupes by root domain against `leads.root_domain` and existing intel.
3. Inserts an `intel_items` row per advertiser with `kind='ad_signal'`, summary = ad copy, `meta` = { platform, ad_url, landing_page, cta, started_at, country }.
4. Auto-creates a `leads` row (status `new`) with website = landing_page, business_name = page name, notes = "Active on {platform} since {date}".

### 3. Apify as a campaign discovery mode
New option in `discover-leads` (and the "Add leads" UI in `Campaigns.tsx`):

- **Source dropdown**: `Web search (current)` | `Meta Ads advertisers` | `Google Ads advertisers` | `Google Maps`.
- When an Apify source is picked, `discover-leads` routes to the Apify wrapper instead of Firecrawl search, reusing the same dedupe/insert path. Same `limit`, same blocklist.

### 4. Ad-aware pitch personalization
- Add `ad_context jsonb` column to `leads` (platform, ad_copy snippet, landing_page, cta, started_at).
- Populate it when a lead is created from an ad_signal intel item OR from the Apify discovery source.
- `draft-pitch` reads `ad_context` and, when present, prepends a personalization block to the prompt:
  > "This prospect is actively running ads on {platform}. Recent ad copy: \"{ad_copy}\". Open with a one-line reference to this — natural, not creepy."
- `enrich-lead` already pulls website data; we add a tiny step that, if `ad_context.landing_page` exists, scrapes that specific page (Firecrawl) to give the pitch more substance.

### 5. UI surface
- **Intel Sources page** (`/intel/sources`): re-enable the "Kind" dropdown to include `ad_signal` (Meta Ads / Google Ads / Maps). Each row gets a small badge.
- **Campaigns page**: "Add leads" dialog gets the source dropdown described in §3.
- **Lead Detail Drawer**: when `ad_context` is present, show an "Active advertiser" pill + collapsible card with the ad copy, platform, landing page link, and start date.
- **Dashboard**: extend the existing top-triggers widget to show "X new ad-active prospects today".

### 6. Studio agent tools
Add three tools to `studio-agent`:
- `find_ad_active_leads({ keyword, country, platform, limit })`
- `summarize_competitor_ads({ keyword, platform })` — read-only research
- `add_ad_source({ platform, keyword })` — creates an intel_source

## Technical details

- **Apify call pattern**: `POST https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token=$APIFY_API_TOKEN&timeout=120` — returns the dataset rows directly, no polling. Falls back to async start + poll only if a run exceeds 120s.
- **Cost guardrails**: cap each scan at `limit=25` results, run ad_signal sources at most **once per 24h per source** (reuse the existing `last_scanned_at` check in `scan-intel`), and gate behind the `isActiveUser` helper so dormant accounts don't burn credits.
- **Dedup**: existing `leads.root_domain` unique key + `intel_items` `(user_id, source_url)` covers cross-source duplicates.
- **Schema changes** (one migration):
  - `ALTER TABLE leads ADD COLUMN ad_context jsonb;`
  - Index: `CREATE INDEX idx_leads_ad_context ON leads ((ad_context->>'platform')) WHERE ad_context IS NOT NULL;`
  - No new tables needed — `intel_sources.kind` and `intel_items.kind` are already free-text.
- **Files touched**:
  - new: `supabase/functions/_shared/apify.ts`
  - edit: `supabase/functions/scan-intel/index.ts`, `discover-leads/index.ts`, `enrich-lead/index.ts`, `draft-pitch/index.ts`, `studio-agent/index.ts`
  - edit: `src/pages/IntelSources.tsx`, `src/pages/Campaigns.tsx`, `src/components/LeadDetailDrawer.tsx`, `src/components/TopTriggersWidget.tsx`

## Out of scope (for this pass)

- Apollo / Clay / HubSpot integrations (we have our own CRM-ish surface).
- LinkedIn scraping beyond what `enrich-lead` already does — LinkedIn actors are higher-risk/cost; revisit once ad-signal flow proves itself.
- Spend/reach estimates from Meta — only surfaced when the actor returns them; no estimation on our side.

## Rollout order

1. Migration + `APIFY_API_TOKEN` secret.
2. Shared Apify client + Meta Ads scanner wired into `scan-intel` (smallest end-to-end slice).
3. Lead `ad_context` + `draft-pitch` personalization.
4. Google Ads Transparency + Google Maps actors.
5. Campaign "Add leads from Apify" UI.
6. Agent tools + dashboard surfacing.