// Posts text to LinkedIn on the connected member's behalf using the Lovable
// connector gateway. No manual token pasting — LINKEDIN_API_KEY is injected.
//
// Body: { text: string, draftId?: string, leadId?: string, campaignId?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (s: number, p: unknown) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GATEWAY = "https://connector-gateway.lovable.dev/linkedin";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) return json(401, { error: "Unauthorized" });

    const body = (await req.json().catch(() => ({}))) as {
      text?: string; draftId?: string; leadId?: string; campaignId?: string;
    };
    const text = (body.text ?? "").trim();
    if (!text) return json(400, { error: "text is required" });
    if (text.length > 3000) return json(400, { error: "text exceeds 3000 chars" });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const LINKEDIN_API_KEY = Deno.env.get("LINKEDIN_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY not configured" });
    if (!LINKEDIN_API_KEY) return json(500, { error: "LinkedIn not connected. Connect it from the Channels page." });

    const gwHeaders = {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": LINKEDIN_API_KEY,
      "Content-Type": "application/json",
    };

    // 1. Resolve the author URN (LinkedIn member ID) via /v2/userinfo
    const meRes = await fetch(`${GATEWAY}/v2/userinfo`, { method: "GET", headers: gwHeaders });
    const meText = await meRes.text();
    if (!meRes.ok) {
      if (meRes.status === 401 || meText.includes("EXPIRED_ACCESS_TOKEN") || meText.includes("REVOKED_ACCESS_TOKEN")) {
        return json(200, {
          error: "Your LinkedIn connection expired. Reconnect LinkedIn on the Channels page, then try posting again.",
        });
      }
      return json(200, { error: `LinkedIn rejected the request: ${meText}` });
    }
    const me = JSON.parse(meText);
    const memberId = me.sub;
    if (!memberId) return json(500, { error: "Could not resolve LinkedIn member id" });
    const authorUrn = `urn:li:person:${memberId}`;

    // 2. Create the post via /v2/ugcPosts
    const payload = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const postRes = await fetch(`${GATEWAY}/v2/ugcPosts`, {
      method: "POST",
      headers: { ...gwHeaders, "X-Restli-Protocol-Version": "2.0.0" },
      body: JSON.stringify(payload),
    });
    const postText = await postRes.text();
    if (!postRes.ok) {
      return json(postRes.status, { error: `LinkedIn post failed: ${postText}` });
    }
    const postJson = postText ? JSON.parse(postText) : {};
    const postId = postJson.id ?? postRes.headers.get("x-restli-id") ?? null;

    // 3. Update the draft if provided
    if (body.draftId) {
      await supabase.from("social_drafts").update({
        status: "posted",
        posted_at: new Date().toISOString(),
        provider_post_id: postId,
      }).eq("id", body.draftId);
    }

    return json(200, { ok: true, id: postId, author: authorUrn });
  } catch (e) {
    console.error("post-linkedin error", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
