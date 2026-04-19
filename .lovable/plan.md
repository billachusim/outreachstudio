
User asks about sending pitches. Currently NOTHING sends — pitches just save to DB. The `pitches` table has `sent_at` but nothing populates it. No email integration exists.

Need to plan: email sending (single + bulk) using Resend connector (recommended path per docs, since Lovable Emails requires workspace admin and user already has bulk-draft pattern). But — Resend needs verified domain to send to real prospects (not just test addresses). Check: leads have `contact_email` field but most leads probably don't have it filled (Firecrawl enrichment hasn't been built yet).

Two real blockers to flag:
1. Most leads have no `contact_email` (Firecrawl step skipped)
2. Sending to cold prospects requires a verified sending domain in Resend (can't use onboarding@resend.dev for real outreach — will go to spam / be blocked)

Plan should be honest: explain current state, propose build, flag blockers.

# Sending pitches — current state + plan

## Right now
Pitches are **drafted and saved only** — nothing is sent. The `sent_at` field exists in the database but no send flow is wired up. Bulk drafting works; bulk sending does not exist yet.

## What I'll build

### 1. Email sending via Resend
- Connect the **Resend** connector (one-click, no key to paste)
- New edge function `send-pitch`: takes a pitch ID, sends via Resend, stamps `sent_at`, moves lead status to `contacted`
- Skips leads with no `contact_email` (and tells you which ones)

### 2. Single send
- **"Send"** button next to each saved pitch in the lead drawer
- Confirmation modal showing recipient, subject, body before sending
- Disabled if lead has no `contact_email`

### 3. Bulk send
- New **"Send pitches"** mode on the existing bulk toolbar in Leads
- Select leads → picks each lead's **most recent unsent pitch** → sends sequentially with progress bar (same pattern as bulk draft)
- Daily safety cap (default 50/day, editable) to protect domain reputation
- Skips: leads without email, leads already contacted, leads with no draft

### 4. Inbox view (light)
- Update the existing Inbox page to list sent pitches with timestamps, recipient, status (sent / failed)

## Two things you need to decide / provide

**A. Sending domain (important for cold outreach)**
Resend lets you send from `onboarding@resend.dev` for testing, but real prospects will mark that as spam — and Resend blocks bulk sends from it anyway. For real outreach you need to:
- Add a domain you own (e.g. `pitchdesk.yourdomain.com`) in Resend
- Add 3 DNS records (SPF, DKIM, DMARC) — Resend gives you the exact values

I can build the send flow now using the test sender so you can verify the wiring, then you add your domain when ready. **Or** wait until your domain is verified before building.

**B. Most leads have no email**
Looking at your data, leads from manual entry don't have `contact_email`. Sending needs an address. You have two paths:
- **Now:** manually add emails to a few test leads to validate the send flow
- **Better:** build **Step 2 — Firecrawl enrichment first** to auto-extract emails from lead websites, then wire up sending

## My recommendation
Build in this order:
1. **Firecrawl enrichment** (auto-fills `contact_email` from websites) — no setup beyond connecting Firecrawl
2. **Resend send flow** (single + bulk + inbox) — connect Resend, use test sender first
3. You add your sending domain in Resend when ready, I flip the `from` address

This way bulk sending actually has emails to send to when it ships.

## Files I'll add/edit
- `supabase/functions/send-pitch/index.ts` (new)
- `supabase/functions/enrich-lead/index.ts` (new, if you approve Firecrawl first)
- `src/components/PitchDrawer.tsx` — add Send button per pitch
- `src/components/BulkDraftBar.tsx` — add "Send" mode
- `src/pages/Inbox.tsx` — sent-pitches list

Tell me: **Firecrawl first then Resend**, or **Resend now with manually-added test emails**?
