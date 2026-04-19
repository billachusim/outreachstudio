import { supabase } from "@/integrations/supabase/client";

export type SeedOffering = {
  title: string;
  tagline: string;
  target_audience: string;
  problem_solved: string;
  pricing: string;
  ideal_customer: string;
  demo_url?: string;
};

export const SEED_OFFERINGS: SeedOffering[] = [
  {
    title: "2nd Baze Garden",
    tagline: "Digital menu & ordering for lounges and restaurants",
    target_audience: "Lounges, restaurants, bars",
    problem_solved: "Slow service, paper menus, missed upsell opportunities",
    pricing: "From ₦50k setup + monthly",
    ideal_customer: "Mid-sized lounges and restaurants in Nigeria",
  },
  {
    title: "Tech Faculty",
    tagline: "Government-licensed AI & tech training for schools and businesses (FMSTI/NBTI partner)",
    target_audience:
      "Two tracks — (1) Businesses: corporates, SMEs, NGOs needing staff upskilling, digitization, IT support, custom software, and a talent pipeline. (2) Schools: universities, secondary schools, and tech clubs needing student bootcamps, curriculum integration, and certified programs.",
    problem_solved:
      "BUSINESS: workforce skill gaps in AI/automation, undigitized operations, weak IT infrastructure, and difficulty hiring pre-screened tech talent. SCHOOLS: outdated curricula, no practical AI/Python exposure, students graduating without industry-recognized certifications or employable tech skills.",
    pricing:
      "Custom per engagement. Business: workshops (2–5 days), corporate staff training, business digitization, IT support retainers, custom software builds. Schools: per-program pricing for Python & Computer Vision bootcamps (2–4 wks), AI/ML workshops (1–2 wks), semester-long curriculum integration, certification programs.",
    ideal_customer:
      "BUSINESS: companies upskilling teams in AI/automation, digitizing operations, or hiring vetted tech talent. SCHOOLS: universities and secondary schools wanting hands-on Python, computer vision, AI/ML bootcamps on campus, plus government-recognized student certifications.",
    demo_url: "https://techfaculty.ng",
  },
  {
    title: "RetailOS",
    tagline: "Intelligent shelf platform for supermarkets",
    target_audience: "Supermarket chains, FMCG distributors",
    problem_solved: "Stock-outs, planogram drift, blind shelf analytics",
    pricing: "Pilot pricing on request",
    ideal_customer: "Supermarket chains with 3+ stores",
  },
  {
    title: "Free Landing Pages for Businesses",
    tagline: "A free, conversion-ready landing page for your business — live in 48 hours",
    target_audience: "SMEs, solopreneurs, event organizers, new product launches, churches, schools, lounges",
    problem_solved:
      "Businesses with no web presence, slow developers, or expensive agency quotes — losing customers because they can't be found, can't share a link, or can't capture leads online.",
    pricing:
      "Free: 1 landing page, mobile-responsive, 1 round of revisions, hosted on a free subdomain. Paid upsells: custom domain, email capture wired to CRM, multi-page site, branding, monthly maintenance.",
    ideal_customer:
      "Businesses with a clear offer (menu, service, event, product) but no landing page yet — perfect foot-in-the-door before pitching paid services.",
  },

  // ============= Social Faculty =============
  {
    title: "Eavesdrop",
    tagline: "Anonymous live conversations — drop in, listen, speak up",
    target_audience: "Gen Z and millennial users in Africa wanting unfiltered live talk; communities, fan groups, niche tribes",
    problem_solved:
      "Social platforms today are performative — people self-censor under their real identity. Eavesdrop creates safe rooms where people speak honestly, vent, debate, and connect without the social cost.",
    pricing: "Free consumer app; future revenue via creator rooms, premium features, and brand-sponsored conversations",
    ideal_customer: "18–34 mobile-first African users; community managers and creators looking for authentic audio engagement",
  },
  {
    title: "Alter Ego",
    tagline: "Discover the version of you you've been hiding",
    target_audience: "Self-aware Gen Z and millennials interested in identity, growth, and self-expression",
    problem_solved:
      "Most social apps reward a single curated identity. Alter Ego lets users explore parallel sides of themselves through structured prompts, journaling, and persona discovery — turning self-reflection into a daily habit.",
    pricing: "Freemium consumer app; premium features for deeper personality insights and persona analytics",
    ideal_customer: "Young adults exploring identity, mental wellness, and personal branding",
  },
  {
    title: "Dear Claire",
    tagline: "Your anonymous diary — read by a human, not a bot",
    target_audience: "Anyone needing a safe, non-AI listening ear; mental wellness seekers; teens and young adults",
    problem_solved:
      "AI chatbots feel empty for emotional support, and therapy is expensive and stigmatized. Dear Claire is a NOT-AI, fully human-guided anonymous diary where users write to a real listener and receive thoughtful, human replies.",
    pricing: "Freemium with paid tiers for faster response and deeper sessions",
    ideal_customer: "Users seeking confidential emotional support without committing to therapy or fearing AI hallucination",
  },
  {
    title: "AI Clopedia",
    tagline: "An AI assistant for public learning — ask, learn, share",
    target_audience: "Students, lifelong learners, teachers, content creators in Africa",
    problem_solved:
      "Curated knowledge online is fragmented and Western-biased. AI Clopedia answers questions in plain language with African context and lets answers be shared and improved publicly.",
    pricing: "Freemium consumer; institutional pricing for schools and edtech partners",
    ideal_customer: "Schools, edtech orgs, and students hungry for accessible AI-powered learning",
  },

  // ============= Tech Faculty (additional) =============
  {
    title: "Palmshop NG",
    tagline: "E-commerce platform for palm products — farm to doorstep",
    target_audience: "Palm oil producers, distributors, retailers, and bulk buyers across Nigeria",
    problem_solved:
      "Palm product trade is fragmented across informal middlemen with opaque pricing and poor logistics. Palmshop NG digitizes ordering, payment, and delivery so producers reach buyers directly with transparent pricing.",
    pricing: "Commission per transaction + premium seller subscriptions",
    ideal_customer: "Palm oil mills, processors, wholesalers, and HORECA buyers wanting consistent supply",
  },
  {
    title: "Nkwo Nnewi App",
    tagline: "The digital backbone of Nnewi market — orders, inventory, payments",
    target_audience: "Traders and buyers in Nnewi market (auto parts, electronics, hardware)",
    problem_solved:
      "Nnewi market runs on paper, cash, and phone calls — buyers in Lagos/Abuja can't browse stock or pay remotely, and traders lose deals to delays. The app brings the entire market online with verified shops, stock listings, and remote payment.",
    pricing: "Free for buyers; subscription + transaction fee for trader shops",
    ideal_customer: "Nnewi market traders wanting national reach; importers and wholesalers across Nigeria sourcing from Nnewi",
  },
  {
    title: "Exams AI",
    tagline: "AI-powered examination & assessment for schools and certification bodies",
    target_audience: "Universities, secondary schools, professional bodies, training providers, government exam boards",
    problem_solved:
      "Exam creation, invigilation, and grading are slow, expensive, and inconsistent. Exams AI auto-generates question banks, runs proctored online tests, and grades objectively — cutting cycle time from weeks to hours.",
    pricing: "Per-candidate pricing + institutional licenses; custom for government bodies",
    ideal_customer: "Tertiary institutions, certification councils, and corporate training providers running frequent assessments",
  },

  // ============= PR Faculty =============
  {
    title: "AutoPR",
    tagline: "AI-automated PR — press releases, media pitches, and reputation monitoring",
    target_audience: "Startups, SMEs, agencies, public figures, and brands across Africa needing consistent PR without an in-house team",
    problem_solved:
      "Hiring a PR agency costs ₦500k–₦2M/month and most SMEs/founders skip PR entirely. AutoPR generates press releases, automates media pitches to journalists, distributes via news wires, monitors brand mentions, and runs crisis comms protocols — at a fraction of agency cost.",
    pricing:
      "Tiered subscription: starter (releases + monitoring), growth (pitch automation + wire distribution), enterprise (crisis comms + dedicated strategist)",
    ideal_customer: "Funded startups, SMEs ready to scale visibility, agencies wanting to white-label PR ops, and public figures needing always-on reputation management",
  },
];

/**
 * Inserts any missing seed offerings (matched by title) for the user.
 * Existing rows are never overwritten — safe to call on every load.
 * If `force` is true, existing seed-titled rows are updated to current defaults.
 */
export async function seedOfferingsIfEmpty(userId: string, force = false) {
  const { data: existing, error } = await supabase
    .from("offerings")
    .select("id, title")
    .eq("user_id", userId);
  if (error) return;

  const byTitle = new Map((existing ?? []).map((o) => [o.title, o.id]));

  const toInsert = SEED_OFFERINGS.filter((s) => !byTitle.has(s.title)).map((s) => ({
    ...s,
    user_id: userId,
    status: "active",
  }));
  if (toInsert.length) {
    await supabase.from("offerings").insert(toInsert);
  }

  if (force) {
    for (const seed of SEED_OFFERINGS) {
      const id = byTitle.get(seed.title);
      if (!id) continue;
      await supabase.from("offerings").update({ ...seed, status: "active" }).eq("id", id);
    }
  }
}
