
User wants to start Phase 2 + 3 from the original roadmap:
- Phase 2: Google Places lead search, Firecrawl enrichment
- Phase 3: AI pitch drafting

They said "decide" — so I pick the order. Best build order:
1. AI pitch drafting first (uses existing offerings + manual leads, no external keys, instant value via Lovable AI)
2. Firecrawl enrichment (connector, no manual key — auto-fills lead email/summary from website)
3. Google Places lead search (needs user's Google API key — defer the key request until last)

This sequencing means user gets value immediately, and we only block on a user-provided key at the very end.

Check what exists: pitches table already exists (lead_id, subject, body, sent_at). Good. Firecrawl is a connector. Google Places needs a Maps API key from user.

Keep plan tight.

# Phase 2 + 3 — Build order

I'll build in this order so each step delivers value before needing the next dependency:

## Step 1 — AI pitch drafting (no setup needed)
Uses Lovable AI (built-in, no key required).

- New **"Draft pitch"** button on each lead row + lead detail drawer
- Edge function `draft-pitch`: takes lead + its campaign's offering, returns subject + body using `google/gemini-2.5-flash`
- Editable preview modal → save to `pitches` table → lead status auto-moves to `drafted`
- New **Pitches** view per lead showing draft history
- Templates page wired up: pick a template as a tone/style hint for the AI

## Step 2 — Firecrawl enrichment (one-click connect)
Uses the Firecrawl connector — you click "Connect" once, no key to paste.

- New **"Enrich"** button on lead rows (and bulk-enrich on the leads table)
- Edge function `enrich-lead`: scrapes `lead.website` for contact email, business summary, services
- Auto-populates `contact_email`, appends summary to `notes`, status → `enriched`
- Pitch drafting in Step 1 will then use the scraped summary for sharper, personalized copy

## Step 3 — Google Places lead search (needs your API key)
Find businesses by city + category and import as leads.

- New **"Find leads"** action on a campaign → form: city, category, keywords, radius
- Edge function `search-places`: calls Google Places Text Search, returns business name, website, phone, address
- Preview list with checkboxes → "Import selected" creates leads tied to the campaign
- **Requires:** a Google Maps API key with Places API enabled (I'll request it when we get to this step — instructions included)

## What I won't touch yet
- Resend sending, Inbox, daily send cap → next phase after these three are working

## Files I'll add/edit
- `supabase/functions/draft-pitch/index.ts`, `enrich-lead/index.ts`, `search-places/index.ts`
- `src/pages/Leads.tsx` — Draft / Enrich actions, pitch drawer
- `src/pages/Campaigns.tsx` — Find leads action
- `src/pages/Templates.tsx` — full CRUD (currently a stub)
- Small `src/lib/ai.ts` helper for invoking edge functions

Approve and I'll start with Step 1 (AI drafting) so you can test it immediately.
