

# Auto-launch a campaign from an Intel story

A new **"Launch campaign"** button on each intel card that does the entire pipeline in one click: pick or invent an offering → create a campaign tuned to the story → kick the outreach engine that finds, enriches, drafts, and sends.

## What you'll see on the Intel page

A new primary action `🚀 Launch campaign` next to the existing "Draft pitch" / "Create lead" buttons.

Click → opens a small confirmation drawer showing:
- **Offering**: matched existing one OR *"New offering will be created"* with a preview (title, tagline, ideal customer)
- **Campaign**: name, derived city/category/keywords from the article
- **Discovery target**: 20 leads, 20/day send cap (your defaults)

Two buttons: `Edit details` (open expanded form) or `Launch now`.

After launch → toast + redirect to the Studio dashboard so you can watch the run progress live.

## How it works under the hood

### New edge function: `launch-campaign-from-intel`

Takes `{ intelItemId }`, runs server-side:

1. **Load** the intel item + user's offerings + agent memory.
2. **Match or create offering** via one Lovable AI call (`gemini-2.5-flash`, structured tool output):
   - Input: intel title/summary/tags + list of existing offerings (id, title, tagline).
   - Output: either `{ matchedOfferingId }` OR `{ newOffering: { title, tagline, problem_solved, ideal_customer, target_audience, trigger_keywords[] } }`.
   - If new → insert into `offerings`.
3. **Derive campaign params** from the same AI call:
   - `name` (e.g. "Intel: Dangote expansion — 21 Apr"), `city`, `category`, `keywords`, `discovery_source` (`google_places` if local-business signal, else `firecrawl`).
4. **Insert campaign** linked to that offering, status `active`, `email_cap = 20`.
5. **Insert `campaign_runs` row** (`state: queued`, target 20 leads) — same shape `startOutreach` uses.
6. **Mark intel** `acted_on = true`, store campaign id in a new note ("Spawned campaign X").
7. **Invoke `campaign-tick`** with the new run id (fire-and-forget) so discovery starts immediately.
8. Return `{ campaignId, runId, offeringId, offeringCreated: bool }`.

The existing `campaign-tick` engine then handles the rest with no changes — discovery → enrichment → drafting → sending — using the new offering as pitch context and the keywords/city/category we set.

### New component: `IntelLaunchCampaignDrawer.tsx`

- Calls `launch-campaign-from-intel` with `dryRun: true` first → shows the AI's proposal.
- User can edit the campaign name, city, category, keywords, channel (email/whatsapp), and toggle "use existing offering vs create new" before confirming.
- Confirm → calls again with `dryRun: false` → toast + `navigate("/")`.

The dry-run/confirm split costs 1 AI call total (we cache the proposal in component state between the two server calls — the second call accepts the already-decided params and skips AI).

### Files

- **New** `supabase/functions/launch-campaign-from-intel/index.ts` — orchestrator above.
- **New** `src/components/IntelLaunchCampaignDrawer.tsx` — the confirm UI.
- **Edit** `src/pages/Intel.tsx` — add `🚀 Launch campaign` button on each card; mount the drawer.
- **Edit** `src/components/TopTriggersWidget.tsx` — add the same button (so you can launch from the dashboard widget too).

## Cost & safety

- 1 AI call per launch (cached between dry-run and confirm).
- Campaign and run rows are real DB inserts — same as if you'd built it manually in the Campaigns tab. You can pause/end the run from the dashboard like any other.
- If the AI can't pick or invent a sensible offering (e.g. unrelated story) the function returns 422 with a clear message and creates nothing.

## Open question

When the AI **invents a new offering**, should it:

- **A:** Save it as `status: 'draft'` so it doesn't pollute your active offerings list until you review it. *(Recommended — safer.)*
- **B:** Save as `status: 'active'` immediately so it shows up everywhere right away.

Default if no answer: **A**.

