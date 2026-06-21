
# Make channels buzz — easiest-wins-first plan

Build in 3 waves, biggest payoff first. Stop after any wave if it's enough.

---

## Wave 1 — WhatsApp outreach (0 new setup) 🟢

**Why first:** Your WhatsApp Business account is already connected and `send-whatsapp` already works. It just isn't being *called* from anywhere meaningful.

**What I'll build:**
1. **"Send WhatsApp" button on every lead** that has a phone number — invokes `send-whatsapp`, logs to `channel_messages`, shows in Inbox.
2. **WhatsApp as a campaign channel.** Add a `channel: 'whatsapp' | 'email'` column to campaigns (or campaign_runs). The `campaign-tick` cron will route phone-only leads to WhatsApp, email-only leads to email, and pick the highest-yield channel for leads with both.
3. **Smart fallback:** if a pitch email bounces or no email exists, auto-fall-back to WhatsApp.
4. **Follow-up cooldown respected** — `follow-up-tick` already supports per-channel 24h cooldown; just extend it.

**You do:** Nothing. Already connected.

---

## Wave 2 — LinkedIn auto-post (1 click) 🟢

**Why second:** LinkedIn is where your B2B intel-reactions belong. Lovable's connector handles OAuth — you click "Connect LinkedIn" once and we're done. No developer console, no token pasting, no review.

**What I'll build:**
1. **Connect LinkedIn** via `standard_connectors--connect linkedin` (1-click OAuth in your browser).
2. **Write `post-linkedin` edge function** that uses the Lovable connector gateway (`/linkedin/v2/ugcPosts`). Auth handled automatically.
3. **Wire it into Social.tsx** — the existing "Auto-post" button on LinkedIn drafts becomes active.
4. **Optional: schedule LinkedIn posts** — daily cron to auto-publish 1 top draft per day so you don't have to click.

**You do:** Click "Connect LinkedIn" once. That's it.

---

## Wave 3 — Telegram broadcast (1 click, bonus) 🟢

**Why include:** Lovable connector, ~30 sec setup, and great for sending intel briefings + campaign alerts to a Telegram channel or group. Bonus channel with near-zero work.

**What I'll build:**
1. Connect Telegram bot via Lovable connector.
2. Add a "Broadcast to Telegram" toggle on intel items + daily briefings.
3. Edge function `post-telegram` using the gateway.

**You do:** Click "Connect Telegram" once + paste your channel/chat ID.

---

## Wave 4 — X / Twitter (optional, only if you want it) 🟡

**Honest take:** Free X API tier allows only ~17 posts/day write. To actually scale you need X Basic ($100/mo). Your `post-x` function is already coded and works — you just need to:
1. Create an X Developer account (free)
2. Create an app with "Read and Write" permissions
3. Paste 4 keys into Channels page

**What I'll build (if you proceed):** Polish the Channels.tsx X form with inline help + a "Test post" button. The posting code itself is done.

**You do:** Decide if X is worth $100/mo to you. If yes, ~10 min of setup at developer.x.com.

---

## Deferred — Instagram & Facebook 🔴

Both require Meta Business Verification (passport/utility bill upload, multi-day review), an Instagram Business account linked to a Facebook Page, a Graph API token with `instagram_content_publish` + `pages_manage_posts` scopes (requires App Review), and Instagram additionally requires images hosted at a public URL (we'd need to add storage).

**Recommendation:** Skip until you genuinely need them. The friction is unavoidable — it's Meta's policy, not a setup we can shortcut. If you do need them later, it's a separate multi-day project, not a "one click" task.

---

## Suggested execution

Do **Wave 1 (WhatsApp)** and **Wave 2 (LinkedIn)** this session — both deliver immediate value, no painful setup. Then decide on Telegram and X based on whether you actually use them.

## Technical notes

- LinkedIn function will use `https://connector-gateway.lovable.dev/linkedin/v2/ugcPosts` with `Authorization: Bearer ${LOVABLE_API_KEY}` + `X-Connection-Api-Key: ${LINKEDIN_API_KEY}`. Auto token refresh, no manual OAuth code.
- WhatsApp wiring is pure plumbing — no new auth, no new functions, just UI buttons + a `channel` column on campaigns and updated cron logic.
- Telegram uses `https://connector-gateway.lovable.dev/telegram/bot{token}/sendMessage` similarly.
- Channels.tsx will keep the manual-creds form for X (and any future custom channels), but gain "Connect with one click" buttons for LinkedIn/Telegram.

Confirm and I'll start with Wave 1 + Wave 2.
