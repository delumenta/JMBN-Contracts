// js/auth.js
const SUPABASE_URL = "https://fcegavhipeaeihxegsnw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjZWdhdmhpcGVhZWloeGVnc253Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxMjk3NTcsImV4cCI6MjA3NzcwNTc1N30.i-ZjOlKc89-uA7fqOIvmAMv60-C2_NmKikRI_78Jei8";

// Detect /<repo>/ base path for GitHub Pages
const parts = location.pathname.split('/').filter(Boolean);
const BASE = (parts.length >= 1) ? ('/' + parts[0] + '/') : '/';

window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" }
});

// Require login; otherwise send to auth.html
window.requireAuth = async function () {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.href = BASE + "auth.html";
    return null;
  }
  return session;
};

// Sign in with username (we append @jmbn.local behind the scenes)
window.signIn = async function (usernameOrEmail, password) {
  const email = usernameOrEmail.includes("@") ? usernameOrEmail : `${usernameOrEmail}@jmbn.local`;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  return { data, error };
};

window.signOut = async function () {
  await sb.auth.signOut();
  location.href = BASE + "auth.html";
};

window.getSession = async function () {
  const { data: { session } } = await sb.auth.getSession();
  return session;
};

// Helper: derive username from session email
window.currentUsername = function (session) {
  return (session?.user?.email || "").split("@")[0] || "";
};
