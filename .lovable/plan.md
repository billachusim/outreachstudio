

# Better leads: Africa-first discovery, real scoring, redesigned page

Three problems to solve in one pass: (1) leads are mostly American because discovery has no geographic anchor, (2) scores stay near zero because `compute_lead_score` is never actually invoked + enrichment finds too little, (3) the leads page is a flat cramped table.

---

## Part 1 — Why you're getting American leads (and the fix)

**Root cause:** When the AI auto-launches a campaign from an intel story it sets `city: null, category: null, keywords: <generic terms>`. `campaign-tick` then sends those bare keywords to Firecrawl search with no geographic bias, so global (mostly US) university/SaaS sites win the SEO lottery. Same problem on the manual Firecrawl path.

**Fix:**
- **Workspace region setting** stored on `profiles.outreach_region` (default: `Nigeria`) and `profiles.outreach_country_code` (default: `ng`). Editable from a small "Region" card on the **Memory** page.
- **Discovery query builder** (`campaign-tick` Firecrawl branch + `discover-leads`):
  - Always append `(in {city or region}) site:.{country_code} OR "{region}"` to the Firecrawl query.
  - Pass Firecrawl's `location` parameter (`{ country: "NG", languages: ["en"] }`) so its search is regionally scoped.
  - After results land, **score-down** any host whose root domain ends in `.edu`, `.gov`, or country TLDs other than the user's region; drop them when there are enough local candidates.
- **AI proposal prompt** (`_shared/launch.ts`) updated: when inventing a campaign from intel, *must* set `city` and `category` (use the user's region as fallback) and bias `keywords` toward the region (e.g. *"Lagos restaurants"* not *"restaurants"*). Also must prefer `discovery_source: "google_places"` for any local-business ICP — Google Places gives us **real Nigerian businesses with phone + address out of the gate**, which directly fixes both quality and score.
- **Backfill suggestion banner** on the Campaigns page: campaigns with `city = null` get a "Set city/region" nudge.

---

## Part 2 — Why scores are stuck at 0–45 (and the fix)

**Root cause #1:** `public.compute_lead_score()` exists but **nothing ever calls it**. Leads keep `score = 0` from insert and only get bumped if some code path explicitly writes to `score`.

**Root cause #2:** Even when called, max realistic score for a fresh Firecrawl lead is ~35 (10 website + 25 email if found) because phone/contact_name aren't extracted and notes rarely exceed 100 chars.

**Fix:**
1. **Auto-score trigger** — DB trigger on `leads` (AFTER INSERT/UPDATE of email/phone/website/contact_name/notes) that calls `compute_lead_score(NEW.id)` and writes back to `score`. Plus a trigger on `pitch_events` (open/reply) that re-scores the related lead.
2. **Score backfill migration** — one-shot `UPDATE leads SET score = compute_lead_score(id)` so existing rows reflect real numbers.
3. **Beefed-up enrichment** (`enrich-lead` + the inline enrichment in `campaign-tick`):
   - Extract **phone numbers** (regex `\+?\d[\d\s().-]{7,}`) from scraped markdown — covers African mobile patterns.
   - Extract **contact name** via a tiny Lovable AI call (`gemini-2.5-flash-lite`) on the scraped page: *"Return the founder/owner/contact person's full name if any, else null."*
   - Pull **social handles** (LinkedIn, Instagram, X, Facebook) from `links` and store them in `notes` as a clean `Socials:` block (and a new column — see schema).
4. **New columns** on `leads` for richer profiles (small additive migration, no breaking change):
   - `linkedin_url text`, `instagram_url text`, `facebook_url text`, `x_url text`
   - `enrichment_summary text` (clean field instead of stuffing notes)
   - `last_enriched_at timestamptz`
5. **Score function update** — extend `compute_lead_score` to add +5 per social handle (cap at +15) and +10 for `enrichment_summary` length > 200. Realistic ceiling becomes ~95 for a well-enriched lead with email + phone + name + 2 socials.

After this, well-enriched Nigerian leads (Google Places + scrape) will land at **70–90**, not 0–45.

---

## Part 3 — Leads page redesign

Replace the flat table with a focused workspace. Reuse existing shadcn primitives — no new deps.

```
┌───────────────────────────────────────────────────────────────────┐
│  Leads                                          [+ Add lead]      │
│  127 leads · 42 hot · 18 ready to send                            │
│                                                                   │
│  [Search name/email/domain…] [Campaign ▼] [Status ▼] [Score ≥ ▼] │
│  [Region: Nigeria] [✦ Hot only] [☐ Has email] [☐ Has phone]      │
│                                                                   │
│  Tabs:  All · 🔥 Hot (70+) · ✉ Ready (has email, status<sent)     │
│         ⏳ Needs enrichment · 💬 Replied · 🏆 Won                  │
│                                                                   │
│  View: [Table] [Cards]   Sort: [Score ▼]   Selected: 3 ▾          │
├───────────────────────────────────────────────────────────────────┤
│  ☐ │ Lead                       │ Score │ Channels      │ Actions │
│  ☐ │ ●●● Acme Lounge Lagos      │  88   │ ✉ ☎ in IG    │ ✦ ⋯    │
│      Adaeze Okoye · acme.ng     │       │                │         │
│      "Premium lounge in Lekki…" │       │                │         │
└───────────────────────────────────────────────────────────────────┘
```

### Components changing

- **`src/pages/Leads.tsx`** — full rewrite around:
  - Header strip with **summary counters** (total / hot ≥70 / ready-to-send / needs-enrichment).
  - **Filter bar**: search input, campaign select, status select, score-range slider, region read-only chip, has-email / has-phone toggles.
  - **Tabs** (`Tabs` from shadcn) for Hot / Ready / Needs enrichment / Replied / Won — each is a saved filter combo.
  - **View toggle** (Table | Cards). Cards = grid of `LeadCard` with avatar initial, name, score ring, channel icons, snippet, primary CTA.
  - **Row hover** reveals quick actions: Enrich, Draft pitch, WhatsApp, Open website. Right-click / `⋯` opens full menu (delete, change status, copy email).
  - **Click a row** opens a new **`LeadDetailDrawer`** (right side sheet) showing: business profile, enrichment summary, all socials with icon links, score breakdown ("+25 email, +15 phone, +10 socials…"), pitch history timeline, sticky action bar (Draft / WhatsApp / Mark won).
  - Empty states per tab ("No hot leads yet — they'll appear once enrichment finds emails/phones").
  - Persists last-used view + tab in `localStorage`.

- **New `src/components/LeadDetailDrawer.tsx`** — the right-side sheet described above. Uses `Sheet` from shadcn.
- **New `src/components/LeadCard.tsx`** — card representation for grid view.
- **`src/components/PitchDrawer.tsx`** — unchanged, just opened from the new actions.

### Mobile

- Filter bar collapses to a single `Filters` button opening a `Sheet`.
- Default to Cards view < 640px. Each card is full-width with the channel icons + score ring inline.

---

## Files to change

**Backend / data**
- New migration: `leads` adds `linkedin_url, instagram_url, facebook_url, x_url, enrichment_summary, last_enriched_at`; `profiles` adds `outreach_region text default 'Nigeria'`, `outreach_country_code text default 'ng'`.
- New migration: AFTER INSERT/UPDATE trigger on `leads` calling `compute_lead_score`; trigger on `pitch_events` re-scoring linked lead; updated `compute_lead_score` body for socials + enrichment summary.
- One-shot data backfill: `UPDATE leads SET score = compute_lead_score(id)`.
- Edit `supabase/functions/campaign-tick/index.ts` — region-aware Firecrawl query + location param; phone/socials extraction during inline enrichment; AI contact-name extraction; write to new columns.
- Edit `supabase/functions/enrich-lead/index.ts` — same enrichment upgrades for the manual button path.
- Edit `supabase/functions/discover-leads/index.ts` — region-anchored query + Firecrawl `location` param.
- Edit `supabase/functions/_shared/launch.ts` — AI prompt now requires `city` + region-biased `keywords`; reads user region from `profiles`.

**Frontend**
- Rewrite `src/pages/Leads.tsx` (header counters, filter bar, tabs, view toggle, table+cards).
- New `src/components/LeadDetailDrawer.tsx`, `src/components/LeadCard.tsx`.
- Edit `src/pages/Memory.tsx` — small "Outreach region" card editing the new profile columns.

## Cost & safety

- **AI cost:** +1 cheap `gemini-2.5-flash-lite` call per enriched lead (contact name) ≈ negligible (60 leads/day × tiny prompt).
- **Migrations** are additive; no destructive changes; backfill only updates `score`.
- **Existing American leads stay** — they just now show a real (low) score and get filtered to the bottom; you can bulk-delete via the new selection bar if desired.
- **Region defaults to Nigeria** for you specifically; the setting is per-user so future workspaces can change it.

