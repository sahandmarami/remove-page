import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client — single browser instance shared across the app.
 *
 * NOTE ON SECURITY: the publishable key below is PUBLIC BY DESIGN (it is the
 * successor of the "anon key"). Shipping it inside a static site is the
 * standard, documented Supabase pattern — every sensitive operation is
 * enforced server-side by Supabase Auth (password hashing, JWT sessions,
 * rate limits) and by Row Level Security on any future tables. The secret
 * key must never be placed anywhere near client code.
 */
const SUPABASE_URL = "https://kxsriuesccdzbqxvjjlw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_75gERTh3Ofelgn2HFyhZZA_cfx9YFRy";

/** where confirmation/recovery links should land (must also be whitelisted
 *  in Dashboard → Authentication → URL Configuration → Redirect URLs) */
export const SITE_URL = "https://removepage.kdns.fr/";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // implicit flow: confirmation links keep working even when the user
    // opens them on a different device/browser than the one they signed up from
    flowType: "implicit",
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "remove-page-auth",
  },
});
