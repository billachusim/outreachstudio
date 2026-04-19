import { supabase } from "@/integrations/supabase/client";

export type SeedMemory = {
  slug: string;
  title: string;
  kind: "identity" | "personality" | "portfolio" | "playbook" | "note";
  content: string;
};

export const SEED_MEMORIES: SeedMemory[] = [
  {
    slug: "identity",
    title: "Identity — Who Bill is",
    kind: "identity",
    content: `# Identity

**Operator:** Bill Achusim
**Studio:** Outreach Studio (this app) is the command center for Bill's portfolio of African tech, social, and PR products.

## Faculty structure

- **Tech Faculty** — coding powerhouse and parent org of the SE campus. Builds all software, runs training, and is government-licensed (FMSTI/NBTI partner) for AI & tech education.
- **Social Faculty** — consumer-facing social interaction apps.
- **PR Faculty** — communications powerhouse driving strategic messaging, brand visibility, and automated PR across Africa.

## Geographic focus

Primary: Nigeria (Lagos, Abuja, Port Harcourt, Ibadan, Kano, Enugu, Nnewi).
Secondary: rest of Africa.

## Mission

Build, ship, and sell tools that solve real African business and education problems — and automate every repeatable outreach motion behind those tools.
`,
  },
  {
    slug: "personality",
    title: "Personality & Tone",
    kind: "personality",
    content: `# Personality & Tone

## Voice
- Founder-style, direct, no fluff.
- Short sentences. Active voice.
- Nigerian business context — naira pricing, local cities, local examples.
- Value-first: lead with what the reader gets, not what we sell.

## Email & DM rules
- Subject lines under 60 chars, no spammy words ("free", "guaranteed", excessive emoji).
- Body under 150 words.
- One clear CTA per message — usually a 15-min call.
- Always sign off with name + role + one link (demo or site).
- Personalize the first line with something specific to the recipient (their store, their post, their city).

## Engagement ratio
- 80% value-add, 20% self-promotion. Never spam.
- Comment quality: praise specific point + add unique insight + ask thoughtful question.

## Hard nos
- No false personas.
- No exploiting confidential info.
- No buying lists or scraping in violation of robots.txt.
- Honor opt-outs within 48 hours.
`,
  },
  {
    slug: "portfolio",
    title: "Product Portfolio",
    kind: "portfolio",
    content: `# Bill's Product Portfolio

## I. Social Faculty Apps
1. **Eavesdrop** — anonymous live conversations platform.
2. **Alter Ego** — identity discovery application.
3. **Dear Claire** — anonymous social diary, human-guided (NOT AI-based).
4. **AI Clopedia** — AI assistant for public learning.

## II. Tech Faculty Projects
1. **Palmshop NG** — e-commerce platform for palm products.
2. **RetailOS** — retail OS for supermarket chain management.
3. **Nkwo Nnewi App** — digital platform for Nnewi market operations.
4. **Exams AI** — AI-powered examination & assessment platform.
5. **Tech Faculty NG** — government-licensed AI/tech training; online course sales platform (techfaculty.ng).
6. **2nd Baze Garden** — digital menu & ordering for lounges/restaurants.
7. **Free Landing Pages** — free 48-hour landing page as a foot-in-the-door offer.

## III. PR Faculty
1. **AutoPR** — AI-automated PR: press release generation, media pitch automation, news-wire distribution, reputation monitoring, crisis comms.

## IV. Outreach Scopes
- **Business integration (Africa):** strategic partnerships, C-suite relationships, enterprise/SME expansion.
- **School outreach (Africa):** university & secondary partnerships, STEM programs, student mentorship, scholarships.
`,
  },
  {
    slug: "playbook",
    title: "Operations Playbook (SOPs)",
    kind: "playbook",
    content: `# Operations Playbook

Condensed SOPs from the Browser Operations Protocol. Use these to decide which automation to run, when, and what KPIs to chase.

## 1. WhatsApp Scout
- **Goal:** find partnership/training/developer leads in WA groups.
- **Keywords:** partnership, training, developer, tech, skills, web, data, cybersecurity.
- **Filters:** active groups (5+ msgs/day), decision-makers, Nigeria/Africa first.
- **Trigger:** Mon & Thu mornings 9–11 AM.
- **KPI:** 30–50% reply rate, 10–15% quality conversations.
- **Status:** NOT YET AUTOMATED (needs WhatsApp Web automation).

## 2. Social Engagement (X / LinkedIn / FB / IG)
- **Goal:** high-status commenting on peer & influencer posts.
- **Comment formula:** specific praise + unique insight + thoughtful question.
- **Schedule:** 9 AM, 12:30 PM, 6 PM Nigerian time.
- **KPI:** 5–8% engagement on own posts, 20–30% reply rate, 15–25 new connections/wk.
- **Status:** NOT YET AUTOMATED (needs X API + LinkedIn manual).

## 3. RetailOS Lead Hunter
- **Goal:** scrape supermarket manager contacts for RetailOS pitch.
- **Sources:** Yellow Pages NG, Google Maps, LinkedIn, chamber directories.
- **Cities:** Lagos (Ikeja, Lekki, VI, Surulere), Abuja, PH, Ibadan, Kano, Enugu.
- **Tiering:** chains 5+ stores = Tier 1, 2–5 = Tier 2, independents = Tier 3.
- **KPI:** 50 contacts/wk, 30 verified, 25 emails sent, 15–25% reply rate.
- **Status:** AUTOMATED via campaigns + discover-leads engine.

## 4. cPanel Ops
- **Goal:** website admin, domain maintenance, troubleshooting.
- **Daily:** uptime, error logs, resource usage, SSL.
- **Weekly:** full backup, CMS updates, form tests.
- **Trigger:** Sat mornings + alert-driven.
- **Status:** NOT YET AUTOMATED (needs cPanel UAPI per domain).

## 5. Competitor Intel
- **Goal:** monitor startup news, founders, funding, sector moves.
- **Sources:** TechCabal, Disrupt Africa, Nairametrics, Crunchbase, X founder lists.
- **Schedule:** 9 AM / 1 PM / 4 PM scans, Fri deep-dive.
- **Status:** READY TO BUILD (Firecrawl + scheduled cron).
`,
  },
];

export async function seedAgentMemoryIfEmpty(userId: string, force = false) {
  const { data: existing, error } = await supabase
    .from("agent_memories")
    .select("id, slug")
    .eq("user_id", userId);
  if (error) return;

  const bySlug = new Map((existing ?? []).map((m) => [m.slug, m.id]));

  const toInsert = SEED_MEMORIES.filter((s) => !bySlug.has(s.slug)).map((s) => ({
    ...s,
    user_id: userId,
  }));
  if (toInsert.length) {
    await supabase.from("agent_memories").insert(toInsert);
  }

  if (force) {
    for (const seed of SEED_MEMORIES) {
      const id = bySlug.get(seed.slug);
      if (!id) continue;
      await supabase
        .from("agent_memories")
        .update({ title: seed.title, kind: seed.kind, content: seed.content })
        .eq("id", id);
    }
  }
}
