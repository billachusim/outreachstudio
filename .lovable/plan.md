# Plan: Dedicated Jobs page + CV tailoring

## Goal
Pull every job-hunt feature out of Dashboard / Intel / Memory into one **Jobs** hub, leaving the main Dashboard with a compact summary widget. Add a new "Tailor CV to a job description" tool.

## 1. New route: `/jobs`

Add `Jobs` to the sidebar (between Campaigns and Leads) with a briefcase icon. Mobile tab bar stays as-is.

The page is tabbed:

```
[ Overview ] [ Matches ] [ Sources ] [ CV & Tailor ] [ Pipeline ]
```

- **Overview** — KPIs (scanned, matched, drafted, sent, replies, interviews), today's email budget split, recent activity.
- **Matches** — full list of `job_posts` with score ≥ 60 (currently truncated in `JobHuntPanel`). Filters: score, source, posted date, status (new / drafted / applied / replied). "Generate draft" + "Re-draft" + "Open application" actions inline. Bulk select → bulk draft.
- **Sources** — moves the job-board / talent-marketplace portion of `IntelSources` here (filtered to `kind in ('job_board','talent_marketplace')`), plus "Scan jobs now" button and per-source last-scan stats from `aggregator_performance`.
- **CV & Tailor** — see section 3.
- **Pipeline** — Kanban-ish view of leads in the Job Hunt campaign by status (drafted → sent → opened → replied → interview), reusing existing `leads` + `pitch_events` data.

## 2. Shrink the Dashboard widget

Replace today's expanded `JobHuntPanel` on `/` with a compact card:
- One-line stats row: `Scanned 37 · Matched 18 · Drafts 3 · Sent today 12/40`.
- Top 3 newest high-score matches with a one-click "Draft" button.
- "Open Jobs hub →" link to `/jobs`.

Refactor: extract the heavy sections of `JobHuntPanel.tsx` into `src/components/jobs/JobMatchesList.tsx`, `JobStatsHeader.tsx`, etc. Dashboard imports only the compact summary; `/jobs` imports the full set.

## 3. CV tailoring tool (new)

UI on the **CV & Tailor** tab:
- **Base CV**: shows the current uploaded CV from `resumes` bucket (moved from Memory). Re-upload supported.
- **Tailor to a job**: two inputs — paste job description *or* pick from existing `job_posts`. Optional company name / role.
- Button **Generate tailored CV** → calls new edge function `tailor-cv`.
- Output panel: rendered Markdown CV, with **Copy**, **Download .md**, **Download .pdf**, **Download .docx**, and **Save to job post** (attaches as `job_posts.tailored_cv_md` so the next "Generate draft" uses it).

New edge function `supabase/functions/tailor-cv/index.ts`:
1. Auth-check JWT, load user's base CV text from storage (or stored `profiles.cv_text`).
2. Load JD text (from body or `job_posts.id`).
3. Call Lovable AI (`google/gemini-2.5-pro`) with a structured prompt: rewrite/reorder bullets, surface matching keywords, keep facts truthful, output Markdown sections (Summary, Skills, Experience, Education, Projects).
4. Return `{ markdown, summary_of_changes, keyword_match_score }`.
5. PDF/DOCX rendering is done client-side (`jspdf` / `docx` npm) to avoid heavy function deps. Markdown → HTML → PDF.

Schema additions (one migration):
- `job_posts`: add `tailored_cv_md text`, `tailored_cv_updated_at timestamptz`.
- `profiles`: add `base_cv_md text` (cached parsed CV so tailoring is fast and doesn't re-OCR every time). Populated by existing `ingest-cv` function — small edit to also persist the extracted text here.

## 4. Cleanup

After `/jobs` ships and is verified:
- **Dashboard** (`src/pages/Dashboard.tsx`): replace full `JobHuntPanel` with the new compact `JobsSummaryCard`.
- **Intel** (`src/pages/Intel.tsx`): keep news-only. Remove job_board scan triggers / job-specific UI; add a small "Looking for jobs? Go to Jobs →" link.
- **IntelSources** (`src/pages/IntelSources.tsx`): filter the form's "Kind" select to `news` only; route `job_board` / `talent_marketplace` management to `/jobs?tab=sources`. Keep existing rows visible (read-only) with a "Manage in Jobs" link, then drop after migration.
- **Memory** (`src/pages/Memory.tsx`): remove `CvUploadCard`; replace with a pointer card "CV lives in Jobs → CV & Tailor". Keep agent-memory features intact.

No data migration needed — existing `job_posts`, `intel_sources(kind=job_board)`, and the `resumes` bucket all stay where they are; only the UI moves.

## 5. Out of scope (call out, don't build now)
- Auto-tailoring every draft (we'll wire it as an opt-in toggle on the Jobs page once the manual flow is validated).
- Multi-CV profiles (e.g. one CV per role family) — easy follow-up once `profiles.base_cv_md` exists.

## Technical summary
- **New files**: `src/pages/Jobs.tsx`, `src/components/jobs/{JobsSummaryCard,JobMatchesList,JobStatsHeader,JobSourcesPanel,CvTailorPanel,JobPipelineBoard}.tsx`, `supabase/functions/tailor-cv/index.ts`, one migration.
- **Edited**: `src/App.tsx` (route), `src/components/AppSidebar.tsx` (nav item), `src/pages/Dashboard.tsx`, `src/pages/Intel.tsx`, `src/pages/IntelSources.tsx`, `src/pages/Memory.tsx`, `supabase/functions/ingest-cv/index.ts` (persist parsed text).
- **Deps**: add `jspdf`, `docx`, `marked` for client-side export.

## Open question
For PDF export styling — should the tailored CV match a template you like (clean single-column, classic two-column, or mirror the look of the CV you uploaded)? Default plan: clean single-column ATS-friendly layout.
