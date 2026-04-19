
Big request. Let me think through it before planning.

User wants:
1. **No login required** — it's private, single-user tool
2. **One-click "Start Outreach" per offering/campaign** that runs end-to-end automatically: find leads → enrich → draft → send → track
3. **Background automation** — keeps running while they're away
4. **Progress dashboard** — just check in and see what's happening
5. **Chat page** — talk to a "studio agent" that can take actions and report status

Current state:
- Auth is required (ProtectedRoute + Auth page)
- Bulk draft/enrich/send work but are **manual click-driven** in the browser — close the tab, it stops
- No lead-discovery yet (Google Places never built)
- No background runner, no scheduled jobs
- No chat agent

Key technical decisions:

**A. Auth removal — careful.** RLS policies all use `auth.uid() = user_id`. Three options:
- Remove auth entirely + drop RLS → opens DB to anyone with the anon key (publishable). Bad if URL leaks.
- Keep auth but auto-login with a fixed account → preserves RLS, no login UI friction. **Best.**
- Single hardcoded passcode gate → middle ground.

I'll recommend auto-login (option 2) — keeps DB safe, zero friction.

**B. Background automation.** Browser tabs can't run background work. Need server-side:
- A `campaign_runs` table tracking state (queued / discovering / enriching / drafting / sending / done)
- An orchestrator edge function `run-campaign-step` that does ONE step then exits
- A pg_cron job that pings the orchestrator every minute to advance any active runs
- Lead discovery: need **Google Places** (or similar). User hasn't connected it. Flag this.

**C. Chat agent.** Lovable AI with tool-calling. Tools = start campaign, pause, status, list leads, send pitch, etc. Conversation stored in DB.

**D. Sender domain reminder.** Still on `onboarding@resend.dev` — bulk auto-sending will be limited/spammy. Must flag.

This is huge. I should split into phases, not ship everything at once. Let me plan a clear sequence and ask about the Places API + auth approach.

Need to ask:
- Auth approach (auto-login vs full removal)
- Lead discovery source (Google Places needs API key — they don't have it connected)

# Plan: Automated Outreach Studio

You're describing a real shift — from a manual tool you click through, to a **background system** you check in on. Here's how I'd build it. Big scope, so I'll phase it.

## Phase A — Remove the login friction
You stay logged in permanently with no login screen. Two options:

- **Auto-login (recommended):** App silently signs into one fixed account on load. RLS stays on, database stays safe even if the URL leaks. Zero friction for you.
- **Drop auth entirely:** Simpler, but anyone who finds the URL sees your data. Not recommended.

## Phase B — Background campaign engine
The piece that makes "set it and forget it" work.

1. New `campaign_runs` table tracks state per campaign: `queued → discovering → enriching → drafting → sending → paused/done`, plus counts (leads found, emails sent, replies).
2. New edge function `campaign-tick`: advances ONE active run by one small step, then exits.
3. A scheduled job (pg_cron) calls `campaign-tick` every 60 seconds. So even with the browser closed, campaigns keep moving.
4. Daily caps respected (50 sends/day default) so you don't burn the domain.

## Phase C — One-click "Start Outreach"
- Big **Start Outreach** button on every Offering and Campaign card.
- Clicking it: creates a campaign (if from Offering), inserts a `campaign_runs` row as `queued`, returns immediately.
- The background engine takes it from there.

## Phase D — Lead discovery (the missing piece)
Currently leads are added manually. For full automation, the engine needs to **find** leads from your campaign's category + city + keywords.

This needs an API. Two paths:
- **Google Places API** — best for local businesses (restaurants, dentists, gyms, etc.). Needs a Google Cloud key from you.
- **Firecrawl search** — already connected. Works for web-discoverable businesses but less structured. Good enough to start.

I'll start with Firecrawl (no setup) and we can add Google Places later if results are weak.

## Phase E — Studio dashboard
Replace the current Dashboard with a live ops view:
- Active campaigns with progress bars (leads found / enriched / drafted / sent / replied)
- Today's send count vs cap
- Recent activity feed (last 20 events: "Found 12 leads for Acme campaign", "Sent pitch to joe@...", "Reply from sarah@...")
- Pause / Resume per campaign

## Phase F — Studio Agent chat page
New `/chat` page. You type to it; it can act.

- Powered by Lovable AI (gpt-5 with tool calling, no key needed)
- Conversation persisted in a `chat_messages` table
- Tools the agent can call: `start_campaign`, `pause_campaign`, `get_campaign_status`, `list_recent_leads`, `summarize_replies`, `add_offering`, `draft_pitch_for_lead`, `send_pitch`
- Markdown-rendered replies

Examples you could say:
- "How's the Acme campaign going?"
- "Pause everything"
- "Draft a friendlier pitch for the last 5 leads in Bondi gym campaign"
- "What replies came in today?"

## Two things I need from you before building

**1. Auth approach** — auto-login (safe) or fully remove (simple but exposed)?

**2. Sender domain** — you're still on `onboarding@resend.dev`. Once campaigns auto-send dozens per day from that address, they'll go straight to spam and Resend may rate-limit you. Strongly recommend adding your own domain in Resend before flipping the switch on Phase B. I can build everything and leave sending paused until you're ready.

## Build order I propose
1. Phase A (auto-login) — 5 min
2. Phase B + C + D (engine + button + Firecrawl discovery) — biggest chunk
3. Phase E (live dashboard)
4. Phase F (chat agent)

Want me to start with Phase A + B together, or do all of A–D in one pass? And which lead-discovery source — Firecrawl now, or wait until you connect Google Places?
