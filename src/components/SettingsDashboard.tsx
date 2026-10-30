import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Settings, SlidersHorizontal, UserRound } from "lucide-react";
import { supabase } from "../lib/supabase";

type Preferences = { roles: string[]; locations: string[]; salary: string };
const emptyPreferences: Preferences = { roles: [], locations: [], salary: "" };

function uniqueValues(values: string[], limit: number): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const clean = value.trim().replace(/\s+/g, " ");
    const key = clean.toLocaleLowerCase();
    if (clean && !unique.has(key)) unique.set(key, clean);
    if (unique.size === limit) break;
  }
  return [...unique.values()];
}

export default function SettingsDashboard({
  userId, email, recovery = false, onRecoveryComplete, onPreferencesSaved,
}: {
  userId: string;
  email?: string;
  recovery?: boolean;
  onRecoveryComplete?: () => void;
  onPreferencesSaved?: (preferences: Preferences) => void;
}) {
  const [emailInput, setEmailInput] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailNotice, setEmailNotice] = useState("");
  const [preferences, setPreferences] = useState<Preferences>(emptyPreferences);
  const [draft, setDraft] = useState<Preferences>(emptyPreferences);
  const [loadingPreferences, setLoadingPreferences] = useState(true);
  const [preferenceReload, setPreferenceReload] = useState(0);
  const [preferencesError, setPreferencesError] = useState("");
  const [preferencesNotice, setPreferencesNotice] = useState("");
  const [editingPreferences, setEditingPreferences] = useState(false);
  const [roleInput, setRoleInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingPreferences(true);
    setPreferencesError("");
    if (!supabase) {
      setPreferencesError("Supabase is not configured. Career preferences were not loaded.");
      setLoadingPreferences(false);
      return () => { active = false; };
    }
    void (async () => {
      try {
        const { data, error } = await supabase.from("job_seeker_profiles")
          .select("preferred_roles,preferred_role,preferred_locations,expected_salary,salary_period")
          .eq("user_id", userId).maybeSingle();
        if (error) throw error;
        if (!active) return;
        const savedRoles = Array.isArray(data?.preferred_roles)
          ? data.preferred_roles.filter((value: unknown): value is string => typeof value === "string")
          : [];
        const roles = uniqueValues(savedRoles.length ? savedRoles : [data?.preferred_role ?? ""], 3);
        const locations = uniqueValues(Array.isArray(data?.preferred_locations)
          ? data.preferred_locations.filter((value: unknown): value is string => typeof value === "string") : [], 10);
        const loaded = { roles, locations, salary: typeof data?.expected_salary === "string" ? data.expected_salary : "" };
        setPreferences(loaded); setDraft(loaded);
        onPreferencesSaved?.(loaded);
      } catch (error) {
        if (active) {
          const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
          if (["PGRST204", "42703"].includes(code)) setPreferencesError(`The preferred_roles field is missing (${code}). Apply 202610270002_preferred_job_roles.sql to the test project, then retry.`);
          else if (["PGRST205", "42P01"].includes(code)) setPreferencesError(`The job_seeker_profiles table is unavailable (${code}). Check that the profile base migrations were applied to the test project.`);
          else if (code === "42501") setPreferencesError("Supabase denied access to your profile preferences (42501). Check the authenticated grants and owner-scoped profile RLS policies.");
          else setPreferencesError(code ? `Could not load your career preferences (database error ${code}). Check your connection and profile permissions, then retry.` : "Could not load your career preferences. Check your connection and profile permissions, then retry.");
        }
      } finally { if (active) setLoadingPreferences(false); }
    })();
    return () => { active = false; };
  }, [userId, preferenceReload, onPreferencesSaved]);

  const requestEmailChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) { setEmailError("Supabase is not configured. The email change was not requested."); return; }
    const requestedEmail = emailInput.trim();
    if (!requestedEmail || requestedEmail.toLocaleLowerCase() === (email ?? "").toLocaleLowerCase()) {
      setEmailError("Enter an email address different from your current address."); return;
    }
    setEmailBusy(true); setEmailError(""); setEmailNotice("");
    try {
      const { error } = await supabase.auth.updateUser({ email: requestedEmail });
      if (error) throw error;
      setEmailNotice(`Supabase accepted the verification request for ${requestedEmail}. Your account email remains ${email || "unchanged"} until verification completes.`);
      setEmailInput("");
    } catch { setEmailError("Could not request an email change. Check the address and your Supabase email verification settings, then try again."); }
    finally { setEmailBusy(false); }
  };

  const requestPasswordReset = async () => {
    if (!supabase || !email) { setPasswordError("A signed-in email address is required to request a password reset."); return; }
    setPasswordBusy(true); setPasswordError(""); setPasswordNotice("");
    try {
      const redirectTo = `${window.location.origin}/?auth=password-reset`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setPasswordNotice("Password reset requested. Follow the secure link in your email; your password has not changed yet.");
    } catch { setPasswordError("Could not request a password reset. Check your connection and the test project's allowed redirect URLs, then try again."); }
    finally { setPasswordBusy(false); }
  };

  const saveNewPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) { setPasswordError("Use at least 8 characters for your new password."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("The password fields do not match."); return; }
    if (!supabase) { setPasswordError("Supabase is not configured. The password was not changed."); return; }
    setPasswordBusy(true); setPasswordError(""); setPasswordNotice("");
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword(""); setConfirmPassword("");
      setPasswordNotice("Your password was updated.");
      onRecoveryComplete?.();
    } catch { setPasswordError("Could not update the password. The reset link may have expired; request a new one and try again."); }
    finally { setPasswordBusy(false); }
  };

  const addToDraft = (kind: "roles" | "locations") => {
    const value = kind === "roles" ? roleInput : locationInput;
    const limit = kind === "roles" ? 3 : 10;
    const current = draft[kind];
    if (!value.trim()) return;
    if (current.length >= limit) { setPreferencesError(`You can add up to ${limit} ${kind === "roles" ? "preferred roles" : "preferred locations"}.`); return; }
    setPreferencesError("");
    const next = uniqueValues([...current, value], limit);
    setDraft((previous) => ({ ...previous, [kind]: next }));
    if (kind === "roles") setRoleInput(""); else setLocationInput("");
  };

  const savePreferences = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const roles = uniqueValues(draft.roles, 3);
    const locations = uniqueValues(draft.locations, 10);
    const salary = draft.salary.trim();
    if (roles.length > 3 || locations.length > 10) { setPreferencesError("Choose no more than three roles and ten locations."); return; }
    if (salary && (!/^\d{1,10}$/.test(salary) || Number(salary) < 0)) { setPreferencesError("Enter an annual salary as a whole number of rupees."); return; }
    if (!supabase) { setPreferencesError("Supabase is not configured. Your preferences were not saved."); return; }
    setSavingPreferences(true); setPreferencesError(""); setPreferencesNotice("");
    const next = { roles, locations, salary };
    try {
      const { error } = await supabase.from("job_seeker_profiles").upsert({
        user_id: userId,
        preferred_roles: roles,
        preferred_role: roles[0] ?? "",
        preferred_locations: locations,
        expected_salary: salary,
        salary_period: salary ? "Per year" : "",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      setPreferences(next); setDraft(next); setEditingPreferences(false); setPreferencesNotice("Career preferences saved.");
      setRoleInput(""); setLocationInput(""); onPreferencesSaved?.(next);
    } catch {
      setPreferencesError("Could not save career preferences. Check the test project's profile migration and your account permissions, then retry.");
    } finally { setSavingPreferences(false); }
  };

  const cancelPreferences = () => { setDraft(preferences); setRoleInput(""); setLocationInput(""); setPreferencesError(""); setEditingPreferences(false); };
  const roleEntry = (roles: string[], setInput: (value: string) => void, input: string, kind: "roles" | "locations", max: number) => (
    <div className="preference-editor-list">
      <div className="preference-chips">{roles.map((item) => <span className="profile-chip" key={item}>{item}<button type="button" aria-label={`Remove ${item}`} onClick={() => setDraft((previous) => ({ ...previous, [kind]: previous[kind].filter((value) => value !== item) }))}>×</button></span>)}</div>
      {roles.length < max && <div className="profile-add-row"><input aria-label={kind === "roles" ? "Add preferred role" : "Add preferred location"} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addToDraft(kind); } }} /><button type="button" className="button button-ghost" onClick={() => addToDraft(kind)}>Add</button></div>}
      <small>{roles.length} of {max} selected</small>
    </div>
  );

  return <section className="dashboard-empty-page settings-page">
    <div className="settings-intro"><span className="dashboard-icon"><Settings size={27} /></span><span className="section-kicker">PREFERENCES</span><h1>Settings</h1><p>Manage your account and the preferences used to prioritize job listings.</p></div>
    <div className="settings-section-grid">
      <section className="settings-card settings-account-card" aria-labelledby="settings-account-heading">
        <span className="settings-card-icon"><UserRound size={19} /></span><h2 id="settings-account-heading">Account &amp; Privacy</h2>
        <dl className="settings-account-detail"><div><dt>Current email</dt><dd>{email || "No authenticated email is available."}</dd></div></dl>
        <form className="settings-form" onSubmit={(event) => void requestEmailChange(event)}><label>New email address<input type="email" autoComplete="email" value={emailInput} onChange={(event) => setEmailInput(event.target.value)} required /></label><button type="submit" className="button button-ghost" disabled={emailBusy}>{emailBusy ? "Requesting…" : "Request email change"}</button></form>
        {emailError && <p role="alert" className="settings-feedback error">{emailError}</p>}{emailNotice && <p role="status" className="settings-feedback">{emailNotice}</p>}
        <section className="settings-subsection" aria-labelledby="settings-mobile-heading"><h3 id="settings-mobile-heading">Mobile number</h3><p>Number changes are paused until phone authentication and SMS delivery are verified in the test project's Supabase settings. Kaam-Calm will not accept an unverified number.</p><span className="settings-status">Verification setup not confirmed</span></section>
        {!recovery && <section className="settings-subsection" aria-labelledby="settings-password-heading"><h3 id="settings-password-heading">Password</h3><p>Request a secure reset link. Your password remains unchanged until you complete verification.</p><button type="button" className="button button-ghost" disabled={passwordBusy} onClick={() => void requestPasswordReset()}>{passwordBusy ? "Requesting…" : "Change password"}</button></section>}
        {passwordError && <p role="alert" className="settings-feedback error">{passwordError}</p>}{passwordNotice && <p role="status" className="settings-feedback">{passwordNotice}</p>}
        {recovery && <form className="settings-form password-recovery-form" onSubmit={(event) => void saveNewPassword(event)}><h3>Choose a new password</h3><label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><button type="submit" className="button button-primary" disabled={passwordBusy}>{passwordBusy ? "Updating…" : "Update password"}</button></form>}
        <section className="settings-subsection" aria-labelledby="settings-privacy-heading"><h3 id="settings-privacy-heading">Privacy</h3><p>Kaam-Calm uses your account to save your profile, job bookmarks, and application confirmations. Profile documents and photos are stored in private buckets and accessed with signed links.</p><p>Data export and account deletion controls are not available in this version.</p></section>
      </section>

      <section className="settings-card career-preferences-card" aria-labelledby="settings-career-heading">
        <span className="settings-card-icon"><SlidersHorizontal size={19} /></span><h2 id="settings-career-heading">Career Preferences</h2>
        <p>These preferences help sort available listings. Recommendations are suggestions, not guaranteed matches.</p>
        {loadingPreferences ? <p role="status">Loading your career preferences…</p> : preferencesError && !editingPreferences ? <div><p role="alert" className="settings-feedback error">{preferencesError}</p><button type="button" className="button button-ghost" onClick={() => { setPreferencesError(""); setLoadingPreferences(true); setPreferenceReload((value) => value + 1); }}>Retry</button></div> : editingPreferences ? <form className="settings-form preferences-form" onSubmit={(event) => void savePreferences(event)}>
          <label>Preferred job roles <small>Choose up to 3</small></label>{roleEntry(draft.roles, setRoleInput, roleInput, "roles", 3)}
          <label>Expected annual salary (₹)<input type="number" min="0" step="1" inputMode="numeric" placeholder="For example, 800000" value={draft.salary} onChange={(event) => setDraft((previous) => ({ ...previous, salary: event.target.value }))} /></label>
          <label>Preferred job locations <small>Choose up to 10</small></label>{roleEntry(draft.locations, setLocationInput, locationInput, "locations", 10)}
          {preferencesError && <p role="alert" className="settings-feedback error">{preferencesError}</p>}
          <div className="settings-form-actions"><button type="button" className="button button-ghost" onClick={cancelPreferences} disabled={savingPreferences}>Cancel</button><button type="submit" className="button button-primary" disabled={savingPreferences}>{savingPreferences ? "Saving…" : "Save preferences"}</button></div>
        </form> : <>
          <dl className="settings-preferences-read"><div><dt>Preferred job roles</dt><dd>{preferences.roles.length ? preferences.roles.join(", ") : "No roles added"}</dd></div><div><dt>Expected annual salary</dt><dd>{preferences.salary ? `₹${Number(preferences.salary).toLocaleString("en-IN")} per year` : "Not specified"}</dd></div><div><dt>Preferred locations</dt><dd>{preferences.locations.length ? preferences.locations.join(", ") : "No locations added"}</dd></div></dl>
          {preferencesNotice && <p role="status" className="settings-feedback">{preferencesNotice}</p>}
          <button type="button" className="button button-primary" onClick={() => { setDraft(preferences); setEditingPreferences(true); setPreferencesError(""); }}>Edit preferences <ArrowRight size={15} /></button>
        </>}
      </section>
    </div>
  </section>;
}
