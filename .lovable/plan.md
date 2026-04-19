

User wants to:
1. Add a new offering: free landing pages for businesses (likely a lead-magnet / foot-in-the-door offer).
2. Enrich the Tech Faculty offering using real content from techfaculty.ng pages for businesses & schools.

I should fetch both URLs to ground the Tech Faculty details, then propose seed updates. Since this is plan mode (read-only), I'll fetch and present.

Let me fetch both pages.

[fetching https://techfaculty.ng/business-partnerships and https://techfaculty.ng/school-collaborations]

Plan: extend `seedOfferings.ts` and update existing seeded "Tech Faculty" row, plus add a new "Free Landing Pages" offering. Since seeding only runs when offerings table is empty, and the user already has rows, I need a smarter sync — upsert by title for the seed set so additions/edits propagate on next load (only for this user, only for the seed titles, and only if not modified). Simpler: just add an "Apply seed updates" button OR make seed idempotent by title.

Concise plan:

# Add new offerings + enrich Tech Faculty

## What I'll fetch
Pull live content from:
- techfaculty.ng/business-partnerships
- techfaculty.ng/school-collaborations

…and use it to fill out the Tech Faculty offering with real audience, problems, programs, and ideal-customer copy for both segments.

## New offering
**Free Landing Pages for Businesses** — a lead-magnet offering.
- Tagline: "A free, conversion-ready landing page for your business — live in 48 hours."
- Audience: SMEs, solopreneurs, event organizers, new product launches
- Problem solved: No web presence, slow developers, expensive agencies
- Pricing: Free (1 page, 1 revision); upsell to hosting, domain, multi-page site
- Ideal customer: Businesses with a clear offer but no landing page

## Enriched Tech Faculty (split-aware)
One offering, but copy will explicitly call out two tracks pulled from the live site:
- **Business Partnerships track** — corporate upskilling, team trainings, custom curricula
- **School Collaborations track** — tech clubs, teacher training, student bootcamps, curriculum support

Exact programs, value props, and ideal-customer language will come straight from the two URLs above.

## How the update reaches your DB
Since seed only fires on empty tables and yours already has rows, I'll switch `seedOfferings.ts` to a **title-based upsert** for the known seed titles (2nd Baze Garden, Tech Faculty, RetailOS, Free Landing Pages). On next load:
- Missing seed titles → inserted
- Existing seed titles → left alone (so your manual edits aren't overwritten)

Plus a small "Reset seed offerings to defaults" button on the Offerings page in case you want to pull in the refreshed Tech Faculty copy.

## Files touched
- `src/lib/seedOfferings.ts` — add Free Landing Pages, enrich Tech Faculty, switch to per-title insert-if-missing
- `src/pages/Offerings.tsx` — add "Refresh defaults" action

No DB schema changes. No new integrations.

