

# Raw leads pool + CSV bulk upload + smart pre-discovery match

Right now every lead is tied to a campaign at creation time, so there's no shared pool to draw from. We'll add a **raw leads** concept (unassigned leads), let you upload CSVs, and have campaigns search the pool *before* spending Firecrawl/Google Places credits.

---

## Part 1 — Raw leads (unassigned)

A "raw lead" is just `leads.campaign_id = NULL`. Schema already supports this — we only need to expose it in the UI and let the system use it.

**Leads page changes (`src/pages/Leads.tsx`):**
- New campaign filter option at the top: **`📥 Raw leads (unassigned)`** — selects `campaign_id IS NULL`. Default landing view stays "All campaigns" but the chip is one click away.
- Counter strip gets a 5th stat: *"23 raw"* (unassigned total).
- New tab: **`📥 Raw`** (alongside Hot / Ready / Needs / Replied / Won) — same as the campaign filter, just a tab shortcut.
- The "Add lead" dialog's Campaign dropdown gets a top option: **`— Raw lead (no campaign) —`**. Selecting it inserts with `campaign_id: null`.
- Selecting raw leads in the table reveals a new bulk action button: **`Assign to campaign…`** → small popover with a campaign select → bulk update `campaign_id`.

**Lead detail drawer (`src/components/LeadDetailDrawer.tsx`):**
- Add a "Campaign" row that's editable: shows current campaign name (or "Raw — unassigned") with a small `Change` button → opens a select to reassign or detach (set to NULL).

---

## Part 2 — CSV / spreadsheet bulk upload

A new **`Import leads`** button next to "Add lead" on the Leads page. Opens a dialog:

```
┌─ Import leads from CSV ───────────────────────┐
│  [ Drop file or click to browse ]   .csv      │
│                                                │
│  Assign to:  ◉ Raw leads (no campaign)         │
│              ○ Specific campaign ▼             │
│                                                │
│  Detected 47 rows · Preview:                   │
│  ┌─────────────────────────────────────────┐  │
│  │ Business     │ Email          │ Phone   │  │
│  │ Acme Lounge  │ hi@acme.ng    │ 0801…   │  │
│  └─────────────────────────────────────────┘  │
│                                                │
│  Column mapping (auto-detected):               │
│  business_name ← "Name" ▼                      │
│  contact_email ← "Email" ▼                     │
│  phone         ← "Phone Number" ▼              │
│  website       ← "Website" ▼                   │
│  contact_name  ← (skip) ▼                      │
│  address       ← (skip) ▼                      │
│  notes         ← (skip) ▼                      │
│                                                │
│  ☑ Skip duplicates by email/website            │
│                  [Cancel]  [Import 47 leads]   │
└────────────────────────────────────────────────┘
```

**How it works:**
- Pure client-side parsing using `papaparse` (small, ~45kb, npm-installable). Parses CSV in the browser — no backend roundtrip until insert.
- Auto-maps columns by header name (case-insensitive fuzzy: `business`, `name`, `company` → `business_name`; `email`, `e-mail` → `contact_email`; etc.). User can override each mapping.
- Shows a preview of first 5 rows so the user verifies the mapping is right.
- Dedupe option (default on): skip rows whose `contact_email` or `website` root domain already exists in the user's leads.
- Inserts in batches of 100 via the standard supabase client (RLS handles user_id). Auto-score trigger fires per row, so imported leads get real scores immediately based on what columns they include.
- Success toast: *"Imported 42 leads (5 skipped as duplicates)"*. Refreshes the table.

**Files:** new `src/components/ImportLeadsDialog.tsx`, edit `src/pages/Leads.tsx` to add the button. Add `papaparse` + `@types/papaparse` to `package.json`.

---

## Part 3 — Pre-discovery: campaigns mine the raw pool first

When a campaign run hits the `discovering` state, before calling Firecrawl/Google Places, it now does a **raw-pool sweep**:

**New step in `supabase/functions/campaign-tick/index.ts` (start of `discovering` branch, before the existing source-specific code):**

1. Fetch up to `target_lead_count - have` raw leads (`campaign_id IS NULL`, same `user_id`) ordered by score DESC.
2. For each, score how well it matches the campaign:
   - **Keyword match**: campaign `keywords` and `category` terms checked against lead `business_name + notes + enrichment_summary` (case-insensitive substring + word-boundary). Each hit = +1.
   - **Region match**: lead `address` or `website` TLD aligned with the user's `outreach_country_code` = +2.
   - Threshold: needs ≥1 keyword hit OR (city match + ≥1 weak signal). If campaign has no keywords/category at all (rare for AI-generated ones now that we require it), fall back to "any raw lead in region".
3. Bulk-attach matched leads: `UPDATE leads SET campaign_id = <run.campaign_id> WHERE id IN (...)`. They keep their existing `status` and `score`.
4. Log: `run_events.kind = 'reused_from_pool'`, message *"Reused 7 raw leads matching campaign keywords (saving Firecrawl credits)."*
5. Recount and only fall through to Firecrawl/Places if `have < target_lead_count` after the sweep.

**Net effect:** Re-uses the cheap pool first; only spends external API credits to fill the gap. Imported CSV leads automatically get pulled into the next matching campaign.

A small **"Match score"** for matched leads stays the same — they don't get re-enriched if `last_enriched_at` is set; otherwise they enter the normal enriching state.

---

## Part 4 — Schema + safety

No schema changes. Everything works against the existing `leads.campaign_id NULL` shape.

**RLS:** existing `own leads` policies already cover NULL campaign_id (they key on `user_id`). No policy changes.

**Migration:** none.

**Safety nets:**
- Bulk reassignment is a single SQL update wrapped client-side; if it fails the toast surfaces the error, no partial state.
- Pool sweep only attaches leads — it never deletes, never overwrites status, never modifies the lead's identity.
- Imported leads with no email/phone start at score 0–10 and naturally drop to the bottom of every view; they only get enriched once attached to a campaign.

---

## Files to change

**Frontend**
- Edit `src/pages/Leads.tsx` — Raw leads filter chip + tab + counter, Campaign dropdown gets "no campaign" option, new "Import leads" button, bulk "Assign to campaign" action when raw leads are selected.
- Edit `src/components/LeadDetailDrawer.tsx` — editable Campaign field (reassign or detach).
- New `src/components/ImportLeadsDialog.tsx` — CSV upload, column mapping, preview, dedupe, batched insert.
- Edit `package.json` — add `papaparse` and `@types/papaparse`.

**Backend**
- Edit `supabase/functions/campaign-tick/index.ts` — insert raw-pool sweep at the top of the `discovering` state before the Firecrawl/Places branches.

## Cost & UX

- **Cost saved:** Every raw lead reused = one fewer Firecrawl search credit + one fewer enrichment scrape. A 100-lead CSV upload could power 2 full campaigns with zero discovery spend.
- **UI noise:** Default Leads view is unchanged for users who don't care — the raw-leads features are progressive (chip, tab, button).
- **Backward compatible:** All existing campaign-attached leads stay exactly as they are.

