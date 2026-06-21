
## Quick answers to your questions

**Templates?** No new template needed. `draft-application` already writes a real cover letter into the existing `pitches` table; `send-pitch` sends it through the same Resend pipeline as cold outreach. The "template" *is* the cover-letter prompt. We'll just polish the prompt + subject style so job replies look like a human applicant, not a sales pitch.

**Dedup?** Already inherited for free. `scan-jobs` upserts on `job_posts.url` (no duplicate posts) and creates one `lead` per post; `send-pitch` and `follow-up-tick` both gate on `pitches.lead_id` and a 24h cooldown, so a job lead can't be re-emailed by accident. We just need to extend "have I contacted this company before?" across job leads too (by `apply_email` + domain).

**Follow-ups for jobs?** Currently `follow-up-tick` runs daily with `follow_up_days` per campaign. For the Freelance Jobs campaign we'll set `follow_up_days = 14`, hard-cap follow-ups at 1 (not 3), and skip follow-up entirely if the original send bounced or the post is older than 30 days.

---

## The real question: how do we split 100 Resend emails/day?

Today everything competes for one shared 100/day cap with a "top 3 campaigns by intel score" gate (campaign-tick.ts:555-628). With job hunt added, that gate would let one noisy job-board scan starve your Tech Faculty outreach (or vice versa). Proposed rule:

```text
Resend daily budget: 100
├── reserved_outreach: 60  (Tech Faculty / paid client work — your business)
├── reserved_jobhunt:  25  (Freelance Jobs campaign)
└── flex:              15  (goes to whichever side has higher-priority intel today)
```

Why this split:
- **Outreach pays the bills today.** It gets the bigger floor.
- **Job hunt is compounding** — even 25 well-targeted applications a day is more than most senior engineers send in a week.
- **Flex 15** lets a great signal win: if today's intel scan returns 8 hot fintech leads, flex tilts outreach; if `scan-jobs` finds 12 high-score (≥80) postings, flex tilts job hunt.

Decision happens once per day in a small `budget-allocator` step inside `daily-briefing` (which already runs at 06:00). It writes today's `email_budget` row with `{ outreach_cap, jobhunt_cap }`, and both `campaign-tick` + `follow-up-tick` read it instead of the hard-coded 100.

Flex allocation rule (server-side, no UI knob needed):
```text
score_outreach = max(intel.relevance_score where kind != job_board, last 24h)
score_jobhunt  = max(job_posts.score where created today)
if score_jobhunt - score_outreach >= 15: jobhunt gets flex (40 total)
else if score_outreach - score_jobhunt >= 15: outreach gets flex (75 total)
else: split flex 8/7
```

You can override per-day from chat: "agent, give job hunt 50 today" → updates `email_budget` row.

---

## Job-hunt-specific tweaks

1. **Cross-lead dedupe by company.** Before `scan-jobs` creates a lead from a `job_post`, check `leads.contact_email` domain and `leads.business_name` against existing leads for the same user. If matched, attach the job_post to the existing lead instead of creating a new one (so applying to Stripe twice in a month doesn't double-send).

2. **Follow-up cadence.** New `campaigns.follow_up_days = 14`, `max_follow_ups = 1` for `mode='job_hunt'`. `follow-up-tick` already respects per-campaign `follow_up_days`; we'll just add a `max_follow_ups` column read.

3. **Reply tracking.** Already works — `gmail-reply-sync` + `classify-reply` will tag job replies. We'll add a `reply_intent` value `'job_interview'` so the dashboard can count interviews separately from outreach replies.

4. **Post freshness gate.** `send-pitch` checks `job_posts.posted_at`; skip + mark `stale` if > 30 days old.

---

## Dashboard telemetry for job hunt

Add a collapsible **"Job Hunt"** panel on `/dashboard`, between the funnel and TopTriggers. Reuses existing tables — no new schema beyond a view.

Stats shown (last 7d / 30d toggle):
- Jobs scanned · Posts matched (score ≥60) · Applications sent · Bounced · Replied · Interviews booked
- Top 3 boards by hit-rate (`remoteok` / `wwr`)
- Average match score of applications sent
- Remaining `jobhunt_cap` for today + small bar showing `25/25` used

The existing funnel card gets a small "Outreach only" subtitle so the two are visually separated, not merged.

---

## What gets built

### Schema (one migration)
- `email_budgets` table: `user_id, date, outreach_cap, jobhunt_cap, outreach_sent, jobhunt_sent`
- `campaigns.max_follow_ups smallint default 3`
- `job_posts.status` adds `'stale'`
- Index on `job_posts(user_id, posted_at)`
- GRANTs + RLS

### Edge functions
- **New `allocate-email-budget`**: called from `daily-briefing`, writes today's `email_budgets` row using the flex rule above.
- **Edit `campaign-tick`**: replace `GLOBAL_DAILY_CAP = 100` with budget lookup; route campaigns by `mode` to the correct bucket.
- **Edit `follow-up-tick`**: same budget-aware cap; honor `max_follow_ups`; for `mode='job_hunt'` use 14-day spacing & cap 1.
- **Edit `scan-jobs`**: dedupe by company domain before lead insert; mark stale posts.
- **Edit `draft-application`**: tighter subject ("Re: <role> — <your name>"), human cover-letter voice, no marketing-speak.
- **Edit `studio-agent`**: add tools `set_email_budget(date, outreach, jobhunt)` and `get_email_budget()` so you can tune from chat.

### UI
- `src/pages/Dashboard.tsx`: add `<JobHuntPanel />` + "Outreach only" label on existing funnel.
- New `src/components/JobHuntPanel.tsx`: stats + today's budget bar.
- `src/pages/Campaigns.tsx`: surface `max_follow_ups` and `follow_up_days` for `mode='job_hunt'` rows (defaults to 14/1, editable).

### Out of scope (for this round)
- Per-board budget splits (e.g., 60% RemoteOK / 40% WWR) — overkill at 25/day.
- Auto-reply to interview offers — too risky, leave manual.
- Buying a second Resend domain to raise the 100 cap — flag it if we ever hit 100 sustained for 7 days.

---

## Recommended defaults (you can tweak any time)

| Setting | Default | Why |
|---|---|---|
| outreach_cap | 60 | protects your paid pipeline |
| jobhunt_cap | 25 | enough to land interviews without burnout |
| flex | 15 | rewards strongest daily signal |
| job follow-up spacing | 14 days | matches industry norm; not annoying |
| max job follow-ups | 1 | one polite nudge then move on |
| stale post threshold | 30 days | don't apply to zombie listings |
| min apply score | 60 | already in `scan-jobs` |

If you approve, I'll implement everything above in one pass.
