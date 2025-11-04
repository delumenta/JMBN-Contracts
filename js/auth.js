// js/auth.js
// ----------------------------------------------------
// Supabase auth bootstrap for JMBN (GitHub Pages safe)
// Exposes on window:
//   sb, getSupabase, getSession, requireAuth, requireElevated,
//   signIn, signOut, currentUsername, getProfile, getRoles,
//   isElevated, goto, getBasePath
// ----------------------------------------------------

/** ***** CONFIG ***** **/
const SUPABASE_URL = "https://fcegavhipeaeihxegsnw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjZWdhdmhpcGVhZWloeGVnc253Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIxMjk3NTcsImV4cCI6MjA3NzcwNTc1N30.i-ZjOlKc89-uA7fqOIvmAMv60-C2_NmKikRI_78Jei8";

/** ***** BASE PATH (works for GitHub Pages repo sites) ***** **/
function getBasePath() {
  try {
    const parts = location.pathname.split("/").filter(Boolean);
    const onGithub = /\.github\.io$/.test(location.hostname);
    if (onGithub && parts.length) return "/" + parts[0] + "/";
  } catch {}
  return "/";
}
const BASE = getBasePath();

/** ***** SUPABASE CLIENT ***** **/
// IMPORTANT: include supabase-js BEFORE this file on every page:
// <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
if (!window.supabase) {
  console.error(
    '[auth] Supabase JS not loaded. Add <script src="https://unpkg.com/@supabase/supabase-js@2"></script> BEFORE js/auth.js'
  );
}
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,    // handle PKCE url fragments
    flowType: "pkce",
    autoRefreshToken: true,
  },
});
window.sb = _sb;                 // convenience alias
window.getSupabase = () => _sb;  // getter for shared client

/** ***** NAV HELPERS ***** **/
window.goto = function goto(path = "") {
  const isAbs = /^\//.test(path);
  location.href = isAbs ? path : BASE + path;
};
window.getBasePath = getBasePath;

/** ***** SESSION HELPERS ***** **/
window.getSession = async function getSession() {
  const { data } = await _sb.auth.getSession();
  return data?.session ?? null;
};
window.currentUsername = function currentUsername(session) {
  const email = session?.user?.email || "";
  return email.split("@")[0] || "";
};

/** ***** PROFILE / ROLES (from public.v_profiles) ***** **/
let _profileCache = null; // cached for the page lifetime

async function _fetchProfile(userId) {
  const { data, error } = await _sb
    .from("v_profiles")
    .select("user_id, display_name, handle, rank_name, rank_grade, roles")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data || null;
}

window.getProfile = async function getProfile() {
  if (_profileCache) return _profileCache;
  const session = await window.getSession();
  if (!session) return null;
  _profileCache = await _fetchProfile(session.user.id);
  return _profileCache;
};

window.getRoles = async function getRoles() {
  const prof = await window.getProfile();
  return prof?.roles || [];
};

window.isElevated = async function isElevated() {
  const roles = await window.getRoles();
  return roles.some((r) => r === "admin" || r === "officer");
};

/** ***** GUARDS ***** **/
window.requireAuth = async function requireAuth() {
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

window.requireElevated = async function requireElevated() {
  const session = await window.requireAuth();
  if (!session) return null;
  try {
    const ok = await window.isElevated();
    if (!ok) {
      const u = new URL(BASE + "mission-log.html", location.origin);
      u.searchParams.set("unauthorized", "1");
      location.href = u.toString();
      return null;
    }
    return session;
  } catch (e) {
    console.error("[auth] role check failed:", e);
    const u = new URL(BASE + "mission-log.html", location.origin);
    u.searchParams.set("unauthorized", "1");
    location.href = u.toString();
    return null;
  }
};

/** ***** ACTIONS ***** **/
window.signIn = async function signIn(usernameOrEmail, password) {
  const email = usernameOrEmail.includes("@")
    ? usernameOrEmail
    : `${usernameOrEmail}@jmbn.local`;

  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  _profileCache = null; // refresh after login
  return { data, error };
};

window.signOut = async function signOut() {
  try {
    await _sb.auth.signOut();
  } finally {
    _profileCache = null;
    goto("auth.html");
  }
};

/** (optional) watch auth changes for debugging */
_sb.auth.onAuthStateChange((_evt, _session) => {
  _profileCache = null; // refresh profile on any state change
});
