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
