/**
 * ZenPass Supabase Client
 * PostgreSQL 資料庫連接
 */
const { createClient } = require("@supabase/supabase-js");

let supabase = null;

function getSupabase() {
  if (!supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn(
        "⚠️ Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env",
      );
      return null;
    }
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("✅ Supabase client initialized");
  }
  return supabase;
}

module.exports = { getSupabase, supabase };
