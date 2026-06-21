
## Goal

Make replies thread back to the original outreach address (`outreach@techfaculty.ng`) instead of being diverted to `thetechfaculty@gmail.com` via `Reply-To`. This restores clean threading in Resend, in the lead's inbox, and in our own reply tracking.

## Root cause

Both `send-pitch` and `follow-up-tick` currently set `reply_to: "thetechfaculty@gmail.com"` on every outbound email. Resend (and the lead's email client) therefore see two different addresses on the conversation:

- `From: outreach@techfaculty.ng`
- `Reply-To: thetechfaculty@gmail.com`

When the lead hits Reply, the response goes to the Gmail address, so:
- Resend's dashboard/thread view for that send shows no inbound activity.
- The original `outreach@techfaculty.ng` thread looks dead.
- Our system only sees the reply because `gmail-reply-sync` polls the Gmail inbox — if anything in that chain breaks, we silently miss replies and keep sending follow-ups.

## Fix

### 1. Code: drop `Reply-To` on every outbound send
Two edge functions:

- `supabase/functions/send-pitch/index.ts` — remove the `reply_to` field from the Resend payload and delete the `REPLY_TO` constant.
- `supabase/functions/follow-up-tick/index.ts` — same: remove `reply_to` from the Resend payload and delete the `REPLY_TO` constant.

After the change, every outbound (initial pitch + follow-ups) has `From: outreach@techfaculty.ng` and no `Reply-To`, so the reply address defaults to the `From` mailbox. Threading (Message-ID / In-Reply-To / References) is already correct and stays unchanged.

Then redeploy both functions.

### 2. Inbound: forward `outreach@techfaculty.ng` → `thetechfaculty@gmail.com`
You'll set this up at your domain/email host for `techfaculty.ng` (typical options: a single-address forward rule, or a catch-all → Gmail). Once that forward is in place:

- Replies sent to `outreach@techfaculty.ng` land in the same Gmail inbox we already poll.
- `gmail-reply-sync` keeps working with **no code change**. Its matching logic is already:
  1. `In-Reply-To` / `References` → `pitches.message_id_header` (header threading — primary).
  2. Fallback: `from` address → `leads.contact_email`.
  
  Neither path depends on the `To:` address, so forwarded mail matches exactly the same way.

### 3. Sanity check after redeploy
- Send one test pitch to a personal address; confirm the received email shows only `From: outreach@techfaculty.ng` and no `Reply-To` header.
- Reply to it; confirm the reply lands in `thetechfaculty@gmail.com` via the forwarder.
- Trigger `gmail-reply-sync` once and confirm the reply is matched (header path), `leads.status` flips to `replied`, and any scheduled `pitch_sequences` for that lead get cancelled.

## What is NOT changing

- Sending domain, From address, Resend connector, Message-ID format.
- `gmail-reply-sync` logic, polling schedule, or the Gmail connection.
- DB schema, RLS, or any UI.
- Campaigns/cron stay paused (from the earlier halt) until you say "resume."

## Files touched

- `supabase/functions/send-pitch/index.ts`
- `supabase/functions/follow-up-tick/index.ts`

## Your one manual step

Add a forwarder at your DNS/email host for `techfaculty.ng`:  
`outreach@techfaculty.ng` → `thetechfaculty@gmail.com` (catch-all is fine too).
