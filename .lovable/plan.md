

# Daily journal + self-evolving agent memory

## What we're building

The agent already has read/write memory tools and the Memory dashboard already supports any markdown file. We're layering on **(1) automated daily journaling**, **(2) a richer self-editing toolset**, and **(3) UI surfaces** so the system genuinely learns over time.

### 1. New edge function: `daily-journal`
Runs nightly (10:30 PM WAT, after the day is done). For each user it:
- Pulls the last 24h of activity: pitches sent, opens/replies/bounces, run state changes, run errors, leads created/won/lost, intel scanned + acted-on, social drafts created/posted, channel message failures.
- Pulls the previous day's `daily-journal-YYYY-MM-DD` memory (if any) to chain context.
- Calls Lovable AI (`gemini-2.5-flash-lite` — cheap) with a tight prompt to produce a structured markdown journal:
  - **What happened** (sends, replies, wins)
  - **What worked** (top-performing subjects, channels, intel triggers)
  - **What failed** (errors, bounces, dead campaigns) with root cause if obvious
  - **Important keywords / patterns spotted today**
  - **Notes for tomorrow** (1–3 concrete suggestions)
- Upserts a memory row with slug `daily-journal-YYYY-MM-DD`, kind `note`, title `Daily journal — Apr 21, 2026`.
- Also upserts a rolling `journal-rollup` memory: a condensed bullet list of the last 7 days' headlines, so the agent always has a one-glance recap without us pumping 7 full journals into context.

### 2. Pruning so memory doesn't bloat tokens
- Keep at most the **last 14** `daily-journal-*` files. Older ones get deleted by `daily-journal` after writing.
- The `journal-rollup` memory stays compact (capped at ~2KB).
- The agent's system prompt already injects ALL memories every turn — without pruning, journals would balloon AI cost. This keeps it bounded.

### 3. Cron schedule (one new job)
`daily-journal-nightly` at 22:30 WAT (21:30 UTC) calling the new function. Created via `psql` insert (not a migration — contains the function URL).

### 4. Expanded agent self-editing tools (in `studio-agent`)
The agent currently has `list_memories`, `read_memory`, `write_memory`. We add:
- **`delete_memory(slug)`** — retire stale notes.
- **`append_memory(slug, content)`** — append a dated bullet to an existing file (cheaper + safer than rewriting).
- **`rename_memory(slug, new_slug?, new_title?)`** — keep the index tidy.
- **`search_memories(query)`** — ILIKE on title + content; agent can find without dumping everything.

System prompt is updated to teach the agent the new "learning loop":
> When you spot a recurring failure, a winning subject line, a new product detail Bill mentions, or an objection pattern → call `append_memory` to the right playbook file (or `write_memory` for a brand-new topic). Use kebab-case slugs like `objections-retailos`, `winning-subjects`, `lessons-learned`.

### 5. Memory dashboard UI updates (`src/pages/Memory.tsx`)
- **New "Journal" section** at the top, collapsed by default, listing the `daily-journal-*` notes newest first with the date prominent.
- **"Generate today's journal now" button** that invokes `daily-journal` with `{ force: true, only_user: true }` — useful for end-of-day manual runs.
- **Search box** filters memories by title/slug/content (client-side over the loaded list).
- **Last updated** timestamp shown on every card.
- **"Lessons learned" quick-create button**: pre-fills the dialog with slug `lessons-learned` so the user can dump notes the agent will read tomorrow.

### 6. One seed memory (`src/lib/seedAgentMemory.ts`)
Add a new starter file `learning-loop` that documents the convention to the agent itself (slugs, when to append vs write, what kinds to use). Listed in `SEED_MEMORIES` so `seedAgentMemoryIfEmpty` and "Reset starters" pick it up.

## Files touched

**New:**
- `supabase/functions/daily-journal/index.ts` — the nightly journaling job (also callable on-demand).

**Edited:**
- `supabase/functions/studio-agent/index.ts` — add 4 tools + system-prompt language about the learning loop.
- `src/pages/Memory.tsx` — Journal section, search, "Generate today's journal" button, "Lessons learned" quick-create.
- `src/lib/seedAgentMemory.ts` — add `learning-loop` seed.

**Cron (psql insert, no migration):**
- Schedule `daily-journal-nightly` at 22:30 WAT.

## Cost notes (sticking to your single-user budget)
- 1 AI call/day for the journal (`flash-lite`, ~1.5K input / 800 output tokens) ≈ negligible.
- Pruning to 14 journals + rollup keeps the agent's per-turn system prompt under ~10KB even after months.
- Manual "Generate now" button is fine — you've said you won't spam.

## Open question

Do you want the journal to also include a **weekly digest** memory file (slug `weekly-journal-YYYY-Www`, generated each Sunday night, summarizing the 7 daily journals into one)?
- **A:** Yes — adds 1 AI call/week, gives the agent a "long memory" rollup per week. Recommended.
- **B:** No — skip it, the rolling `journal-rollup` is enough.

**Default if no answer: A.**

