// Returns true if the user has shown activity in the last `days` days.
// "Activity" = any run_events row, any pitch sent, or any chat_messages row.
// Used by daily cron jobs to skip dormant users and avoid burning AI credits.

export async function isUserActive(
  supabase: any,
  userId: string,
  days = 14,
): Promise<boolean> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [{ count: re }, { count: p }, { count: cm }] = await Promise.all([
    supabase.from("run_events").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", since),
    supabase.from("pitches").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", since),
    supabase.from("chat_messages").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", since),
  ]);
  return (re ?? 0) + (p ?? 0) + (cm ?? 0) > 0;
}

// Filter a list of user IDs to only those active in the window.
export async function filterActiveUsers(
  supabase: any,
  userIds: string[],
  days = 14,
): Promise<string[]> {
  const checks = await Promise.all(userIds.map((id) => isUserActive(supabase, id, days)));
  return userIds.filter((_, i) => checks[i]);
}
