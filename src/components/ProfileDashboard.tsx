import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ImagePlus, Trash2 } from "lucide-react";
import { supabase, supabaseConfiguration } from "../lib/supabase";
import { PROFILE_DOCUMENT_ACCEPT, PROFILE_DOCUMENT_BUCKET, profileDocumentContentType, profileDocumentPath, validateProfileDocument } from "../lib/profileDocuments";
import { PROFILE_PHOTO_ACCEPT, PROFILE_PHOTO_BUCKET, PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS, profilePhotoContentType, profilePhotoPath, validateProfilePhoto } from "../lib/profilePhotos";

type Education = { qualification: string; institution: string; field_of_study: string; graduation_year: string; board_university: string; medium: string; marks: string; subject_marks: string };
type Employment = { company: string; role: string; start_date: string; end_date: string; is_current: string; joining_date: string; current_salary: string; previous_salary: string; total_experience: string; skills_used: string; description: string; notice_period: string };
type Project = { title: string; description: string; technologies: string; url: string };
type LinkItem = { name: string; url: string };
type Accomplishment = { kind: string; title: string; description: string; url: string; date: string };
type Profile = {
  full_name: string; first_name: string; middle_name: string; last_name: string; avatar_path: string; phone: string; location: string; headline: string; summary: string;
  resume_path: string; resume_file_name: string; resume_file_size: number | null; resume_content_type: string;
  cv_path: string; cv_file_name: string; cv_file_size: number | null; cv_content_type: string;
  skills: string[]; education: Education[]; employment: Employment[]; projects: Project[];
  preferred_role: string; preferred_locations: string[]; expected_salary: string;
  salary_period: string; preferred_shift: string; job_type: string; employment_type: string; work_mode: string;
  certifications: LinkItem[]; portfolio_links: LinkItem[]; languages: string[]; accomplishments: Accomplishment[];
  gender: string; date_of_birth: string; address: string; city: string; state: string; pincode: string;
};

const blankProfile: Profile = {
  full_name: "", first_name: "", middle_name: "", last_name: "", avatar_path: "", resume_path: "", resume_file_name: "", resume_file_size: null, resume_content_type: "", cv_path: "", cv_file_name: "", cv_file_size: null, cv_content_type: "", phone: "", location: "", headline: "", summary: "", skills: [], education: [], employment: [], projects: [],
  preferred_role: "", preferred_locations: [], expected_salary: "", salary_period: "", preferred_shift: "", job_type: "", employment_type: "", work_mode: "", certifications: [], portfolio_links: [], languages: [], accomplishments: [],
  gender: "", date_of_birth: "", address: "", city: "", state: "", pincode: "",
};
const sectionFields: Record<string, Array<keyof Profile>> = {
  basics: ["first_name", "middle_name", "last_name", "phone", "location", "headline"], skills: ["skills"], education: ["education"], employment: ["employment"],
  projects: ["projects"], preferences: ["preferred_role", "preferred_locations", "expected_salary", "salary_period", "preferred_shift", "job_type", "employment_type", "work_mode"],
  summary: ["summary"], credentials: ["certifications", "portfolio_links", "languages"], personal: ["gender", "date_of_birth", "address", "city", "state", "pincode"], accomplishments: ["accomplishments"],
};
const labels: Record<keyof Profile, string> = {
  full_name: "Full name", first_name: "First name", middle_name: "Middle name (optional)", last_name: "Last name (optional)", resume_path: "Resume", resume_file_name: "Resume file", resume_file_size: "Resume size", resume_content_type: "Resume file type", cv_path: "CV", cv_file_name: "CV file", cv_file_size: "CV size", cv_content_type: "CV file type", phone: "Phone (optional)", location: "Location", headline: "Professional headline", summary: "Profile summary", skills: "Key skills",
  avatar_path: "Profile photo", education: "Education", employment: "Employment", projects: "Projects", preferred_role: "Preferred role", preferred_locations: "Preferred locations",
  expected_salary: "Expected salary", salary_period: "Salary period", preferred_shift: "Preferred shift", job_type: "Job type", employment_type: "Employment type", work_mode: "Work mode", certifications: "Certifications", portfolio_links: "Online portfolio links", languages: "Languages", accomplishments: "Accomplishments",
  gender: "Gender (optional)", date_of_birth: "Date of birth (optional)", address: "Address (optional)", city: "City", state: "State", pincode: "PIN code",
};
const fields: Record<string, Array<{ key: string; label: string; kind?: string; required?: boolean }>> = {
  education: [{ key: "qualification", label: "Qualification", required: true }, { key: "institution", label: "School or college", required: true }, { key: "board_university", label: "Board or university" }, { key: "field_of_study", label: "Course or specialization" }, { key: "graduation_year", label: "Passing-out year" }, { key: "medium", label: "School medium" }, { key: "marks", label: "Marks or percentage" }, { key: "subject_marks", label: "Relevant subject marks" }],
  employment: [{ key: "company", label: "Company", required: true }, { key: "role", label: "Job title", required: true }, { key: "is_current", label: "Current role (yes/no)" }, { key: "start_date", label: "Employment start date" }, { key: "end_date", label: "End date (optional if current)" }, { key: "joining_date", label: "Joining date" }, { key: "current_salary", label: "Current salary (optional)" }, { key: "previous_salary", label: "Previous salary (optional)" }, { key: "total_experience", label: "Total experience" }, { key: "skills_used", label: "Skills used" }, { key: "description", label: "Responsibilities", kind: "textarea" }, { key: "notice_period", label: "Notice period" }],
  projects: [{ key: "title", label: "Title", required: true }, { key: "description", label: "Description", kind: "textarea" }, { key: "technologies", label: "Technologies" }, { key: "url", label: "Project URL" }],
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

export default function ProfileDashboard({ userId, email, onProfileChange }: { userId: string; email?: string; onProfileChange?: (name: string, completion: number, avatarPath?: string, greetingName?: string) => void }) {
  const [profile, setProfile] = useState<Profile>(blankProfile);
  const [draft, setDraft] = useState<Profile>(blankProfile);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [listInputs, setListInputs] = useState<Record<string, string>>({});
  const [documentBusy, setDocumentBusy] = useState<"resume" | "cv" | null>(null);
  const [documentError, setDocumentError] = useState("");
  const [documentNotice, setDocumentNotice] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoNotice, setPhotoNotice] = useState("");

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
          const stored = data as Record<string, unknown>;
          const legacyParts = typeof stored.full_name === "string" ? stored.full_name.trim().split(/\s+/).filter(Boolean) : [];
          const loadedProfile = {
            ...blankProfile,
            ...stored,
            avatar_path: typeof stored.avatar_path === "string" ? stored.avatar_path : "",
            first_name: typeof stored.first_name === "string" && stored.first_name ? stored.first_name : legacyParts[0] ?? "",
            middle_name: typeof stored.middle_name === "string" && stored.middle_name ? stored.middle_name : legacyParts.length > 2 ? legacyParts[1] : "",
            last_name: typeof stored.last_name === "string" && stored.last_name ? stored.last_name : legacyParts.length > 2 ? legacyParts.slice(2).join(" ") : legacyParts.length > 1 ? legacyParts.slice(1).join(" ") : "",
          } as Profile;
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
    const checks = [profile.full_name, profile.location, profile.headline, profile.summary, profile.skills.length, profile.education.length, profile.projects.length, profile.preferred_role, profile.preferred_locations.length, profile.employment_type, profile.work_mode, profile.certifications.length, profile.portfolio_links.length, profile.languages.length, profile.accomplishments.length, profile.city, profile.state];
    return Math.round(checks.filter((value) => Boolean(value && (typeof value !== "string" || value.trim()))).length / checks.length * 100);
  }, [profile]);

  useEffect(() => { onProfileChange?.(profile.full_name, completed, profile.avatar_path, [profile.first_name, profile.last_name].filter(Boolean).join(" ")); }, [profile.full_name, profile.first_name, profile.last_name, profile.avatar_path, completed, onProfileChange]);

  useEffect(() => {
    let active = true;
    let refreshTimer = 0;
    setPhotoUrl("");
    if (!supabase || !profile.avatar_path) return () => { active = false; };
    const storageClient = supabase;
    const refresh = async () => {
      try {
        const { data, error } = await storageClient.storage.from(PROFILE_PHOTO_BUCKET).createSignedUrl(profile.avatar_path, PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS);
        if (!active) return;
        if (!error) setPhotoUrl(data?.signedUrl ?? "");
        refreshTimer = window.setTimeout(() => void refresh(), (PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS - 300) * 1000);
      } catch { if (active) setPhotoUrl(""); }
    };
    void refresh();
    return () => { active = false; window.clearTimeout(refreshTimer); };
  }, [profile.avatar_path]);

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
    if (key === "basics" && !draft.first_name.trim()) { setSaveError("Enter your first name before saving."); return; }
    if (key === "education" && draft.education.some((item) => !item.qualification.trim() || !item.institution.trim())) { setSaveError("Add a qualification and institution to each education entry."); return; }
    if (key === "employment" && draft.employment.some((item) => !item.company.trim() || !item.role.trim() || (item.is_current !== "true" && item.start_date && item.end_date && item.end_date < item.start_date))) { setSaveError("Each role needs a company and title. Check that end dates follow start dates."); return; }
    if (key === "projects" && draft.projects.some((item) => !item.title.trim())) { setSaveError("Add a title to each project."); return; }
    if (draft.summary.length > 5000) { setSaveError("Your summary must be 5,000 characters or fewer."); return; }
    setSaveError(""); setNotice("");
    const payload: Record<string, unknown> = Object.fromEntries(sectionFields[key].map((field) => [field, draft[field]]));
    if (key === "basics") {
      const first = draft.first_name.trim(); const middle = draft.middle_name.trim(); const last = draft.last_name.trim();
      payload.first_name = first; payload.middle_name = middle; payload.last_name = last;
      payload.full_name = [first, middle, last].filter(Boolean).join(" ");
      if (String(payload.full_name).length > 160) { setSaveError("Your full name must be 160 characters or fewer."); return; }
    }
    if (key === "preferences") payload.preferred_roles = typeof payload.preferred_role === "string" && payload.preferred_role.trim() ? [payload.preferred_role.trim()] : [];
    if (key === "personal" && payload.date_of_birth === "") payload.date_of_birth = null;
    setSaving(true);
    try {
      const { error } = await supabase.from("job_seeker_profiles").upsert({ user_id: userId, ...payload, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      const next = { ...profile, ...payload } as Profile;
      setProfile(next); setDraft(next); setEditing(null); setNotice(`${sectionTitle[key]} saved.`); setListInputs({});
    } catch {
      setSaveError("Could not save your changes. Check your connection and profile table setup, then try again.");
    } finally { setSaving(false); }
  };

  const uploadDocument = async (kind: "resume" | "cv", file: File) => {
    if (!supabase) { setDocumentError("Supabase is not configured. The document was not uploaded."); return; }
    const validationError = validateProfileDocument(file);
    if (validationError) { setDocumentError(validationError); setDocumentNotice(""); return; }
    setDocumentBusy(kind); setDocumentError(""); setDocumentNotice("");
    const pathField = `${kind}_path` as "resume_path" | "cv_path";
    const nameField = `${kind}_file_name` as "resume_file_name" | "cv_file_name";
    const sizeField = `${kind}_file_size` as "resume_file_size" | "cv_file_size";
    const typeField = `${kind}_content_type` as "resume_content_type" | "cv_content_type";
    const path = profileDocumentPath(userId, kind, file.name);
    try {
      const contentType = profileDocumentContentType(file);
      const { error: uploadError } = await supabase.storage.from(PROFILE_DOCUMENT_BUCKET).upload(path, file, { contentType, upsert: false });
      if (uploadError) throw uploadError;
      const metadata = { [pathField]: path, [nameField]: file.name, [sizeField]: file.size, [typeField]: contentType };
      const { error: saveError } = await supabase.from("job_seeker_profiles").upsert({ user_id: userId, ...metadata, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (saveError) {
        await supabase.storage.from(PROFILE_DOCUMENT_BUCKET).remove([path]);
        throw saveError;
      }
      const oldPath = profile[pathField];
      const next = { ...profile, ...metadata } as Profile;
      setProfile(next); setDraft(next); setDocumentNotice(`${kind === "cv" ? "CV" : "Resume"} uploaded successfully.`);
      if (oldPath && oldPath !== path) {
        const { error: removeError } = await supabase.storage.from(PROFILE_DOCUMENT_BUCKET).remove([oldPath]);
        if (removeError) setDocumentError("The new document is saved, but the previous private file could not be removed. Contact your administrator to clean up the old file.");
      }
    } catch {
      setDocumentError("Upload failed. Confirm the private document migration has been applied and that you are signed in, then try again.");
    } finally { setDocumentBusy(null); }
  };

  const openDocument = async (kind: "resume" | "cv") => {
    if (!supabase) return;
    const path = profile[`${kind}_path` as "resume_path" | "cv_path"];
    if (!path) return;
    setDocumentError("");
    const { data, error } = await supabase.storage.from(PROFILE_DOCUMENT_BUCKET).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { setDocumentError("Could not open the private document. Check storage permissions and try again."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const uploadPhoto = async (file: File) => {
    if (!supabase) { setPhotoError("Supabase is not configured. The photo was not uploaded."); return; }
    const validationError = validateProfilePhoto(file);
    if (validationError) { setPhotoError(validationError); setPhotoNotice(""); return; }
    setPhotoBusy(true); setPhotoError(""); setPhotoNotice("");
    const path = profilePhotoPath(userId, file.name);
    try {
      const { error: uploadError } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).upload(path, file, { contentType: profilePhotoContentType(file), upsert: false });
      if (uploadError) throw uploadError;
      const { error: saveError } = await supabase.from("job_seeker_profiles").upsert({ user_id: userId, avatar_path: path, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (saveError) { await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([path]); throw saveError; }
      const oldPath = profile.avatar_path;
      setProfile((current) => ({ ...current, avatar_path: path })); setDraft((current) => ({ ...current, avatar_path: path }));
      setPhotoNotice("Profile photo updated.");
      if (oldPath && oldPath !== path) {
        const { error: removeError } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([oldPath]);
        if (removeError) setPhotoError("Your new photo is saved, but the previous private photo could not be removed.");
      }
    } catch { setPhotoError("Photo upload failed. Confirm the private profile-photo migration has been applied and try again."); }
    finally { setPhotoBusy(false); }
  };

  const removePhoto = async () => {
    if (!supabase || !profile.avatar_path) return;
    const oldPath = profile.avatar_path;
    setPhotoBusy(true); setPhotoError(""); setPhotoNotice("");
    try {
      const { error } = await supabase.from("job_seeker_profiles").upsert({ user_id: userId, avatar_path: "", updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      setProfile((current) => ({ ...current, avatar_path: "" })); setDraft((current) => ({ ...current, avatar_path: "" }));
      setPhotoNotice("Profile photo removed.");
      const { error: removeError } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([oldPath]);
      if (removeError) setPhotoError("Your profile photo was removed from your profile, but its private file could not be deleted.");
    } catch { setPhotoError("Could not update your profile photo. Your saved photo is unchanged."); }
    finally { setPhotoBusy(false); }
  };

  const listEditor = (key: "skills" | "preferred_locations" | "languages", placeholder: string) => (
    <div className="profile-list-editor">
      <div className="profile-chip-list">{draft[key].map((item, index) => <span className="profile-chip" key={`${item}-${index}`}>{item}<button type="button" aria-label={`Remove ${item}`} onClick={() => update(key, draft[key].filter((_, i) => i !== index))}>×</button></span>)}</div>
      <div className="profile-add-row"><input aria-label={`Add ${labels[key].toLowerCase()}`} placeholder={placeholder} value={listInputs[key] ?? ""} onChange={(event) => setListInputs({ ...listInputs, [key]: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const value = listInputs[key]?.trim(); if (value && !draft[key].some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) update(key, [...draft[key], value]); setListInputs({ ...listInputs, [key]: "" }); } }} /><button type="button" className="button button-ghost" onClick={() => { const value = listInputs[key]?.trim(); if (value && !draft[key].some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) update(key, [...draft[key], value]); setListInputs({ ...listInputs, [key]: "" }); }}>Add</button></div>
      {key === "skills" && listInputs.skills?.trim() && <div className="skill-suggestions" aria-label="Suggested skills">{skillSuggestions(listInputs.skills, draft.skills).map((skill) => <button type="button" key={skill} onClick={() => { update("skills", [...draft.skills, skill]); setListInputs({ ...listInputs, skills: "" }); }}>+ {skill}</button>)}</div>}
    </div>
  );

  const sectionTitle: Record<SectionKey, string> = { basics: "Basic details", skills: "Key skills", education: "Education", employment: "Employment", projects: "Projects", preferences: "Career preferences", summary: "Profile summary", credentials: "Certifications & links", personal: "Personal details", accomplishments: "Accomplishments" };
  const section = (key: SectionKey, content: React.ReactNode) => (
    editing !== null && editing !== key ? null : <section id={`profile-section-${key}`} className={`profile-card${editing === key ? " profile-detail-form" : ""}`} aria-labelledby={`profile-${key}`} key={key}>
      <div className="profile-card-heading"><h2 id={`profile-${key}`}>{sectionTitle[key]}</h2>{editing === key ? <span className="profile-form-hint">Update the fields below</span> : <button type="button" className="button button-ghost" onClick={() => beginEdit(key)}>Edit</button>}</div>
      {editing === key ? <form id={`form-${key}`} onSubmit={(event) => void saveSection(event, key)} className="profile-form">{key === "basics" && <p className="profile-form-hint"><span aria-hidden="true">*</span> Required</p>}{content}</form> : <div className="profile-read">{key === "employment" && profile.employment.length === 0 && <p className="profile-form-hint">Optional. If you are a fresher, you can leave this section empty.</p>}{sectionFields[key].map((field) => <div className="profile-read-field" key={field}><span>{labels[field]}</span><p>{displayValue(profile[field]) || <em>Not added yet</em>}</p></div>)}</div>}
    </section>
  );

  const textInput = (key: keyof Profile, multiline = false) => <label className="profile-field" key={key}>{labels[key]}{key === "first_name" && <span aria-hidden="true"> *</span>}{multiline ? <textarea value={profileFieldText(draft[key])} onChange={(event) => update(key, event.target.value)} rows={4} /> : <input aria-label={key === "first_name" ? labels.first_name : undefined} required={key === "first_name"} aria-required={key === "first_name" || undefined} value={profileFieldText(draft[key])} onChange={(event) => update(key, event.target.value)} />}</label>;
  const choiceInput = (key: "employment_type" | "work_mode" | "salary_period" | "preferred_shift" | "job_type", choices: string[]) => <label className="profile-field" key={key}>{labels[key]}<select value={draft[key]} onChange={(event) => update(key, event.target.value)}><option value="">Choose an option</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>;
  const repeatEditor = (key: RepeatKey) => <div className="profile-repeat-list">{draft[key].map((entry, index) => { const values = entry as unknown as Record<string, string>; return <fieldset className="profile-repeat-item" key={`${key}-${index}`}><legend>{labels[key].replace(/s$/, "")} {index + 1}</legend><button type="button" className="profile-remove" onClick={() => removeEntry(key, index)}>Remove</button><div className="profile-form-grid">{fields[key].map((field) => { const options = field.key === "is_current" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : field.key === "kind" ? ["Certification", "Project / work sample", "Research publication", "Patent", "Presentation", "Portfolio item"].map((label) => ({ value: label, label })) : field.key === "qualification" ? ["Class X", "Class XII", "Diploma", "Bachelor's", "Master's", "Doctorate", "Other"].map((label) => ({ value: label, label })) : field.key === "medium" ? ["English", "Hindi", "Regional language", "Other"].map((label) => ({ value: label, label })) : null; return <label className="profile-field" key={field.key}>{field.label}{field.required && <span aria-hidden="true"> *</span>}{options ? <select required={field.required} aria-required={field.required || undefined} value={values[field.key] ?? ""} onChange={(event) => updateEntry(key, index, field.key, event.target.value)}>{field.key !== "is_current" && <option value="">Choose an option</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.kind === "textarea" ? <textarea rows={3} value={values[field.key] ?? ""} onChange={(event) => updateEntry(key, index, field.key, event.target.value)} /> : <input required={field.required} aria-required={field.required || undefined} type={field.key === "start_date" || field.key === "end_date" || field.key === "joining_date" || field.key === "date" ? "date" : field.key === "url" ? "url" : "text"} value={values[field.key] ?? ""} onChange={(event) => updateEntry(key, index, field.key, event.target.value)} />}</label>;})}</div></fieldset>;})}{key === "employment" && draft.employment.length === 0 && <p className="profile-form-hint">Optional. Freshers can save this section without adding work experience.</p>}<button type="button" className="button button-ghost" onClick={() => addEntry(key)}>+ Add {labels[key].replace(/s$/, "")}</button></div>;

  if (!loaded) return <section className="profile-page"><p role="status">Loading your profile...</p></section>;
  if (loadError) return <section className="profile-page"><div className="profile-error" role="alert">{loadError}</div><h1>My Profile</h1><p>Signed in as {email}</p></section>;

  return <div className="profile-page">
    <div className="profile-header-card"><div><span className="section-kicker">YOUR CAREER, AT A GLANCE</span><h1>{profile.full_name || "Build your job-seeker profile"}</h1><p className="profile-headline">{profile.headline || "Add a professional headline to introduce yourself."}</p><p>{profile.location || "Add your location"}{email ? ` · ${email}` : ""}</p></div>{editing === null && <button className="button button-primary" onClick={() => beginEdit("basics")}>Edit Profile</button>}</div>
    {editing === null && <section className="profile-completion"><div><div><strong>Profile completion</strong><span>{completed}%</span></div><div className="profile-progress"><span style={{ width: `${completed}%` }} /></div><small>A complete profile helps you keep your experience and goals in one place.</small></div></section>}
    {editing !== null && <div className="profile-detail-heading"><button type="button" className="button button-ghost" onClick={cancelEdit}><ArrowLeft size={16} /> Back to profile</button><p>Changes are saved only after you select Save.</p></div>}
    {saveError && <p className="profile-error" role="alert">{saveError}</p>}{notice && <p className="profile-success" role="status">{notice}</p>}
    <div className="profile-sections">
      {editing === null && <section className="profile-card profile-photo-card"><div className="profile-card-heading"><h2>Profile photo</h2><span className="profile-form-hint">Private · JPG, PNG, or WEBP · up to 5 MB</span></div>{photoUrl ? <img className="profile-photo-preview" src={photoUrl} alt="Your profile" /> : <div className="profile-photo-preview profile-photo-placeholder" aria-label="No profile photo">{profile.full_name.trim() ? profile.full_name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "K"}</div>}{photoError && <p className="profile-error" role="alert">{photoError}</p>}{photoNotice && <p className="profile-success" role="status">{photoNotice}</p>}<div className="profile-photo-actions"><label className="button button-primary"><ImagePlus size={16} />{photoBusy ? "Saving…" : profile.avatar_path ? "Replace photo" : "Upload photo"}<input type="file" accept={PROFILE_PHOTO_ACCEPT} disabled={photoBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); event.currentTarget.value = ""; }} /></label>{profile.avatar_path && <button type="button" className="button button-ghost" disabled={photoBusy} onClick={() => void removePhoto()}><Trash2 size={15} /> Remove photo</button>}</div></section>}
      {section("basics", <div className="profile-form-grid">{(["first_name", "middle_name", "last_name", "phone", "location", "headline"] as const).map((key) => textInput(key))}</div>)}
      {editing === null && <section className="profile-card profile-documents"><div className="profile-card-heading"><h2>Resume and CV</h2><span className="profile-form-hint">Private to your account · up to 10 MB each</span></div><p>PDF, DOC, DOCX, or TXT files. Uploads are stored in private Supabase Storage.</p>{documentError && <p className="profile-error" role="alert">{documentError}</p>}{documentNotice && <p className="profile-success" role="status">{documentNotice}</p>}<div className="profile-document-grid">{(["resume", "cv"] as const).map((kind) => { const fileName = profile[`${kind}_file_name` as "resume_file_name" | "cv_file_name"]; return <div className="profile-document" key={kind}><strong>{kind === "cv" ? "CV" : "Resume"}</strong>{fileName ? <span title={fileName}>{fileName}</span> : <span className="profile-form-hint">No file uploaded</span>}<div className="profile-document-actions">{fileName && <button className="button button-ghost" type="button" onClick={() => void openDocument(kind)}>View / download</button>}<label className="button button-primary">{documentBusy === kind ? "Uploading…" : fileName ? "Replace file" : `Upload ${kind === "cv" ? "CV" : "resume"}`}<input type="file" accept={PROFILE_DOCUMENT_ACCEPT} disabled={documentBusy !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDocument(kind, file); event.currentTarget.value = ""; }} /></label></div></div>; })}</div></section>}
      {section("skills", listEditor("skills", "Add a skill"))}
      {section("education", repeatEditor("education"))}
      {section("employment", repeatEditor("employment"))}
      {section("projects", repeatEditor("projects"))}
      {section("preferences", <div className="profile-form-grid">{textInput("preferred_role")}{textInput("expected_salary")}{choiceInput("salary_period", ["Per year", "Per month", "Per hour"])}{choiceInput("preferred_shift", ["Morning", "Afternoon", "Night"])}{choiceInput("job_type", ["Permanent", "Contract"])}{choiceInput("employment_type", ["Full-time", "Part-time"])}{choiceInput("work_mode", ["On-site", "Hybrid", "Remote"])}{listEditor("preferred_locations", "Add a location")}</div>)}
      {section("summary", textInput("summary", true))}
      {section("credentials", <div className="profile-form-grid">{repeatEditor("certifications")}{repeatEditor("portfolio_links")}{listEditor("languages", "Add a language")}</div>)}
      {section("personal", <div className="profile-form-grid">{textInput("gender")}{<label className="profile-field" key="date_of_birth">{labels.date_of_birth}<input type="date" value={draft.date_of_birth} onChange={(event) => update("date_of_birth", event.target.value)} /></label>}{textInput("address")}{textInput("city")}{textInput("state")}{textInput("pincode")}</div>)}
      {section("accomplishments", repeatEditor("accomplishments"))}
    </div>
    {editing !== null && <div className="profile-form-actionbar"><button type="button" className="button button-ghost" onClick={cancelEdit}>Cancel</button><button type="submit" form={`form-${editing}`} className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button></div>}
  </div>;
}

function profileFieldText(value: unknown): string { return typeof value === "string" ? value : ""; }

const commonSkills = ["JavaScript", "TypeScript", "React", "HTML", "CSS", "Python", "Java", "SQL", "Node.js", "Communication", "Problem solving", "Data analysis", "Git"];
function skillSuggestions(query: string, selected: string[]): string[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const existing = new Set(selected.map((skill) => skill.trim().toLocaleLowerCase()));
  return commonSkills.filter((skill) => skill.toLocaleLowerCase().includes(normalized) && !existing.has(skill.toLocaleLowerCase())).slice(0, 5);
}
