

# AI cost optimization — single-user pass

Since you're the only user, I'm dropping the anti-spam debounce/cooldown work and keeping the changes that **structurally** save credits regardless of usage pattern.

## What we're building

### 1. Cache-first social drafts (biggest win)
- `IntelSocialDrawer` opens → query `social_drafts` for this intel across all 3 platforms → pre-fill textareas. No AI call on open.
- Draft button only fires AI when no row exists. Becomes "Re-draft" (with "AI" badge) when one exists.
- `draft-social-from-intel` (single-item mode) also checks DB first and returns the cached row's id when present — protects against any client bypass.
- Same cache-check in `/intel` page's "Draft post" dropdown and `TopTriggersWidget`'s Post button.

### 2. Cache-first pitches
- `IntelPitchDrawer` Save button **inserts the `pitches` row directly from client state** (subject + body already in memory from the draft step). Drops the second AI call entirely.
- Updates `intel_items.linked_pitch_id` and lead status from the client.
- If `intel_items.linked_pitch_id` is set, intel cards show "Pitch drafted ✓" with a "View pitch" action that opens the existing row instead of redrafting.

### 3. `scan-intel` token cuts
- Switch scoring model: `gemini-2.5-flash` → **`gemini-2.5-flash-lite`** (~10× cheaper, plenty for 0–100 scoring).
- Trim each candidate's summary sent to the prompt from up to 600 chars → **200 chars**.
- Chunk candidates: max **20 per AI call** (today everything goes in one bloated prompt; if a scan returns 40 articles, we now do 2 lean calls).
- Skip the AI call when there are zero offerings with `problem_solved` or `trigger_keywords` (nothing to score against).

### 4. Trim the nightly social cron
- Today: top 3 intel × {X, LinkedIn} = **6 AI calls/night**.
- New: top 2 intel × {X only} at score ≥ 70 = **2 AI calls/night**.
- LinkedIn + Instagram still available on demand from the drawer (cached after first generation).

### 5. UI transparency
- "AI" badge (tooltip: "Uses 1 AI call") on every button that triggers a fresh generation: Draft pitch, Re-draft, Draft X/LinkedIn/IG, Scan now, Refresh briefing.
- "Cached" badge when the drawer pre-fills from an existing row.

## DB change (one migration)

```sql
-- enforce one draft per (user, intel, platform) at DB level so cache-check is bulletproof
create unique index if not exists idx_social_drafts_unique_cache
  on public.social_drafts (user_id, intel_item_id, platform);
```

No `last_scan_at` column — dropped with the cooldown.

## Files touched

**Edge functions:**
- `supabase/functions/draft-social-from-intel/index.ts` — DB cache-check before AI in single-item mode; nightly batch → X-only, top 2, score ≥ 70.
- `supabase/functions/scan-intel/index.ts` — model swap, 200-char summary trim, chunking, skip when no scoreable offerings.

**Client:**
- `src/components/IntelSocialDrawer.tsx` — pre-load from `social_drafts`; show Cached vs AI badge; AI call only on explicit Re-draft.
- `src/components/IntelPitchDrawer.tsx` — Save inserts `pitches` directly; no second AI call.
- `src/pages/Intel.tsx` — cache-check before drafting social; show "Pitch drafted" state when `linked_pitch_id` set.
- `src/components/TopTriggersWidget.tsx` — same cached-first pattern; cached badge.

## Expected impact

| Action | Before | After |
|---|---|---|
| Draft + save 1 pitch | 2 AI calls | **1** |
| Open social drawer (cached) | up to 3 AI calls | **0** |
| Nightly social cron | 6 calls | **2** |
| Per-call scan scoring cost | flash @ 600-char | **flash-lite @ 200-char** (~10× cheaper) |

Roughly **50–70% cut** in daily AI spend, no functionality lost.

