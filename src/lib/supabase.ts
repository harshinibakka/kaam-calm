import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export type SupabaseConfiguration = "configured" | "missing" | "invalid";

let client: SupabaseClient | null = null;
let configuration: SupabaseConfiguration = "missing";

if (projectUrl && publishableKey) {
  try {
    const parsedUrl = new URL(projectUrl);
    const localHost =
      parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
    if (parsedUrl.protocol !== "https:" && !localHost) {
      throw new Error("Invalid Supabase project URL");
    }
    client = createClient(projectUrl, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    configuration = "configured";
  } catch {
    configuration = "invalid";
  }
}

export const supabase = client;
export const supabaseConfiguration = configuration;
