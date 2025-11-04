// js/auth.js
// ----------------------------------------------------
// Supabase auth bootstrap for JMBN (GitHub Pages safe)
// Exposes helpers on window: getSupabase, requireAuth,
// signIn, signOut, getSession, currentUsername, goto,
// getBasePath
// ----------------------------------------------------

/** ***** CONFIG ***** **/
const SUPABASE_URL = "https://fcegavhipeaeihxegsnw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjZWdhdmhpcGVhZWloeGVnc253Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxMjk3NTcsImV4cCI6MjA3NzcwNTc1N30.i-ZjOlKc89-uA7fqOIvmAMv60-C2_NmKikRI_78Jei8";

/** ***** BASE PATH (works for GitHub Pages repo sites) ***** **/
function getBasePath() {
  // e.g. https://username.github.io/repo-name/page.html -> "/repo-name/"
  // local dev (file:// or localhost) -> "/"
  try {
    const parts = location.pathname.split("/").filter(Boolean);
    const onGithub = /\.github\.io$/.test(location.hostname);
    if (onGithub && parts.length) return "/" + parts[0] + "/";
  } catch {}
  return "/";
}
const BASE = getBasePath();

/** ***** SUPABASE CLIENT ***** **/
if (!window.supabase) {
  console.error(
    "[auth] Supabase JS not loaded. Add <script src=\"https://unpkg.com/@supabase/supabase-js@2\"></script> BEFORE js/auth.js"
  );
}

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true, // handles PKCE redirect fragments
    flowType: "pkce",
    autoRefreshToken: true,
  },
});

// Expose a getter so all pages share the same instance
window.getSupabase = () => _sb;

/** ***** HELPERS ***** **/
window.goto = function goto(path = "") {
  // path like "auth.html" or "/absolute"
  const isAbs = /^\//.test(path);
  location.href = isAbs ? path : BASE + path;
};

window.getBasePath = getBasePath;

window.getSession = async function getSession() {
  const { data } = await _sb.auth.getSession();
  return data?.session ?? null;
};

window.currentUsername = function currentUsername(session) {
  const email = session?.user?.email || "";
  return email.split("@")[0] || "";
};

/** ***** GUARDS ***** **/
window.requireAuth = async function requireAuth() {
  // If the URL contains PKCE params, Supabase will process them because
  // detectSessionInUrl=true; a small delay helps on very fast redirects.
  try {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) {
      goto("auth.html");
      return null;
    }
    return session;
  } catch (e) {
    console.error("[auth] requireAuth failed:", e);
    goto("auth.html");
    return null;
  }
};

/** ***** ACTIONS ***** **/
window.signIn = async function signIn(usernameOrEmail, password) {
  // Accept plain username or full email; append @jmbn.local for usernames
  const email = usernameOrEmail.includes("@")
    ? usernameOrEmail
    : `${usernameOrEmail}@jmbn.local`;

  const { data, error } = await _sb.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
};

window.signOut = async function signOut() {
  try {
    await _sb.auth.signOut();
  } finally {
    goto("auth.html");
  }
};

/** ***** OPTIONAL: auth state listener (for debugging) ***** **/
_sb.auth.onAuthStateChange((event, session) => {
  // console.log("[auth] state:", event, session);
  // You can react to sign-in/out here if needed.
});
