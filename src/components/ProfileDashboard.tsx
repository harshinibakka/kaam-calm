import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase, supabaseConfiguration } from "../lib/supabase";

type Education = { qualification: string; institution: string; field_of_study: string; graduation_year: string; board_university: string; medium: string; marks: string; subject_marks: string };
type Employment = { company: string; role: string; start_date: string; end_date: string; is_current: string; joining_date: string; current_salary: string; previous_salary: string; total_experience: string; skills_used: string; description: string; notice_period: string };
type Project = { title: string; description: string; technologies: string; url: string };
type LinkItem = { name: string; url: string };
type Accomplishment = { kind: string; title: string; description: string; url: string; date: string };
type Profile = {
  full_name: string; phone: string; location: string; headline: string; summary: string;
  skills: string[]; education: Education[]; employment: Employment[]; projects: Project[];
  preferred_role: string; preferred_locations: string[]; expected_salary: string;
  salary_period: string; preferred_shift: string; job_type: string; employment_type: string; work_mode: string;
  certifications: LinkItem[]; portfolio_links: LinkItem[]; languages: string[]; accomplishments: Accomplishment[];
  gender: string; date_of_birth: string; address: string; city: string; state: string; pincode: string;
};

const blankProfile: Profile = {
  full_name: "", phone: "", location: "", headline: "", summary: "", skills: [], education: [], employment: [], projects: [],
  preferred_role: "", preferred_locations: [], expected_salary: "", salary_period: "", preferred_shift: "", job_type: "", employment_type: "", work_mode: "", certifications: [], portfolio_links: [], languages: [], accomplishments: [],
  gender: "", date_of_birth: "", address: "", city: "", state: "", pincode: "",
};
const sectionFields: Record<string, Array<keyof Profile>> = {
  basics: ["full_name", "phone", "location", "headline"], skills: ["skills"], education: ["education"], employment: ["employment"],
  projects: ["projects"], preferences: ["preferred_role", "preferred_locations", "expected_salary", "salary_period", "preferred_shift", "job_type", "employment_type", "work_mode"],
  summary: ["summary"], credentials: ["certifications", "portfolio_links", "languages"], personal: ["gender", "date_of_birth", "address", "city", "state", "pincode"], accomplishments: ["accomplishments"],
};
const labels: Record<keyof Profile, string> = {
  full_name: "Full name", phone: "Phone (optional)", location: "Location", headline: "Professional headline", summary: "Profile summary", skills: "Key skills",
  education: "Education", employment: "Employment history", projects: "Projects", preferred_role: "Preferred role", preferred_locations: "Preferred locations",
  expected_salary: "Expected salary", salary_period: "Salary period", preferred_shift: "Preferred shift", job_type: "Job type", employment_type: "Employment type", work_mode: "Work mode", certifications: "Certifications", portfolio_links: "Online portfolio links", languages: "Languages", accomplishments: "Accomplishments",
  gender: "Gender (optional)", date_of_birth: "Date of birth (optional)", address: "Address (optional)", city: "City", state: "State", pincode: "PIN code",
};
const fields: Record<string, Array<{ key: string; label: string; kind?: string }>> = {
  education: [{ key: "qualification", label: "Qualification" }, { key: "institution", label: "School or college" }, { key: "board_university", label: "Board or university" }, { key: "field_of_study", label: "Course or specialization" }, { key: "graduation_year", label: "Passing-out year" }, { key: "medium", label: "School medium" }, { key: "marks", label: "Marks or percentage" }, { key: "subject_marks", label: "Relevant subject marks" }],
  employment: [{ key: "company", label: "Company" }, { key: "role", label: "Job title" }, { key: "is_current", label: "Current role (yes/no)" }, { key: "start_date", label: "Employment start date" }, { key: "end_date", label: "End date (optional if current)" }, { key: "joining_date", label: "Joining date" }, { key: "current_salary", label: "Current salary (optional)" }, { key: "previous_salary", label: "Previous salary (optional)" }, { key: "total_experience", label: "Total experience" }, { key: "skills_used", label: "Skills used" }, { key: "description", label: "Responsibilities", kind: "textarea" }, { key: "notice_period", label: "Notice period" }],
  projects: [{ key: "title", label: "Title" }, { key: "description", label: "Description", kind: "textarea" }, { key: "technologies", label: "Technologies" }, { key: "url", label: "Project URL" }],
  certifications: [{ key: "name", label: "Certification" }, { key: "url", label: "Credential URL" }],
  portfolio_links: [{ key: "name", label: "Portfolio link name" }, { key: "url", label: "URL" }],
  accomplishments: [{ key: "kind", label: "Type" }, { key: "title", label: "Title" }, { key: "description", label: "Description", kind: "textarea" }, { key: "url", label: "Link (optional)" }, { key: "date", label: "Date" }],
};
type SectionKey = keyof typeof sectionFields;
type RepeatKey = "education" | "employment" | "projects" | "certifications" | "portfolio_links" | "accomplishments";

function repeatTemplate(key: RepeatKey): Record<string, string> {
  if (key === "education") return { qualification: "", institution: "", field_of_study: "", graduation_year: "", board_university: "", medium: "", marks: "", subject_marks: "" };
  if (key === "employment") return { company: "", role: "", start_date: "", end_date: "", is_current: "false", joining_date: "", current_salary: "", previous_salary: "", total_experience: "", skills_used: "", description: "", notice_period: "" };
  if (key === "projects") return { title: "", description: "", technologies: "", url: "" };
  if (key === "accomplishments") return { kind: "Certification", title: "", description: "", url: "", date: "" };
  return { name: "", url: "" };
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => typeof entry === "string" ? entry : Object.values(entry as Record<string, unknown>).filter(Boolean).join(" · ")).filter(Boolean).join(", ");
  }
  return typeof value === "string" ? value : "";
}

export default function ProfileDashboard({ userId, email, onProfileChange }: { userId: string; email?: string; onProfileChange?: (name: string, completion: number) => void }) {
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [draft, setDraft] = useState<Profile>(blankProfile);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [listInputs, setListInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setLoadError("");
    if (!supabase || supabaseConfiguration !== "configured") {
      setLoadError("Profile storage is not configured. Add the Supabase project URL and publishable key to your local environment.");
      setLoaded(true);
      return () => { active = false; };
    }
    void (async () => {
      try {
        const { data, error } = await supabase.from("job_seeker_profiles").select("*").eq("user_id", userId).maybeSingle();
        if (error) throw error;
        if (active && data) {
          const loadedProfile = { ...blankProfile, ...data } as Profile;
          setProfile(loadedProfile);
          setDraft(loadedProfile);
        }
      } catch {
        if (active) setLoadError("Could not load your profile. Please refresh and try again.");
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [userId]);

  const completed = useMemo(() => {
    const checks = [profile.full_name, profile.location, profile.headline, profile.summary, profile.skills.length, profile.education.length, profile.employment.length, profile.projects.length, profile.preferred_role, profile.preferred_locations.length, profile.employment_type, profile.work_mode, profile.certifications.length, profile.portfolio_links.length, profile.languages.length, profile.accomplishments.length, profile.city, profile.state];
    return Math.round(checks.filter((value) => Boolean(value && (typeof value !== "string" || value.trim()))).length / checks.length * 100);
  }, [profile]);

  useEffect(() => { onProfileChange?.(profile.full_name, completed); }, [profile.full_name, completed, onProfileChange]);

  const beginEdit = (key: SectionKey) => { setDraft({ ...profile, skills: [...profile.skills], preferred_locations: [...profile.preferred_locations] }); setEditing(key); setSaveError(""); setNotice(""); };
  const cancelEdit = () => {
    if (JSON.stringify(draft) !== JSON.stringify(profile) && !window.confirm("Discard your unsaved changes?")) return;
    setDraft(profile); setEditing(null); setSaveError(""); setListInputs({});
  };
  const update = (key: keyof Profile, value: Profile[keyof Profile]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateEntry = (key: RepeatKey, index: number, field: string, value: string) => {
    const list = [...draft[key]] as Array<Record<string, string>>;
    list[index] = { ...list[index], [field]: value };
    update(key, list as Profile[typeof key]);
  };
  const addEntry = (key: RepeatKey) => update(key, [...draft[key], repeatTemplate(key)] as Profile[typeof key]);
  const removeEntry = (key: RepeatKey, index: number) => update(key, draft[key].filter((_, itemIndex) => itemIndex !== index) as Profile[typeof key]);

  const saveSection = async (event: FormEvent<HTMLFormElement>, key: SectionKey) => {
    event.preventDefault();
    if (!supabase) { setSaveError("Supabase is not configured. Your changes were not saved."); return; }
    if (key === "basics" && !draft.full_name.trim()) { setSaveError("Enter your full name before saving."); return; }
    if (key === "education" && draft.education.some((item) => !item.qualification.trim() || !item.institution.trim())) { setSaveError("Add a qualification and institution to each education entry."); return; }
    if (key === "employment" && draft.employment.some((item) => !item.company.trim() || !item.role.trim() || (item.is_current !== "true" && item.start_date && item.end_date && item.end_date < item.start_date))) { setSaveError("Each role needs a company and title. Check that end dates follow start dates."); return; }
    if (key === "projects" && draft.projects.some((item) => !item.title.trim())) { setSaveError("Add a title to each project."); return; }
    if (draft.summary.length > 5000) { setSaveError("Your summary must be 5,000 characters or fewer."); return; }
    setSaving(true); setSaveError(""); setNotice("");
    const payload: Record<string, unknown> = Object.fromEntries(sectionFields[key].map((field) => [field, draft[field]]));
    if (key === "personal" && payload.date_of_birth === "") payload.date_of_birth = null;
    try {
      const { error } = await supabase.from("job_seeker_profiles").upsert({ user_id: userId, ...payload, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      const next = { ...profile, ...payload } as Profile;
      setProfile(next); setDraft(next); setEditing(null); setNotice(`${sectionTitle[key]} saved.`); setListInputs({});
    } catch {
      setSaveError("Could not save your changes. Check your connection and profile table setup, then try again.");
    } finally { setSaving(false); }
  };

  const listEditor = (key: "skills" | "preferred_locations" | "languages", placeholder: string) => (
    <div className="profile-list-editor">
      <div className="profile-chip-list">{draft[key].map((item, index) => <span className="profile-chip" key={`${item}-${index}`}>{item}<button type="button" aria-label={`Remove ${item}`} onClick={() => update(key, draft[key].filter((_, i) => i !== index))}>×</button></span>)}</div>
      <div className="profile-add-row"><input aria-label={`Add ${labels[key].toLowerCase()}`} placeholder={placeholder} value={listInputs[key] ?? ""} onChange={(event) => setListInputs({ ...listInputs, [key]: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const value = listInputs[key]?.trim(); if (value && !draft[key].includes(value)) update(key, [...draft[key], value]); setListInputs({ ...listInputs, [key]: "" }); } }} /><button type="button" className="button button-ghost" onClick={() => { const value = listInputs[key]?.trim(); if (value && !draft[key].includes(value)) update(key, [...draft[key], value]); setListInputs({ ...listInputs, [key]: "" }); }}>Add</button></div>
    </div>
  );

  const sectionTitle: Record<SectionKey, string> = { basics: "Basic details", skills: "Key skills", education: "Education", employment: "Employment history", projects: "Projects", preferences: "Career preferences", summary: "Profile summary", credentials: "Certifications & links", personal: "Personal details", accomplishments: "Accomplishments" };
  const section = (key: SectionKey, content: React.ReactNode) => (
    editing !== null && editing !== key ? null : <section className={`profile-card${editing === key ? " profile-detail-form" : ""}`} aria-labelledby={`profile-${key}`} key={key}>
      <div className="profile-card-heading"><h2 id={`profile-${key}`}>{sectionTitle[key]}</h2>{editing === key ? <span className="profile-form-hint">Update the fields below</span> : <button type="button" className="button button-ghost" onClick={() => beginEdit(key)}>Edit</button>}</div>
      {editing === key ? <form id={`form-${key}`} onSubmit={(event) => void saveSection(event, key)} className="profile-form">{content}</form> : <div className="profile-read">{sectionFields[key].map((field) => <div className="profile-read-field" key={field}><span>{labels[field]}</span><p>{displayValue(profile[field]) || <em>Not added yet</em>}</p></div>)}</div>}
    </section>
  );

  const textInput = (key: keyof Profile, multiline = false) => <label className="profile-field" key={key}>{labels[key]}{multiline ? <textarea value={profileFieldText(draft[key])} onChange={(event) => update(key, event.target.value)} rows={4} /> : <input value={profileFieldText(draft[key])} onChange={(event) => update(key, event.target.value)} />}</label>;
  const choiceInput = (key: "employment_type" | "work_mode" | "salary_period" | "preferred_shift" | "job_type", choices: string[]) => <label className="profile-field" key={key}>{labels[key]}<select value={draft[key]} onChange={(event) => update(key, event.target.value)}><option value="">Choose an option</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>;
  const repeatEditor = (key: RepeatKey) => <div className="profile-repeat-list">{draft[key].map((entry, index) => { const values = entry as unknown as Record<string, string>; return <fieldset className="profile-repeat-item" key={`${key}-${index}`}><legend>{labels[key].replace(/s$/, "")} {index + 1}</legend><button type="button" className="profile-remove" onClick={() => removeEntry(key, index)}>Remove</button><div className="profile-form-grid">{fields[key].map((field) => { const options = field.key === "is_current" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : field.key === "kind" ? ["Certification", "Project / work sample", "Research publication", "Patent", "Presentation", "Portfolio item"].map((label) => ({ value: label, label })) : field.key === "qualification" ? ["Class X", "Class XII", "Diploma", "Bachelor's", "Master's", "Doctorate", "Other"].map((label) => ({ value: label, label })) : field.key === "medium" ? ["English", "Hindi", "Regional language", "Other"].map((label) => ({ value: label, label })) : null; return <label className="profile-field" key={field.key}>{field.label}{options ? <select value={values[field.key] ?? ""} onChange={(event) => updateEntry(key, index, field.key, event.target.value)}>{field.key !== "is_current" && <option value="">Choose an option</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.kind === "textarea" ? <textarea rows={3} value={values[field.key] ?? ""} onChange={(event) => updateEntry(key, index, field.key, event.target.value)} /> : <input type={field.key === "start_date" || field.key === "end_date" || field.key === "joining_date" || field.key === "date" ? "date" : field.key === "url" ? "url" : "text"} value={values[field.key] ?? ""} onChange={(event) => updateEntry(key, index, field.key, event.target.value)} />}</label>;})}</div></fieldset>;})}<button type="button" className="button button-ghost" onClick={() => addEntry(key)}>+ Add {labels[key].replace(/s$/, "")}</button></div>;

  if (!loaded) return <section className="profile-page"><p role="status">Loading your profile...</p></section>;
  if (loadError) return <section className="profile-page"><div className="profile-error" role="alert">{loadError}</div><h1>My Profile</h1><p>Signed in as {email}</p></section>;

  return <div className="profile-page">
    <div className="profile-header-card"><div><span className="section-kicker">YOUR CAREER, AT A GLANCE</span><h1>{profile.full_name || "Build your job-seeker profile"}</h1><p className="profile-headline">{profile.headline || "Add a professional headline to introduce yourself."}</p><p>{profile.location || "Add your location"}{email ? ` · ${email}` : ""}</p></div>{editing === null && <button className="button button-primary" onClick={() => beginEdit("basics")}>Edit Profile</button>}</div>
    {editing === null && <section className="profile-completion"><div><div><strong>Profile completion</strong><span>{completed}%</span></div><div className="profile-progress"><span style={{ width: `${completed}%` }} /></div><small>A complete profile helps you keep your experience and goals in one place.</small></div></section>}
    {editing !== null && <div className="profile-detail-heading"><button type="button" className="button button-ghost" onClick={cancelEdit}><ArrowLeft size={16} /> Back to profile</button><p>Changes are saved only after you select Save.</p></div>}
    {saveError && <p className="profile-error" role="alert">{saveError}</p>}{notice && <p className="profile-success" role="status">{notice}</p>}
    <div className="profile-sections">
      {section("basics", <div className="profile-form-grid">{(["full_name", "phone", "location", "headline"] as const).map((key) => textInput(key))}</div>)}
      {section("skills", listEditor("skills", "Add a skill"))}
      {section("education", repeatEditor("education"))}
      {section("employment", repeatEditor("employment"))}
      {section("projects", repeatEditor("projects"))}
      {section("preferences", <div className="profile-form-grid">{textInput("preferred_role")}{textInput("expected_salary")}{choiceInput("salary_period", ["Per year", "Per month", "Per hour"])}{choiceInput("preferred_shift", ["Morning", "Afternoon", "Night"])}{choiceInput("job_type", ["Permanent", "Contract"])}{choiceInput("employment_type", ["Full-time", "Part-time"])}{choiceInput("work_mode", ["On-site", "Hybrid", "Remote"])}{listEditor("preferred_locations", "Add a location")}</div>)}
      {section("summary", textInput("summary", true))}
      {section("credentials", <div className="profile-form-grid">{repeatEditor("certifications")}{repeatEditor("portfolio_links")}{listEditor("languages", "Add a language")}</div>)}
      {section("personal", <div className="profile-form-grid">{textInput("gender")}{<label className="profile-field" key="date_of_birth">{labels.date_of_birth}<input type="date" value={draft.date_of_birth} onChange={(event) => update("date_of_birth", event.target.value)} /></label>}{textInput("address")}{textInput("city")}{textInput("state")}{textInput("pincode")}</div>)}
      {section("accomplishments", repeatEditor("accomplishments"))}
      {editing === null && <section className="profile-card"><div className="profile-card-heading"><h2>Resume</h2><span className="profile-badge">Uploads unavailable</span></div><p>Resume uploads are not enabled. Your files will not be stored until private storage and access policies are configured.</p></section>}
    </div>
    {editing !== null && <div className="profile-form-actionbar"><button type="button" className="button button-ghost" onClick={cancelEdit}>Cancel</button><button type="submit" form={`form-${editing}`} className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button></div>}
  </div>;
}

function profileFieldText(value: unknown): string { return typeof value === "string" ? value : ""; }
