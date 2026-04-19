

The user wants WhatsApp + social accounts wired in so campaigns can actually go online and generate/engage leads. This maps directly to SOPs #1 (WhatsApp Scout) and #2 (Social Engagement) from the doc — the two I deferred last loop.

Let me be honest about what's actually possible inside Lovable's edge-function runtime vs. what needs external infra. No point planning something that can't ship.

## What each platform actually allows

**WhatsApp** — three options, very different:
1. **WhatsApp Cloud API (Meta official)** — supported, sends/receives via webhooks. BUT: only works for sending to users who messaged you first OR via pre-approved template messages. You cannot scrape groups, cannot DM cold contacts, cannot search group messages. The whole "WhatsApp Scout" SOP (scan groups for keywords, cold DM founders) is **forbidden by Meta ToS** on the official API.
2. **WhatsApp Web automation (Playwright/Baileys)** — does what the SOP describes, but needs a long-running Node process with a persistent browser session. **Edge functions can't do this** (no persistent state, 60s timeout). Needs a VPS or a service like Railway/Fly.
3. **Third-party providers (Wassenger, Whapi.cloud, 2Chat)** — wrap unofficial WhatsApp Web, expose a REST API. Costs $30–80/mo. Works inside edge functions.

**X (Twitter)** — API v2 Basic tier is $200/mo for posting + reading. Free tier is read-only and rate-limited to almost nothing. Doable but expensive.

**LinkedIn** — no public write API. Posting/commenting/DMing requires either Sales Navigator scraping (ToS violation, account ban risk) or a third-party like Unipile/PhantomBuster ($50–200/mo).

**Facebook/Instagram** — Graph API requires a Business Page + app review for most useful scopes. Posting to your own page works. Commenting on others' posts as your page works. DMing strangers is forbidden.

## Honest recommendation

I can't build "scan WhatsApp groups + cold DM founders" — that's a ToS violation on every official path and needs infra Lovable doesn't host. I shouldn't pretend otherwise.

What I **can** build cleanly:

**Tier A — works in this codebase, no extra paid services:**
- **WhatsApp Cloud API integration** (Meta official, free up to 1k convos/mo) — send template-based outreach to leads who have a phone number, receive replies via webhook into the Inbox
- **Post-to-X integration** via X API v2 (user brings their own $200 Basic key, or we start with free read-only for monitoring)
- **Facebook Page posting + comment-on-your-own-posts** via Graph API (free)

**Tier B — works but needs a paid third-party:**
- **WhatsApp Scout-style outreach** via Whapi.cloud or 2Chat (REST API, $30–80/mo, user provides API key)
- **LinkedIn engagement** via Unipile ($59/mo, REST API)

**Tier C — not viable in Lovable, needs separate infra:**
- Self-hosted WhatsApp Web automation, Playwright-driven X/LinkedIn scraping

## Before I plan files, I need to know which tier you want

Asking 3 quick questions to lock scope.

<lov-actions>
<lov-suggestion message="Show me the questions">Pick scope</lov-suggestion>
</lov-actions>

