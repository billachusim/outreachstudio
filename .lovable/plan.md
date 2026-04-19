

This is a big strategic ask. Let me scope it tight before planning.

The user wants me to:
1. Treat the doc as a source-of-truth product portfolio + SOP playbook
2. Create new **offerings** in the DB matching Bill's full portfolio (Eavesdrop, Alter Ego, Dear Claire, AI Clopedia, Palmshop NG, Nkwo Nnewi, Exams AI, AutoPR, etc.)
3. Create new **templates** matching the SOP scripts (RetailOS lead hunter, WhatsApp scout DM, social engagement comments, cPanel ops not really an outreach template)
4. Set up **automations** — five SOPs map to five distinct automation types, but only #3 (RetailOS Lead Hunter) maps cleanly to the existing campaign engine. Others (#1 WhatsApp, #2 Social, #4 cPanel, #5 Competitor) need browser-driven or social APIs we don't have.
5. Create persistent **agent memory** as `.md` files (soul/identity/personality/ops playbook) that the Studio Agent reads on every chat turn.

Realistically achievable now vs. needs more infra:

**Now (this loop):**
- Add 8 new offerings to seed data + insert for current user
- Add 4 new outreach templates (RetailOS supermarket pitch, generic founder partnership DM, social comment value-add, AutoPR cold pitch)
- Build agent identity/memory system: store memory `.md` files in a new `agent_memory` table, load them into the system prompt on every chat turn, give the agent `read_memory` / `write_memory` / `list_memories` tools so it can update them itself
- Seed 4 starter memory files: `identity.md`, `personality.md`, `portfolio.md` (the doc above, structured), `playbook.md` (the SOPs)

**Defer (call out, don't build):**
- WhatsApp Scout, Social Engagement, Competitor Intel, cPanel Ops automations — these need browser automation, X/LinkedIn APIs, or cPanel APIs. I'll list them as "ready to build next, here's what each needs" and not start them.

## Plan

### 1. Seed Bill's full product portfolio as offerings

Extend `src/lib/seedOfferings.ts` `SEED_OFFERINGS` with 8 new entries grouped by faculty:

- **Social Faculty**: Eavesdrop, Alter Ego, Dear Claire, AI Clopedia
- **Tech Faculty** (already have RetailOS, Tech Faculty NG): add Palmshop NG, Nkwo Nnewi App, Exams AI
- **PR Faculty**: AutoPR

Each gets `target_audience`, `problem_solved`, `pricing`, `ideal_customer` filled from the doc. Run `seedOfferingsIfEmpty(user.id)` next time the user opens Offerings — new ones appear; existing rows untouched.

### 2. Add 4 new outreach templates

Insert into `templates` table for the current user:
- **RetailOS Supermarket Manager** — full email from the doc (digital transformation pitch)
- **Founder Partnership DM** — short WhatsApp/X-style intro from WhatsApp Scout SOP
- **Social Value-Add Comment** — the "praise + insight + question" framework as a reusable starter
- **AutoPR Cold Pitch** — press release / PR services intro for SMEs and brands

### 3. Agent memory system (the big one)

**New table** `agent_memories`:
```
id, user_id, slug (unique per user), title, content (markdown), kind, updated_at, created_at
```
RLS: own rows only. `kind` ∈ `identity | personality | portfolio | playbook | note`.

**Seed 4 memory files** for the user on first load (mirrors `seedOfferingsIfEmpty`):
- `identity.md` — Who Bill is, what the studio is, faculty structure
- `personality.md` — Tone (founder-style, concise, no fluff, Nigerian context, value-first)
- `portfolio.md` — Full product list from the doc, structured by faculty
- `playbook.md` — Condensed SOPs: WhatsApp Scout, Social Engagement, RetailOS Lead Hunter, cPanel Ops, Competitor Intel — trigger conditions + key steps + KPIs

**Studio Agent changes** (`supabase/functions/studio-agent/index.ts`):
- On every chat turn, load all `agent_memories` for the user and prepend them to the system prompt under a `## Persistent memory` section
- Add 3 new tools the agent can call:
  - `list_memories()` → returns slugs + titles
  - `read_memory(slug)` → returns full content
  - `write_memory(slug, title, kind, content)` → upserts a memory file
- This lets the agent update its own soul/personality/notes when the user says things like "remember that I prefer short subject lines" or "update the playbook to add X"

**New page** `src/pages/Memory.tsx` + sidebar link "Memory":
- Lists all memory files in cards
- Click to view/edit markdown in a textarea
- Save / delete buttons
- "Reset to defaults" button to re-seed the 4 starter files

### 4. Communicate the deferred automations

In the chat reply (not as a built feature), I'll list the 4 SOPs that aren't yet automatable in this codebase and what each would need:
- **WhatsApp Scout** → needs WhatsApp Web automation (Playwright in a long-running container, not edge functions)
- **Social Engagement** → needs X API v2 paid tier + LinkedIn API (no public LinkedIn write API; only manual or Sales Navigator scraping)
- **cPanel Ops** → needs cPanel UAPI credentials per-domain; doable as edge functions if the user wants
- **Competitor Intel** → doable now actually (Firecrawl + scheduled cron) but scope creep — flag as next

## Files to change

**New:**
- `src/pages/Memory.tsx`
- `src/lib/seedAgentMemory.ts`
- `supabase/migrations/<new>.sql` — `agent_memories` table + RLS

**Modified:**
- `src/lib/seedOfferings.ts` — add 8 entries
- `src/components/AppSidebar.tsx` — add Memory link
- `src/App.tsx` — add `/memory` route
- `supabase/functions/studio-agent/index.ts` — load memories into system prompt; add 3 memory tools
- `src/pages/Offerings.tsx` or wherever seed runs — also call `seedAgentMemoryIfEmpty(user.id)` and seed templates

**One-off DB inserts (via insert tool, not migration):**
- 4 template rows for the current user

## What you get

- 11 total offerings covering Bill's full portfolio
- 4 new ready-to-use templates
- A `/memory` page where you (and the agent) can read/write the studio's identity, personality, portfolio knowledge, and SOP playbook as living markdown
- The Studio Agent now "remembers" who you are, your products, your tone, and your operating procedures across every conversation — and can update its own memory when you tell it to

