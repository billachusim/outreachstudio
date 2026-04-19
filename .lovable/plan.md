
The user wants to add another offering to the Pitchdesk plan: "Tech Faculty" — tech trainings for individuals, schools, and organizations. I'll fold this into the existing plan as a second seed offering alongside 2nd Baze Garden, and keep the rest of the plan intact.

# Pitchdesk — Personal Outreach Platform

**⚠️ Build this as a NEW project** (remix or create-new from your dashboard). Do not add it to 2nd Baze Garden.

## What it is
A private, single-admin dashboard where you manage multiple offerings (products/services/skills) and run targeted outreach campaigns for each — find leads, enrich them, draft AI pitches with the right proof-of-work, send via email, and track replies.

## Core model
**You → many Offerings → many Campaigns → many Leads → many sent Pitches.**
Each offering carries its own proof-of-work so AI drafts always pitch with the right evidence.

## Sections to build

**1. Offerings (your portfolio)**
Cards for each thing you sell. Each holds: title, target audience, problem solved, price/package, demo link, screenshot, testimonial, ideal-customer profile.

Seed offerings:
- **2nd Baze Garden** — digital menu / ordering for lounges & restaurants.
- **Tech Faculty** — tech trainings for individuals, schools, and organizations (with sub-audiences so campaigns can target each segment separately).

**2. Campaigns**
Pick an offering + target (city, business category, keywords). "Find leads" runs Google Places search and saves matches (name, address, phone, website, rating) to the campaign's lead list. For Tech Faculty, presets for "schools", "coworking spaces", "NGOs", "SMEs".

**3. Leads pipeline**
Status flow: `new → enriched → drafted → sent → opened → replied → won/lost`.
Per-lead actions:
- **Enrich** → Firecrawl scrapes website for email + 1-line summary
- **Draft** → Lovable AI writes personalized pitch using offering + lead summary
- **Edit & Send** → Resend delivers from your verified address

**4. Templates library**
Reusable email frames per offering (subject patterns, opening hooks, signatures) so AI stays on-brand for each — Tech Faculty pitches sound like training proposals, 2nd Baze pitches sound like product demos.

**5. Inbox & stats**
Sent log with delivery status. Per-campaign metrics: leads found, emails sent, open rate, reply rate. Daily send cap for compliance.

## Auth & privacy
Email + password, single-admin. All data private, no public pages. RLS on every table.

## Integrations (provide after approval)
- **Google Places API key** — lead search
- **Resend** — sending (verify domain or use test sender)
- **Firecrawl** — website enrichment
- **Lovable AI** — pitch drafting (built-in)
- **Lovable Cloud** — auth, database, edge functions

## Build order
1. New project → auth → Offerings CRUD → seed 2nd Baze Garden + Tech Faculty
2. Campaigns + Google Places lead search
3. Firecrawl enrichment
4. AI drafting + edit-and-send via Resend
5. Inbox, stats, daily send cap

## Design direction
Clean operator dashboard — sidebar nav (Offerings, Campaigns, Leads, Templates, Inbox), dense data tables, calm neutral palette with one accent for status/CTAs.

---

**Next step:** Create a new project from your dashboard, then paste this plan into the first message there to kick off the build.
