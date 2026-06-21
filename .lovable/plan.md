## Goal

A second track inside Outreach Studio dedicated to landing **you** remote engineering work — as an individual freelancer — running alongside the existing Tech Faculty outreach. Reuses the existing Offerings / Campaigns / Leads / Pitches / Intel pipeline; adds a small amount of new code for job-board scraping and application drafting.

## High-level shape

```text
CV upload ──► Agent parses ──► Auto-seeds:
                                 • Offering "Senior Engineer — Freelance"
                                 • Agent memories (skills, stack, rate, availability, links)

Intel sources (job boards) ──► scan-jobs (new) ──► job_posts table
                                                     │
                                                     ├─ score vs your profile
                                                     ├─ has email? → lead + auto-draft application email
                                                     └─ form-only? → lead + draft "application package" (cover letter + tailored bullets) for manual submit

Talent marketplaces (Micro1, Mercor) ──► profile-sync reminders + weekly nudge in Daily Briefing
```

## What we build

### 1. CV intake
- New "Upload CV" action on the Memory page (or a small Profile card on Dashboard).
- Stored in a new private Storage bucket `resumes/`.
- New edge function `ingest-cv`: parses the PDF/DOCX, then:
  - Creates/updates an Offering `Senior Software Engineer — Freelance` (title, tagline, problem_solved, target_audience, trigger_keywords pulled from CV).
  - Writes structured `agent_memories` entries: skills, years_experience, preferred_stack, rate, availability, timezone, links (GitHub, LinkedIn, portfolio).
- The agent uses these everywhere it currently uses offerings/memory — no new plumbing needed.

### 2. Job boards as intel sources
Reuse existing `intel_sources` table; add a `kind` column (`news` | `job_board` | `talent_marketplace`) so we can route scraping differently.

Seed defaults for `kind = 'job_board'`:
- `remoteok.com/remote-dev-jobs`
- `weworkremotely.com/categories/remote-programming-jobs`
- (later) HN "Who is Hiring" monthly thread, Wellfound

Seed for `kind = 'talent_marketplace'`:
- `talent.micro1.ai`
- `work.mercor.com`

### 3. New edge function `scan-jobs`
Modeled on `scan-intel`. Runs on cron (every 2–3h):
- For each `job_board` source, Firecrawl-scrape the listing page using a JSON extraction prompt to pull `{title, company, url, location, salary, apply_email, apply_url, posted_at, description_snippet}`.
- Dedupe by URL into a new table `job_posts`.
- Score each new post 0–100 against the user's freelance Offering + CV-derived memories (skills overlap, seniority match, remote/region match, rate match). Reuse the same Lovable AI gateway pattern as `scan-intel`.
- For posts scoring ≥60, create a `lead` (campaign = "Freelance Jobs") linking back to the `job_post`, so the existing Leads UI works unchanged.

### 4. Application drafting + sending
New edge function `draft-application`:
- Input: `job_post_id`.
- Fetches the full posting (Firecrawl scrape of the post URL for full description).
- Uses the AI gateway with the user's CV + offering to generate:
  - `cover_letter` (email-ready, ≤250 words, role-specific)
  - `tailored_bullets` (3–5 resume highlights matched to the JD)
  - `subject_line`
- Stored on the lead as a `pitch` (reuses existing `pitches` table — no schema bloat).

Sending logic (matches your "auto-email, manual for forms" choice):
- If `job_post.apply_email` present → route through existing `send-pitch` pipeline (uses your already-connected Gmail). Status → `applied`.
- Else → leave as a draft pitch with the apply URL prominent; surfaced in Inbox/Leads with a "Copy + open apply link" affordance. Status → `ready_to_submit`.

### 5. Talent marketplaces (Micro1 / Mercor)
No scraping or auto-apply (these are profile-based, not job-list-based, and have login walls). Instead:
- New `marketplace_profiles` rows store last-updated date and profile URL.
- Weekly check in `daily-briefing`: "Your Micro1 profile hasn't been touched in 14 days — refresh availability + add recent project."
- The agent (Chat) gets a tool `suggest_marketplace_update` that drafts a short bio/availability update for you to paste.

### 6. UI changes (minimal, reuse what exists)
- **Memory page**: add "Upload CV" card + show parsed fields with edit affordance.
- **Campaigns page**: a campaign is auto-created on first CV upload called "Freelance Jobs" with `mode = 'job_hunt'` (new column). UI is identical to existing campaigns, except the leads tab shows columns: Role / Company / Score / Salary / Apply Method.
- **Lead drawer**: when `lead.source = 'job_post'`, show JD summary, the drafted cover letter, "Send application" (if email) or "Open apply link + copy draft" (if form).
- **Intel Sources page**: add a `kind` selector when adding a source; group list by kind.
- **Chat agent**: gets new tools `list_job_posts`, `get_job_post`, `draft_application`, `submit_application`, `refresh_freelance_profile` — so you can say "find me 3 good senior backend roles posted today and draft applications" and it executes end-to-end.

### 7. Schema additions (single migration)
- `intel_sources.kind` (text, default `'news'`).
- New table `job_posts` (id, user_id, source, title, company, url unique-per-user, apply_email, apply_url, location, salary_text, posted_at, description, score smallint, matched_offering_id, status, created_at) + GRANTs + RLS scoped to `auth.uid()`.
- New table `marketplace_profiles` (id, user_id, name, url, last_updated_at, notes) + GRANTs + RLS.
- `campaigns.mode` (text, default `'outreach'`; `'job_hunt'` for freelance).
- `leads.job_post_id` (uuid nullable, FK to job_posts).
- Storage bucket `resumes` (private).

### 8. Cron
- `scan-jobs` every 3h (pg_cron + pg_net like the existing scan jobs).
- Daily roll-up included in existing `daily-briefing` (top 5 new scored jobs, marketplace nudges).

## Out of scope (for this first pass)
- Auto-submitting to web forms / Wellfound / LinkedIn Easy Apply — too brittle and ToS-risky. Treated as draft-only.
- HN "Who is Hiring" parser — easy to add later as just another `job_board` source.
- Per-user OAuth into Micro1/Mercor — no public APIs; marketplace track stays nudge-based.

## Files touched (roughly)
- New: `supabase/functions/scan-jobs/index.ts`, `supabase/functions/draft-application/index.ts`, `supabase/functions/ingest-cv/index.ts`.
- Edited: `daily-briefing`, `studio-agent` (new tools), `IntelSources.tsx`, `Memory.tsx`, `Campaigns.tsx`, `LeadDetailDrawer.tsx`, one migration.

After you approve, I'll also need you to upload your CV in the next message so the first run of `ingest-cv` has something to parse.
