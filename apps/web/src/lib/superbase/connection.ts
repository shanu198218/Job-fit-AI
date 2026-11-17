import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Checks Supabase connectivity and logs the result.
 * Uses auth session lookup (no table access required).
 */
export async function logSupabaseConnection(
  supabase: SupabaseClient,
  context = "supabase",
) {
  try {
    const { error } = await supabase.auth.getSession();
    if (error) {
      console.error(`[${context}] Supabase not connected:`, error.message);
      return false;
    }

    console.log(`[${context}] Supabase connected.`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${context}] Supabase not connected:`, message);
    return false;
  }
}
