## Goal

Resume the outreach engine under the new rules (100/day cap, top-3 by intel score, lead-score ordering, 14-day cross-campaign dedup) with a clean slate so old paused campaigns don't clog the priority gate.

## Step 1 — Archive the old backlog (data change)

- Set `campaigns.status = 'archived'` for every campaign currently `paused` (187 rows). These were drafted under the old rules with no intel link, so they'd just lose the priority gate every day and clutter logs.
- Set `campaign_runs.state = 'done'` for every run currently `paused` (92 rows). Their campaigns are now archived; runs left in `paused` would otherwise keep getting picked up by `campaign-tick`.
- Cancel any leftover `pitch_sequences` with `status = 'scheduled'` belonging to those archived campaigns (set to `cancelled`, reason `'campaign archived during reset'`). Already-replied leads are unaffected.

Nothing is deleted — everything stays visible under the "Archived" tab on the Campaigns page if you want to inspect it later.

## Step 2 — Re-enable the 3 cron jobs

Schedule these in `cron.job` (currently missing):

```text
campaign-tick           */2 * * * *     every 2 minutes
follow-up-tick          */10 * * * *    every 10 minutes
auto-launch-top-triggers 0 6 * * *      daily at 06:00 UTC (~07:00 WAT)
```

`auto-launch-top-triggers` will then spawn fresh campaigns each morning from the top 3 unacted intel items (relevance_score ≥ 60), and the new priority gate will let them all run since they each carry a high intel score.

## Step 3 — Verify (read-only checks after enabling)

- `cron.job` now lists all 3 jobs as active
- After the next morning tick: `auto-launch-top-triggers` logs in `edge-function-logs` show campaigns launched
- After `campaign-tick` runs: at most 3 campaigns have `campaign_runs.state = 'sending'`; the rest sit at `queued`/`paused`

## What we are NOT doing

- Not deleting any old data (campaigns, leads, pitches, intel) — only archiving/cancelling
- Not touching replied leads or their inbox threads
- Not changing per-campaign `email_cap` defaults — `auto-launch-top-triggers` will use whatever the launch helper sets, and you can edit per-card on the Campaigns page