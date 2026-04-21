

# Intel → Action: Full Build

## What we're shipping (everything across all 4 phases)

### Phase 1 — Pitch from intel
- "Draft pitch from intel" drawer on each `/intel` card → AI drafts pitch grounded in article + matched offering + memory → save as draft or send
- New agent tool `draft_pitch_from_intel` so Studio Agent can draft from a headline by name
- Auto-link intel to existing leads by domain match (during scan, after insert)
- Dashboard "Today's Top Triggers" widget (top 3 by score, quick "Draft pitch" button)

### Phase 2 — Auto-discover leads from intel
- "Create lead from this story" button on intel cards → Firecrawl scrapes article → extracts company + website + person → runs `enrich-lead` → inserts lead under matched offering's campaign
- Per-offering toggle `auto_lead_from_intel` (off by default) → daily cron auto-creates leads from score ≥ 80 items, queued as `status='new'` for your review before send

### Phase 3 — Smarter intel
- **Custom sources page** at `/intel/sources` → add your own URLs/RSS feeds (Disrupt Africa, Ventures Africa, niche blogs); scan-intel reads from a new `intel_sources` table merged with the 3 hardcoded defaults
- **Keyword boosters per offering** → new `trigger_keywords text[]` column on `offerings`; scoring prompt gets these keywords and bumps score when matched
- **Decay & cleanup** → daily cron deletes intel items older than 14 days that are unactioned and have no linked pitch/lead

### Phase 4 — Content engine
- New `social_drafts` table: stores AI-drafted posts (X thread, LinkedIn, IG caption) tied to an intel item
- New edge function `draft-social-from-intel` → runs nightly on top intel items tagged "commentary-worthy"; also callable manually per intel card via "Draft social post" button
- New `/social` page with tabs for **X**, **LinkedIn**, **Instagram** drafts → each card shows the post, source intel, copy button, "Auto-post" button (uses existing `post-x` / `post-facebook` / `post-instagram` functions when channels are connected; otherwise greyed out with "Connect channel" hint)
- Add **Social** entry to sidebar + mobile tab bar

### Weekly digest
- New cron `weekly-intel-digest` Sunday 6pm WAT → emails you (via Resend) a summary of the week's intel, what was pitched, what's still unactioned, top scorers

## Database changes (one migration)

```sql
-- Phase 3: custom sources per user
create table public.intel_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  url text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.intel_sources enable row level security;
-- own-row CRUD policies

-- Phase 3: keyword boosters
alter table public.offerings add column trigger_keywords text[] default '{}';

-- Phase 2: per-offering auto-lead toggle
alter table public.offerings add column auto_lead_from_intel boolean not null default false;

-- Phase 1: link intel ↔ lead and intel ↔ pitch
alter table public.intel_items add column linked_lead_id uuid;
alter table public.intel_items add column linked_pitch_id uuid;
create index on public.intel_items(linked_lead_id);

-- Phase 4: social drafts
create table public.social_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  intel_item_id uuid,
  platform text not null,            -- 'x' | 'linkedin' | 'instagram'
  body text not null,
  status text not null default 'draft', -- draft | posted | dismissed
  posted_at timestamptz,
  provider_post_id text,
  created_at timestamptz not null default now()
);
alter table public.social_drafts enable row level security;
-- own-row CRUD policies
```

## New edge functions

- `draft-pitch-from-intel` — input: `intel_item_id`, optional `offering_id` → returns `{subject, body}` + saves a `pitches` row
- `intel-to-lead` — input: `intel_item_id` → Firecrawl scrape article → AI extract `{company, website, contact_name?}` → call `enrich-lead` → insert into `leads` → link back to intel item
- `draft-social-from-intel` — input: `intel_item_id`, `platform` → AI drafts post → insert `social_drafts` row
- `weekly-intel-digest` — cron, emails user via Resend
- `cleanup-intel` — cron, deletes stale unactioned items

## Modified edge functions

- `scan-intel` — read `intel_sources` for the user, merge with defaults; pass each offering's `trigger_keywords` into the scoring prompt; after insert, match `extract_root_domain(url)` against `leads.root_domain` to set `linked_lead_id`; if offering has `auto_lead_from_intel=true` and score ≥ 80, fire `intel-to-lead`
- `studio-agent` — register new tool `draft_pitch_from_intel({headline_or_id, offering_hint?})`
- `daily-briefing` — already pulls intel; no change needed

## Cron jobs (added)

| Job | Schedule (UTC) | Local (WAT) |
|---|---|---|
| `cleanup-intel` | `0 4 * * *` | 5am daily |
| `draft-social-from-intel` (nightly batch) | `30 5 * * *` | 6:30am daily |
| `weekly-intel-digest` | `0 17 * * 0` | 6pm Sunday |

## New / modified UI

**New files:**
- `src/components/IntelPitchDrawer.tsx` — drawer with AI-drafted pitch, edit, save/send
- `src/components/IntelLeadDrawer.tsx` — confirms extracted company before creating lead
- `src/pages/Social.tsx` — tabs (X / LinkedIn / Instagram), copy + auto-post per card
- `src/pages/IntelSources.tsx` — manage custom sources
- `src/components/TopTriggersWidget.tsx` — dashboard widget

**Modified:**
- `src/pages/Intel.tsx` — add "Draft pitch", "Create lead", "Draft social", and a link to `/intel/sources`; show linked-lead badge
- `src/pages/Dashboard.tsx` — embed `<TopTriggersWidget />`
- `src/pages/Offerings.tsx` — add `trigger_keywords` chip-input + `auto_lead_from_intel` toggle per offering
- `src/components/AppSidebar.tsx` + `src/components/MobileTabBar.tsx` — add **Social** entry
- `src/App.tsx` — add `/social` and `/intel/sources` routes

## Two decisions before I build

1. **Mobile tab bar already has 5 items (Studio, Agent, Campaigns, Leads, Inbox).** Adding Social makes 6 — feels cramped on mobile. Options:
   - **A:** Replace **Campaigns** with **Social** in the mobile bar (Campaigns stays in sidebar). Cleaner.
   - **B:** Show 6 tabs, slightly tighter spacing.
   - **Default if no answer: A.**

2. **Auto-lead from intel default:** off per offering, you flip it on per-offering as you trust it. **Default: off.** OK?

If you say "go", defaults apply and I build everything in this round.

