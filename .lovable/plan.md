

# CTO Audit & Roadmap

## Where we are (honest snapshot)

**Working well:**
- Discovery → enrich → draft → send pipeline runs end-to-end (67 leads, 19 sent)
- 13 offerings seeded, 4 memory files (identity/personality/portfolio/playbook), Studio Agent with 9 tools
- Channels infra wired (WhatsApp/X/FB/IG functions exist)

**Gaps I found:**
1. **No cron job actually scheduled.** `pg_cron` + `pg_net` are installed but no schedule exists — the engine only ticks when you click. This is the #1 fix.
2. **0 channel accounts connected.** All the social/WhatsApp wiring is dormant.
3. **0 replies ever recorded.** Resend webhook isn't capturing opens/replies, so the funnel ends at "sent" — you never know what works.
4. **Inbox is read-only "sent log"** — not an actual inbox. No reply threading.
5. **Daily cap is per-user across ALL campaigns** (not per-campaign, not per-channel) — easy to silently throttle.
6. **No lead scoring, no dedupe across campaigns, no follow-up sequences.** A lead that goes silent is just… lost.
7. **Agent has read tools but few action tools** — can't draft pitches, can't bulk-update leads, can't post to social, can't trigger enrichment.
8. **No analytics page** — open rate, reply rate, per-offering performance all live in your head.
9. **No competitor / news / trigger-event monitoring** — the doc's whole "PR-driven outreach" idea is unbuilt.

---

## Roadmap — 4 tracks, prioritized

### Track 1 — Make it actually run on autopilot (MUST-HAVE, ship first)

1. **Schedule `campaign-tick` every minute via pg_cron** — the single change that makes everything you built actually autonomous.
2. **Resend webhook handler** — new function `resend-webhook` + a `pitch_events` table. Captures `delivered / opened / clicked / bounced / complained / replied`. Updates `leads.status` automatically.
3. **Real Inbox** — query `pitch_events` + `channel_messages` together, threaded per-lead, mark-as-read, quick-reply box that drafts via AI.
4. **Per-channel daily caps** on `campaigns` (email_cap, whatsapp_cap, social_cap) instead of one global number.

### Track 2 — Smarter leads (HIGH VALUE)

5. **Lead scoring** — new `leads.score` (0-100) computed from: has email ✓, has phone ✓, website live ✓, enrichment summary mentions offering keywords ✓, recent activity ✓. Cron recomputes nightly.
6. **Cross-campaign dedupe** — global unique on `(user_id, root_domain)`. Stops you pitching the same business under two offerings.
7. **Follow-up sequences** — new `pitch_sequences` table: if no reply after N days, auto-draft & send follow-up #1, #2, #3 with different angles. Engine ticks them like normal.
8. **Reply intent classifier** — when a reply comes in, AI tags it `interested / not-interested / unsubscribe / question / out-of-office` and updates `leads.status` + alerts you only on "interested" or "question".
9. **Apollo / Hunter.io email finder** as a second enrichment step when Firecrawl finds no email (your call whether to add — Hunter free tier = 25/mo, paid ~$34/mo).

### Track 3 — Agent superpowers (FUN + LEVERAGE)

Give the Studio Agent these new tools so you can run the studio from chat:
10. `draft_pitch_for_lead`, `send_pitch_now`, `bulk_update_lead_status`, `create_campaign`, `enrich_lead_now`, `send_whatsapp`, `post_to_x`, `post_to_facebook`, `post_to_instagram`, `score_lead`, `summarize_today`, `find_similar_leads`.
11. **Daily morning briefing** — cron at 8am triggers agent to read events from last 24h and post a summary into a new `daily_briefings` table you see on the dashboard ("3 sent, 1 replied (warm), Eavesdrop campaign stalled — needs more leads").
12. **Proactive nudges** — when something happens (reply, bounce, run done), agent decides whether to act or alert you.

### Track 4 — Intel & content (POWERFUL EXTRAS)

13. **Competitor / news monitor** — Firecrawl scheduled scans of Techcabal, Techpoint, BusinessDay tech section daily → new `intel_items` table → agent surfaces relevant ones in the briefing → can draft AutoPR pitches off them automatically.
14. **Auto-content engine** — for any offering, weekly cron drafts 3 X posts + 1 FB/IG post grounded in your memory files; you approve from a queue; auto-posts on schedule.
15. **WhatsApp inbound auto-reply** — webhook already exists; add AI-drafted suggested replies in the inbox, one-click send.
16. **Per-offering dashboard** — funnel chart (discovered → emailed → opened → replied → won), best-performing subject lines, optimal send time.

---

## What I propose we ship in THIS round

To keep the loop tight and high-impact, I'd build **Track 1 entirely + the highest-leverage pieces of Tracks 2 & 3:**

- [ ] Schedule `campaign-tick` cron (every minute)
- [ ] `resend-webhook` function + `pitch_events` table + auto-update lead status on opens/replies
- [ ] Reply intent classifier (AI tags incoming replies)
- [ ] Real threaded **Inbox** (email replies + WhatsApp + social, per-lead threads, AI quick-reply)
- [ ] Per-channel daily caps on campaigns
- [ ] Cross-campaign domain dedupe
- [ ] Lead scoring (computed live + nightly cron)
- [ ] Follow-up sequences (1-2-3 cadence, configurable)
- [ ] Daily morning briefing cron + dashboard widget
- [ ] Expand Studio Agent toolset (~10 new tools listed in #10)

I'll **defer** to a later round (because they need user decisions or paid services):
- Hunter.io enrichment (you'd need to pay)
- Competitor news monitor (worth its own focused round)
- Auto-content engine (needs your approval-flow preferences)
- Per-offering analytics page (better after we have replies data)

## Files this will touch

**New migrations:** `pitch_events`, `pitch_sequences`, `daily_briefings`, `intel_items` (stub for later), `leads.score`, `leads.last_activity_at`, `campaigns.email_cap/whatsapp_cap/social_cap/follow_up_days`, unique index on `(user_id, root_domain(website))`, 2 cron schedules.

**New functions:** `resend-webhook`, `classify-reply`, `score-leads-nightly`, `daily-briefing`, `follow-up-tick`.

**Modified functions:** `campaign-tick` (channel-aware caps, dedupe, sequences hook), `studio-agent` (10 new tools), `whatsapp-webhook` (classify intent, update status).

**Modified pages:** `Inbox.tsx` (full rewrite — threaded), `Dashboard.tsx` (briefing widget + funnel snapshot), `Campaigns.tsx` (per-channel caps + follow-up days), `Leads.tsx` (score column).

## Open questions (1 min)

Before I dive in, one decision shapes the build:

1. **Follow-up cadence default** — Day 3 → Day 7 → Day 14, or tighter (Day 2 → Day 5)?
2. **Briefing time** — 8am Lagos time? Push notification later, for now just on dashboard?
3. **Resend webhook** — I can wire it to a public function endpoint; you'd just paste one URL into Resend dashboard. OK?

If you say "just pick sane defaults and go," I will (Day 3/7/14, 8am WAT, yes wire the webhook URL).

