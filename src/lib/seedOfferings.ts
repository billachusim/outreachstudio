import { supabase } from "@/integrations/supabase/client";

const SEED = [
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
    tagline: "Tech trainings for individuals, schools, and organizations",
    target_audience: "Schools, NGOs, corporates, individuals",
    problem_solved: "Talent gap in modern tech skills",
    pricing: "Custom per cohort",
    ideal_customer: "Schools running tech clubs, orgs upskilling staff",
  },
  {
    title: "RetailOS",
    tagline: "Intelligent shelf platform for supermarkets",
    target_audience: "Supermarket chains, FMCG distributors",
    problem_solved: "Stock-outs, planogram drift, blind shelf analytics",
    pricing: "Pilot pricing on request",
    ideal_customer: "Supermarket chains with 3+ stores",
  },
];

/**
 * Seeds the three default offerings the first time a user opens the app.
 * No-op if the user already has any offerings.
 */
export async function seedOfferingsIfEmpty(userId: string) {
  const { count, error: countErr } = await supabase
    .from("offerings")
    .select("id", { count: "exact", head: true });
  if (countErr || (count && count > 0)) return;

  await supabase.from("offerings").insert(
    SEED.map((o) => ({ ...o, user_id: userId, status: "active" }))
  );
}
