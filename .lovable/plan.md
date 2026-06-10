

## Re-map and enrich existing leads from `users.csv`

You already have **8,258 leads** in the database from this CSV — they're loading on the Leads page (200 at a time, click "Load more" to see further). The problem is the original import mapped only `nickname → business_name` and `email → contact_email`. The rich columns from the CSV (`whatsapp`, `instagram`, `twitter`, `tiktok`, `userType`, `nickname`, `secretCode`, `gender`, `isPremium`, `influencerStatus`, etc.) were dropped.

I'll fix this by re-processing the CSV server-side and updating the existing lead rows in place (no new duplicates).

### What you'll see after the fix

For each row in `users.csv`, the matching lead (matched by email, case-insensitive) gets updated with:

| Lead field | CSV source |
|---|---|
| `contact_name` | `nickname` (trimmed) when present and different from business_name fallback |
| `business_name` | keep current — fallback to `nickname` or `email` local-part if blank |
| `phone` | `whatsapp` (cleaned, e.g. strip spaces; only if it looks like a phone) |
| `instagram_url` | `instagram` (normalized to `https://instagram.com/<handle>` if a bare handle) |
| `x_url` | `twitter` (normalized to `https://x.com/<handle>`) |
| `website` | `tiktok` if a URL, else `https://tiktok.com/@<handle>` (only when no existing website) |
| `notes` | Multi-line block with: `userType`, `gender`, `isPremium`, `influencerStatus`, `secretCode`, `userId`, `referredBy`, `languagePreference`, `moods`, `egoMessage` (only non-empty fields, prefixed `--- Imported profile ---`) |

Rows in the CSV with no email and no existing match are skipped (we can't safely match them otherwise).

### How the fix runs

1. Copy `users.csv` to a working location.
2. Run a one-off Python script that:
   - Parses all 9,593 CSV rows.
   - Pulls all leads for your user from the database (just `id, contact_email, business_name, contact_name, phone, website, instagram_url, x_url, notes`).
   - Builds an email-keyed map and matches CSV rows.
   - For each match, computes only the fields that are currently empty/blank, plus an updated `notes` block.
   - Writes the updates back via `UPDATE` migrations in batches of ~500.
3. Reports: matched, updated, skipped (no email / no match), and a sample of 5 before/after rows for QA.

### Notes & guardrails

- **Non-destructive**: existing non-null fields are preserved (we only fill gaps), except `notes` where we *append* an "Imported profile" block if the CSV has profile data and the block isn't already present.
- **No duplicate leads created** — pure update pass.
- **Phone validation**: `whatsapp` values are kept only if cleaned digits length is 7–15.
- **Social handles**: bare handles (no `http`) get a normalized URL; URLs are kept as-is.
- **Encoding**: file is read as UTF-8 with errors replaced, since the CSV contains accents (e.g. "jéssica", "le métronome").

### Files touched

- No app source files. Database-only update via a one-off script + `UPDATE` migrations scoped to `user_id = 3019e20e-...` (your account).

### After it runs

Open the Leads page, switch to the **All** tab, and you'll see `contact_name`, phone, Instagram/X icons, and a richer profile in the lead detail drawer. The total count stays 8,258.

