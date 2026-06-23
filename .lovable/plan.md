## 1. LinkedIn intel-driven drafts are missing

`draft-social-from-intel` runs as a daily cron, but in cron mode it only drafts **X** posts (line 118 of `supabase/functions/draft-social-from-intel/index.ts` calls `draftOne(..., "x", ...)` and nothing else). LinkedIn drafts only happen if you manually open the Intel drawer and pick LinkedIn.

**Fix:** in the cron branch, draft **both** `x` and `linkedin` for each of the top 2 items per user. The dedupe check already keys per `intel_item_id + platform` (table has a unique index on those), so this won't double-insert.

## 2. Tune character / length guides

Update `platformGuide()` in `draft-social-from-intel/index.ts`:

- **X**: "up to 280 chars (you have X Premium), 1–2 short paragraphs, punchy hook, optional URL at the end, max 2 hashtags."
- **LinkedIn**: "3–4 short paragraphs, ~120–220 words total, strong first-line hook, a perspective/insight, end with a soft question. No hashtag spam, no emoji clutter."

Leave Instagram and Telegram guides as they are.

The 280-char hard cap in `post-x` (`if (b.text.length > 280)`) already matches Premium — no change needed there.

## 3. Twitter auto-posting is not a code bug

`post-x` is wired correctly and the Social-page button does call it. The reason taps appear to do nothing is that **every** recent X attempt returns `403 client-not-enrolled` from `api.x.com/2/tweets`. The error toast does fire ("Your X app is still a standalone app…"), but the underlying issue is on the X Developer Portal side:

> "When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project."

This is fixed in the X Developer Portal, not in our code. Steps (I'll surface these in the toast / Channels page hint, no logic change):

1. developer.twitter.com → Projects & Apps → create a Project (or open the existing one).
2. Attach your existing App to that Project.
3. App → User authentication settings → set permissions to **Read and Write**.
4. **Regenerate** the Access Token + Access Token Secret (the old ones are read-only).
5. In Outreach Studio → Channels, disconnect X and reconnect with the new tokens.

After that, the same button will post successfully — the code path is identical to LinkedIn's.

## Files to touch

- `supabase/functions/draft-social-from-intel/index.ts` — update `platformGuide()` strings; in the cron loop draft both `x` and `linkedin` per top item.

No other backend or UI changes are needed for the posting flow itself.

## Out of scope

- No changes to `post-x`, `post-linkedin`, or `Social.tsx` posting logic.
- Not regenerating existing X drafts that were written to 270 chars — only new drafts (from now on) will use the 280-char guidance.
