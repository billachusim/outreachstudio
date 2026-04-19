

Plan: switch sender to your verified Resend domain.

## What changes

Two files, one constant each:

- `supabase/functions/send-pitch/index.ts` — change `FROM` from `Pitchdesk <onboarding@resend.dev>` to use `techfaculty.ng`
- `supabase/functions/campaign-tick/index.ts` — same change wherever it sends

Then redeploy both functions.

## What I need you to pick

**1. From-address local part** — what comes before `@techfaculty.ng`?
   - `bill@techfaculty.ng` (personal, best for cold outreach reply rates)
   - `hello@techfaculty.ng` (friendly, generic)
   - `outreach@techfaculty.ng` (clear intent)
   - Something else you tell me

**2. Display name** — what shows in the inbox before the email?
   - `Bill` (just your name — feels personal, best for cold)
   - `Bill at TechFaculty`
   - `TechFaculty`
   - Something else

**3. Reply-to** — where do replies land? Default = same as From. If you want replies to go to a different address (e.g. your Gmail), tell me which.

## Deliverability notes (important, no code change)

- Verifying the domain in Resend gives you SPF + DKIM. **Add a DMARC record** at your DNS too (`_dmarc.techfaculty.ng` TXT `v=DMARC1; p=none; rua=mailto:you@techfaculty.ng`) — without it, Gmail/Outlook downgrade your score.
- New domain = cold reputation. Sending 50/day from day one will land in spam. Ramp: 5/day for 3 days → 15 → 30 → 50. I can lower the daily cap default in the engine if you want.
- Avoid spammy words in subject lines and keep bodies under ~150 words with a real signature.

## After you answer

I'll update both functions with the chosen From + display name + reply-to, redeploy them, and confirm the next outreach run will send from `techfaculty.ng`. Total: ~30 seconds of actual work.

