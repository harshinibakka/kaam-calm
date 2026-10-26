import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  Search,
  MapPin,
  BriefcaseBusiness,
  Globe2,
  ArrowRight,
  Sparkles,
  Building2,
  Clock3,
  ChevronDown,
  Heart,
  ExternalLink,
  ArrowLeft,
  CalendarDays,
  Wallet,
  CheckCircle2,
  X,
  Menu,
  Bell,
  House,
  UserRound,
  FileText,
  Bookmark,
  SlidersHorizontal,
  Settings,
  CircleHelp,
} from "lucide-react";
import { supabase, supabaseConfiguration } from "./lib/supabase";
import ProfileDashboard from "./components/ProfileDashboard";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://kaam-calm.onrender.com";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  source: string;
  created: string;
  type?: string;
  experience?: string;
  skills?: string[];
  salary?: string;
};

type JobsResponse = {
  jobs: unknown[];
  has_more?: boolean;
};

type DashboardView = "home" | "applied" | "profile" | "notifications" | "settings" | "help";
type ApplicationRecord = { job_id: string; title: string; company: string; location: string; url: string; source: string; job_created: string; status: "applied"; applied_at: string };
type ThemeChoice = "light" | "dark" | "system";

function getThemeChoice(key: string): ThemeChoice {
  try {
    const value = window.localStorage.getItem(key);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

function profileProgress(value: Record<string, unknown>): number {
  const checks = [value.full_name, value.location, value.headline, value.summary, value.skills, value.education, value.employment, value.projects, value.preferred_role, value.preferred_locations, value.employment_type, value.work_mode, value.certifications, value.portfolio_links, value.languages, value.accomplishments, value.city, value.state];
  const completed = checks.filter((item) => Array.isArray(item) ? item.length > 0 : typeof item === "string" ? item.trim().length > 0 : Boolean(item)).length;
  return Math.round(completed / checks.length * 100);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "K").slice(0, 2)).toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJobsResponse(value: unknown): JobsResponse {
  if (!isRecord(value) || !Array.isArray(value.jobs)) {
    throw new Error("Invalid jobs response");
  }
  return {
    jobs: value.jobs,
    has_more: typeof value.has_more === "boolean" ? value.has_more : undefined,
  };
}

function textField(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function mapJob(value: unknown, index: number, page: number): Job {
  if (!isRecord(value)) throw new Error("Invalid job record");
  const title = textField(value.title, "Untitled position");
  const url = textField(value.url);
  const id =
    value.id == null || value.id === ""
      ? url || `${title}-${page}-${index}`
      : String(value.id);
  return {
    id,
    title,
    company: textField(value.company, "Company not specified"),
    location: textField(value.location, "Location not specified"),
    description: textField(value.description),
    url,
    source: textField(value.source, "Job portal"),
    created: textField(value.created),
    type: textField(value.type),
    experience: textField(value.experience),
    skills: Array.isArray(value.skills)
      ? value.skills.filter((skill): skill is string => typeof skill === "string")
      : [],
    salary: textField(value.salary),
  };
}

function shouldLoadMore(response: JobsResponse, resultCount: number, page: number) {
  return response.has_more ?? (page < 10 && resultCount >= 20);
}

function appendUniqueJobs(existing: Job[], incoming: Job[]) {
  const seenIds = new Set(existing.map((job) => job.id));
  const unique: Job[] = [];
  for (const job of incoming) {
    if (seenIds.has(job.id)) continue;
    seenIds.add(job.id);
    unique.push(job);
  }
  return [...existing, ...unique];
}

function mapSavedJob(value: unknown): Job {
  if (!isRecord(value)) throw new Error("Invalid saved job record");
  return mapJob({ ...value, id: value.job_id, created: value.job_created }, 0, 1);
}

function App() {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [experience, setExperience] = useState("Any experience");
  const [jobType, setJobType] = useState("All types");
  const [searched, setSearched] = useState(false);
  const [savedJobs, setSavedJobs] = useState<Job[]>([]);
  const [savedJobsLoading, setSavedJobsLoading] = useState(false);
  const [savedJobsError, setSavedJobsError] = useState("");
  const [savingJobIds, setSavingJobIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [authBusy, setAuthBusy] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showSavedJobs, setShowSavedJobs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showApplied, setShowApplied] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState("");
  const [applicationBusy, setApplicationBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => getThemeChoice("kaam-calm-theme:anonymous"));
  const [themeStorageReady, setThemeStorageReady] = useState(false);
  const [systemDark, setSystemDark] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profilePreferredRole, setProfilePreferredRole] = useState("");
  const [profileCompletion, setProfileCompletion] = useState<number | null>(null);
  const [profileSummaryError, setProfileSummaryError] = useState(false);
  const activeRequestRef = useRef<AbortController | null>(null);

  const themeKey = `kaam-calm-theme:${session?.user.id ?? "anonymous"}`;
  const activeView: DashboardView = showProfile ? "profile" : showApplied ? "applied" : showNotifications ? "notifications" : showSettings ? "settings" : showHelp ? "help" : "home";
  const resolvedTheme = themeChoice === "system" ? (systemDark ? "dark" : "light") : themeChoice;

  useEffect(() => {
    setThemeStorageReady(false);
    setThemeChoice(getThemeChoice(themeKey));
    setThemeStorageReady(true);
  }, [themeKey]);

  useEffect(() => {
    if (!themeStorageReady) return;
    try { window.localStorage.setItem(themeKey, themeChoice); } catch { /* Browser storage may be disabled. */ }
  }, [themeChoice, themeKey, themeStorageReady]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const updatePreference = () => setSystemDark(query.matches);
    updatePreference();
    query.addEventListener?.("change", updatePreference);
    return () => query.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = document.querySelector<HTMLElement>(".navigation-drawer");
    drawer?.querySelector<HTMLElement>("button, a")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); return; }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [menuOpen]);

  useEffect(() => {
    if (!session?.user.id || !supabase) {
      setProfileName(session?.user.email?.split("@")[0] ?? "");
      setProfilePreferredRole("");
      setProfileCompletion(null);
      setProfileSummaryError(false);
      return;
    }
    let current = true;
    setProfileName(session.user.email?.split("@")[0] ?? "");
    setProfilePreferredRole("");
    setProfileCompletion(null);
    setProfileSummaryError(false);
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.from("job_seeker_profiles").select("full_name,location,headline,summary,skills,education,employment,projects,preferred_role,preferred_locations,employment_type,work_mode,certifications,portfolio_links,languages,accomplishments,city,state").eq("user_id", session.user.id).maybeSingle();
        if (queryError) throw queryError;
        if (!current) return;
        setProfileName(typeof data?.full_name === "string" && data.full_name ? data.full_name : session.user.email?.split("@")[0] ?? "");
        setProfilePreferredRole(typeof data?.preferred_role === "string" ? data.preferred_role : "");
        setProfileCompletion(data ? profileProgress(data as Record<string, unknown>) : 0);
      } catch {
        if (current) { setProfileSummaryError(true); setProfileCompletion(null); }
      }
    })();
    return () => { current = false; };
  }, [session?.user.id]);

  const navigate = (view: DashboardView) => {
    setMenuOpen(false);
    setSelectedJob(null);
    setShowSavedJobs(false);
    setShowProfile(view === "profile");
    setShowApplied(view === "applied");
    setShowNotifications(view === "notifications");
    setShowSettings(view === "settings");
    setShowHelp(view === "help");
    if ((view === "profile" || view === "applied") && !session) {
      openAuth("sign_in", "Sign in to view your personal dashboard.");
      setShowProfile(false);
      setShowApplied(false);
      setShowNotifications(false);
      setShowSettings(false);
      setShowHelp(false);
    }
    if (view === "home") {
      window.setTimeout(() => document.getElementById("home")?.scrollIntoView({ behavior: "smooth" }), 0);
    }
  };

  useEffect(() => () => activeRequestRef.current?.abort(), []);

  useEffect(() => {
    const supabaseClient = supabase;
    if (!supabaseClient) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(
      (event: AuthChangeEvent, nextSession: Session | null) => {
        if (!mounted) return;
        setSession(nextSession);
        setAuthNotice("");
        if (event === "SIGNED_OUT") {
          setShowSavedJobs(false);
          setShowProfile(false);
          setShowApplied(false);
          setShowNotifications(false);
          setMenuOpen(false);
          setAccountNotice("Your session ended. Sign in again to access saved jobs.");
        } else {
          setAccountNotice("");
        }
      }
    );

    const restoreSession = async () => {
      try {
        const { data, error: sessionError } = await supabaseClient.auth.getSession();
        if (!mounted) return;
        if (sessionError) {
          setSession(null);
          setAccountNotice("Could not restore your session. Please sign in again.");
        } else {
          setSession(data.session);
        }
      } catch {
        if (!mounted) return;
        setSession(null);
        setAccountNotice("Could not restore your session. Please sign in again.");
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };
    void restoreSession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      setSavedJobs([]);
      setSavedJobsLoading(false);
      setSavedJobsError("");
      return;
    }

    let current = true;
    setSavedJobs([]);
    setSavedJobsLoading(true);
    setSavedJobsError("");
    void (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("saved_jobs")
          .select("job_id,title,company,location,description,url,source,job_created,type,experience,skills,salary")
          .eq("user_id", session.user.id)
          .order("saved_at", { ascending: false });
        if (!current) return;
        if (queryError) throw queryError;
        setSavedJobs((data ?? []).map(mapSavedJob));
      } catch {
        if (current) {
          setSavedJobs([]);
          setSavedJobsError("Could not load saved jobs. Please try again.");
        }
      } finally {
        if (current) setSavedJobsLoading(false);
      }
    })();

    return () => {
      current = false;
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!supabase || !session?.user.id) { setApplications([]); setApplicationsLoading(false); setApplicationsError(""); return; }
    let current = true;
    setApplications([]);
    setApplicationsLoading(true); setApplicationsError("");
    void Promise.resolve(supabase.from("job_seeker_applications").select("job_id,title,company,location,url,source,job_created,status,applied_at").eq("user_id", session.user.id).order("applied_at", { ascending: false })).then(({ data, error: queryError }) => {
      if (!current) return;
      if (queryError) { setApplicationsError("Could not load your application records. Apply the latest database migration and try again."); setApplications([]); }
      else setApplications((data ?? []) as ApplicationRecord[]);
      setApplicationsLoading(false);
    }).catch(() => { if (current) { setApplicationsError("Could not load your application records. Check your connection and database setup."); setApplications([]); setApplicationsLoading(false); } });
    return () => { current = false; };
  }, [session?.user.id]);

  const visibleJobs = showSavedJobs ? savedJobs : jobs;
  const filteredJobs = visibleJobs.filter((job) => {
    const description = (job.description || "").toLowerCase();
    const title = (job.title || "").toLowerCase();
    const type = (job.type || "").toLowerCase();
    const searchableText = `${title} ${description} ${type}`;

    if (experience === "Fresher") {
      const fresherMatch =
        /fresher|entry.level|intern(ship)?|graduate|0\s*[-–]\s*1\s*year|no experience|early career/.test(
          searchableText
        );
      if (!fresherMatch) return false;
    }

    if (experience === "Experienced") {
      const fresherOnly =
        /fresher|entry.level|intern(ship)?|graduate|no experience|early career/.test(
          searchableText
        );
      if (fresherOnly) return false;
    }

    if (jobType === "Full-time" && !/full[ -]?time|permanent/.test(searchableText)) {
      return false;
    }

    if (jobType === "Part-time" && !/part[ -]?time/.test(searchableText)) {
      return false;
    }

    if (
      jobType === "Remote" &&
      !/remote|work from home|work from anywhere|fully distributed|anywhere in india/.test(searchableText)
    ) {
      return false;
    }

    if (jobType === "Internship" && !/intern(ship)?|interns/.test(searchableText)) {
      return false;
    }

    return true;
  });



  const openAuth = (mode: "sign_in" | "sign_up", notice = "") => {
    setAuthMode(mode);
    setAuthError("");
    setAuthNotice(notice);
    setAuthOpen(true);
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setAuthError("Supabase is not configured. Add its URL and publishable key to your local environment.");
      return;
    }

    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    try {
      const result = authMode === "sign_up"
        ? await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword })
        : await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
      if (result.error) throw result.error;

      if (authMode === "sign_up" && !result.data.session) {
        setAuthNotice("Check your email for a confirmation link before signing in.");
        setAuthPassword("");
      } else {
        setAuthOpen(false);
        setAuthPassword("");
        setAccountNotice("");
      }
    } catch (authRequestError) {
      setAuthError(
        authRequestError instanceof Error
          ? authRequestError.message
          : "Authentication failed. Please try again."
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    setAccountNotice("");
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch {
      setAccountNotice("Could not sign out. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  const toggleSaved = async (job: Job) => {
    if (!session) {
      openAuth("sign_in", "Sign in to save jobs to your account.");
      return;
    }
    if (!supabase || savingJobIds.includes(job.id)) return;

    const isSaved = savedJobs.some((savedJob) => savedJob.id === job.id);
    setSavingJobIds((current) => [...current, job.id]);
    setSaveError("");
    try {
      if (isSaved) {
        const { error: deleteError } = await supabase
          .from("saved_jobs")
          .delete()
          .eq("user_id", session.user.id)
          .eq("job_id", job.id);
        if (deleteError) throw deleteError;
        setSavedJobs((current) => current.filter((savedJob) => savedJob.id !== job.id));
      } else {
        const { error: insertError } = await supabase.from("saved_jobs").insert({
          user_id: session.user.id,
          job_id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          description: job.description,
          url: job.url,
          source: job.source,
          job_created: job.created,
          type: job.type ?? "",
          experience: job.experience ?? "",
          skills: job.skills ?? [],
          salary: job.salary ?? "",
        });
        if (insertError) throw insertError;
        setSavedJobs((current) => [job, ...current.filter((savedJob) => savedJob.id !== job.id)]);
      }
    } catch {
      setSaveError("Could not update saved jobs. Please try again.");
    } finally {
      setSavingJobIds((current) => current.filter((id) => id !== job.id));
    }
  };

  const runSearch = async (
    event?: FormEvent<HTMLFormElement>,
    searchRole?: string
  ) => {
    event?.preventDefault();
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setShowSavedJobs(false);

    const requestedRole = searchRole ?? role;

    if (searchRole !== undefined) {
      setRole(searchRole);
    }

    setSelectedJob(null);
    setShowSavedJobs(false);
    setShowProfile(false);
    setShowApplied(false);
    setShowNotifications(false);
    setShowSettings(false);
    setShowHelp(false);
    setSearched(true);
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setJobs([]);
    const timeoutId = window.setTimeout(() => controller.abort(new DOMException("Search timed out", "TimeoutError")), 35_000);

    document.getElementById("jobs")?.scrollIntoView({
      behavior: "smooth",
    });

    try {
      const params = new URLSearchParams({
        role: requestedRole.trim() || "jobs",
        location: location.trim() || "India",
        page: "1",
      });

      const response = await fetch(
        `${API_BASE_URL}/api/jobs?${params.toString()}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted || activeRequestRef.current !== controller) return;

      if (!response.ok) {
        throw new Error(`Job search failed (${response.status})`);
      }

      const data = readJobsResponse(await response.json());
      if (controller.signal.aborted || activeRequestRef.current !== controller) return;
      const mappedJobs = data.jobs.map((item, index) => mapJob(item, index, 1));

      setJobs(mappedJobs);
      setCurrentPage(1);
      setHasMore(shouldLoadMore(data, mappedJobs.length, 1));

    } catch (requestError) {
      if (activeRequestRef.current === controller && controller.signal.aborted && controller.signal.reason?.name === "TimeoutError") {
        setError("Job search took too long. Check your connection and retry.");
      } else if (activeRequestRef.current === controller && !(requestError instanceof Error && requestError.name === "AbortError")) {
        setError(requestError instanceof Error && requestError.message.startsWith("Job search failed (503)") ? "Job search is temporarily unavailable because the provider is not configured." : "Could not load jobs. Check your connection and retry.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setLoading(false);
      }
    }
  };

  const loadMoreJobs = async () => {
    if (loadingMore || !hasMore) return;

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setLoadingMore(true);
    setError("");
    const nextPage = currentPage + 1;
    const timeoutId = window.setTimeout(() => controller.abort(new DOMException("Search timed out", "TimeoutError")), 25_000);

    try {
      const params = new URLSearchParams({
        role: role.trim() || "jobs",
        location: location.trim() || "India",
        page: String(nextPage),
      });
      const response = await fetch(`${API_BASE_URL}/api/jobs?${params.toString()}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || activeRequestRef.current !== controller) return;
      if (!response.ok) throw new Error(`Job search failed (${response.status})`);

      const data = readJobsResponse(await response.json());
      if (controller.signal.aborted || activeRequestRef.current !== controller) return;
      const mappedJobs = data.jobs.map((item, index) => mapJob(item, index, nextPage));

      setJobs((current) => appendUniqueJobs(current, mappedJobs));
      setCurrentPage(nextPage);
      setHasMore(shouldLoadMore(data, mappedJobs.length, nextPage));
    } catch (requestError) {
      if (activeRequestRef.current === controller && controller.signal.aborted && controller.signal.reason?.name === "TimeoutError") {
        setError("Loading more jobs took too long. Please retry.");
      } else if (activeRequestRef.current === controller && !(requestError instanceof Error && requestError.name === "AbortError")) {
        setError("Could not load more jobs. Please retry.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setLoadingMore(false);
      }
    }
  };

  const markApplied = async (job: Job) => {
    if (!session) { openAuth("sign_in", "Sign in to track an application."); return; }
    if (!supabase || applicationBusy) return;
    if (!window.confirm("Have you submitted this application on the employer’s site? Kaam-Calm will record your confirmation; it will not submit the application.")) return;
    setApplicationBusy(true); setApplicationsError("");
    const appliedAt = new Date().toISOString();
    try {
      const { error: upsertError } = await supabase.from("job_seeker_applications").upsert({ user_id: session.user.id, job_id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, source: job.source, job_created: job.created, status: "applied", applied_at: appliedAt }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
      if (upsertError) throw upsertError;
      const row: ApplicationRecord = { job_id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, source: job.source, job_created: job.created, status: "applied", applied_at: appliedAt };
      setApplications((current) => [row, ...current.filter((item) => item.job_id !== job.id)]);
    } catch {
      setApplicationsError("Could not save your application confirmation. Please try again.");
    } finally { setApplicationBusy(false); }
  };

  const resetSearch = () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setRole("");
    setLocation("");
    setExperience("Any experience");
    setJobType("All types");
    setJobs([]);
    setLoading(false);
    setLoadingMore(false);
    setCurrentPage(1);
    setHasMore(false);
    setSearched(false);
    setSelectedJob(null);
    setError("");
  };

  const openJobDetails = (job: Job) => {
    setSelectedJob(job);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBackToResults = () => {
    setSelectedJob(null);
    window.setTimeout(() => {
      document.getElementById("jobs")?.scrollIntoView({
        behavior: "smooth",
      });
    }, 0);
  };

  return (
    <main className="app-shell" data-theme={resolvedTheme}>
      <header className="navbar">
        <button className="menu-trigger" type="button" aria-label="Open navigation menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={22} /></button>
        <a
          className="brand"
          href="#home"
          onClick={() => navigate("home")}
        >
          <span className="brand-mark">k.</span>
          <span>
            kaam<span className="brand-dash">-</span>calm
          </span>
        </a>

        <nav className="nav-links">
          <a href="#jobs" onClick={() => navigate("home")}>
            Explore jobs
          </a>
          <a href="#how-it-works" onClick={() => setSelectedJob(null)}>
            How it works
          </a>
          <a href="#for-recruiters" onClick={() => setSelectedJob(null)}>
            For recruiters
          </a>
          {session && <button className="nav-profile-link" type="button" onClick={() => navigate("profile")} aria-current={showProfile ? "page" : undefined}>My Profile</button>}
        </nav>

        <div className="nav-actions">
          <button className="notification-trigger" type="button" aria-label="Notifications" onClick={() => navigate("notifications")}><Bell size={19} /></button>
          {authLoading ? (
            <button className="button button-ghost" type="button" disabled>
              Loading account...
            </button>
          ) : session ? (
            <>
              <button
                className="button button-ghost nav-saved-link"
                type="button"
                onClick={() => {
                  setShowProfile(false);
                  setShowApplied(false);
                  setShowNotifications(false);
                  setShowSavedJobs((current) => !current);
                  setSelectedJob(null);
                  setSaveError("");
                }}
              >
                {showSavedJobs ? "Search jobs" : `Saved jobs (${savedJobs.length})`}
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={handleSignOut}
                disabled={authBusy}
              >
                {authBusy ? "Signing out..." : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <button
                className="button button-ghost"
                type="button"
                onClick={() => openAuth("sign_in")}
              >
                Log in
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => openAuth("sign_up")}
              >
                Get started <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      {accountNotice && <p className="account-notice" role="status">{accountNotice}</p>}

      {menuOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
        <aside className="navigation-drawer" role="dialog" aria-modal="true" aria-label="Main navigation">
          <div className="drawer-heading"><a className="brand" href="#home" onClick={() => navigate("home")}><span className="brand-mark">k.</span><span>kaam<span className="brand-dash">-</span>calm</span></a><button type="button" className="icon-button" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)}><X size={20} /></button></div>
          <div className="drawer-account"><span className="avatar-circle">{initials(profileName || session?.user.email || "Kaam Calm")}</span><div><strong>{profileName || (session ? "Your account" : "Welcome")}</strong><small>{session ? (profileCompletion === null ? "Profile details unavailable" : `${profileCompletion}% profile complete`) : "Sign in to access your profile"}</small></div></div>
          <nav className="drawer-links" aria-label="Dashboard sections">
            <button type="button" onClick={() => navigate("profile")}><UserRound size={18} /> Update Profile</button>
            <button type="button" onClick={() => navigate("home")}><Search size={18} /> Search Jobs</button>
            <button type="button" onClick={() => { setMenuOpen(false); void runSearch(undefined, profilePreferredRole || role || "software developer"); }}><Sparkles size={18} /> Recommended Jobs</button>
            <button type="button" onClick={() => navigate("applied")}><FileText size={18} /> Applied Jobs</button>
            <button type="button" onClick={() => { if (!session) { setMenuOpen(false); openAuth("sign_in", "Sign in to view your saved jobs."); return; } navigate("home"); setShowSavedJobs(true); }}><Bookmark size={18} /> Saved Jobs <span>{savedJobs.length}</span></button>
            <button type="button" onClick={() => { navigate("profile"); window.setTimeout(() => document.querySelector(".profile-completion")?.scrollIntoView({ behavior: "smooth", block: "center" }), 120); }}><SlidersHorizontal size={18} /> Profile Performance</button>
            <div className="drawer-theme" id="drawer-theme"><strong>Display Preferences</strong><div role="group" aria-label="Display preferences">{(["light", "dark", "system"] as const).map((mode) => <button type="button" aria-pressed={themeChoice === mode} key={mode} onClick={() => setThemeChoice(mode)}>{mode === "system" ? "System" : mode[0].toUpperCase() + mode.slice(1)}</button>)}</div></div>
            <button type="button" onClick={() => navigate("settings")}><Settings size={18} /> Settings</button>
            <button type="button" onClick={() => navigate("help")}><CircleHelp size={18} /> Help &amp; Support</button>
          </nav>
        </aside>
      </div>}

      {showProfile && session ? (
        <ProfileDashboard userId={session.user.id} email={session.user.email} onProfileChange={(name, completion) => { if (name) setProfileName(name); setProfileCompletion(completion); }} />
      ) : showApplied ? (
        <section className="dashboard-empty-page applied-page"><span className="dashboard-icon"><FileText size={27} /></span><span className="section-kicker">APPLICATION TRACKING</span><h1>Applied Jobs</h1><p>Kaam-Calm records applications only after you confirm that you submitted them on the employer site.</p>{applicationsLoading ? <p role="status">Loading your application records...</p> : applicationsError ? <p role="alert">{applicationsError}</p> : applications.length ? <div className="application-list">{applications.map((application) => <article className="application-card" key={application.job_id}><div><strong>{application.title}</strong><p>{application.company} · {application.location}</p><small>Applied {new Date(application.applied_at).toLocaleDateString()}</small></div><span className="applied-badge"><CheckCircle2 size={16} /> Applied</span>{application.url && <a href={application.url} target="_blank" rel="noopener noreferrer">View listing <ExternalLink size={14} /></a>}</article>)}</div> : <><p className="dashboard-muted">No applications tracked yet. Open a job, apply on the employer site, then confirm it in Kaam-Calm.</p><button type="button" className="button button-primary" onClick={() => navigate("home")}>Explore jobs <ArrowRight size={16} /></button></>}</section>
      ) : showNotifications ? (
        <section className="dashboard-empty-page"><span className="dashboard-icon"><Bell size={27} /></span><span className="section-kicker">YOUR UPDATES</span><h1>Notifications</h1><p>There are no notifications to show.</p><p className="dashboard-muted">Job alerts and application updates are not available because the project has no notification source configured.</p></section>
      ) : showSettings ? (
        <section className="dashboard-empty-page settings-page"><span className="dashboard-icon"><Settings size={27} /></span><span className="section-kicker">PREFERENCES</span><h1>Settings</h1><p>Choose how Kaam-Calm looks on this device. Your choice is saved for your account in this browser.</p><div className="settings-options" role="group" aria-label="Display theme">{(["light", "dark", "system"] as const).map((mode) => <button type="button" aria-pressed={themeChoice === mode} key={mode} onClick={() => setThemeChoice(mode)}>{mode === "system" ? "System" : mode[0].toUpperCase() + mode.slice(1)}</button>)}</div><p className="dashboard-muted">Account, privacy, and notification controls are not available yet.</p></section>
      ) : showHelp ? (
        <section className="dashboard-empty-page help-page"><span className="dashboard-icon"><CircleHelp size={27} /></span><span className="section-kicker">HELP &amp; SUPPORT</span><h1>How can we help?</h1><p>Search jobs by role and location, save listings to revisit them, and open the original employer listing to apply.</p><p>After submitting on the employer’s site, use “Mark as applied” on the job details page to add it to your private Applied Jobs list.</p><p className="dashboard-muted">Direct support contact and help center are not configured yet. Profile and saved-job data remain tied to your signed-in account.</p><button type="button" className="button button-primary" onClick={() => navigate("home")}>Search jobs <ArrowRight size={16} /></button></section>
      ) : (
      <>

      {session && !showSavedJobs && <section className="home-dashboard-summary" aria-label="Your job search dashboard"><div className="summary-welcome"><span className="section-kicker">YOUR JOB SEARCH DASHBOARD</span><h2>Welcome back, {profileName || "job seeker"}</h2><p>Keep your goals close and your next opportunity in view.</p></div><div className="summary-stat"><strong>{savedJobs.length}</strong><span>Saved jobs</span></div><div className="summary-stat"><strong>{profileCompletion === null ? "—" : `${profileCompletion}%`}</strong><span>Profile completion</span></div><div className="summary-stat"><strong>{applications.length}</strong><span>Applications tracked</span></div>{profileSummaryError && <small role="status">Could not load profile statistics. Check profile storage and your connection.</small>}</section>}

      <section className="hero" id="home">
        <div className="hero-orb orb-one" />
        <div className="hero-orb orb-two" />

        <div className="hero-content">
          <div className="eyebrow">
            <Sparkles size={14} /> YOUR NEXT CHAPTER STARTS HERE
          </div>

          <h1>
            Find your work.
            <br />
            <span>Lose the chaos.</span>
          </h1>

          <p className="hero-description">
            One calm place to discover opportunities from across the web.
            Your skills, your ambitions, your next big move.
          </p>

          <div className="source-strip">
            <span className="source-dot" />
            Multiple job sources <span className="source-divider">·</span>
            Local and global opportunities
          </div>

          <form
            className="search-panel"
            onSubmit={(event) => runSearch(event)}
          >
            <label className="search-field">
              <Search size={20} />
              <span className="field-content">
                <span className="field-label">
                  WHAT ARE YOU LOOKING FOR?
                </span>
                <input
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  placeholder="Job title or skill"
                />
              </span>
            </label>

            <span className="search-separator" />

            <label className="search-field location-field">
              <MapPin size={20} />
              <span className="field-content">
                <span className="field-label">WHERE?</span>
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="City or country"
                />
              </span>
            </label>

            <button
              className="button button-search"
              type="submit"
              disabled={loading}
            >
              <Search size={18} />
              {loading ? "Searching..." : "Find jobs"}
            </button>
          </form>

          <div className="quick-filters">
            <span>Popular searches</span>
            {["Java", "Data Analyst", "Frontend", "Remote"].map((item) => (
              <button
                key={item}
                type="button"
                className="quick-chip"
                onClick={() => runSearch(undefined, item)}
                disabled={loading}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="jobs-section" id="jobs">
        <div className="section-heading">
          <div>
            <span className="section-kicker">YOUR NEXT OPPORTUNITY</span>
            <h2>
              {selectedJob
                ? "Job details"
                : showSavedJobs
                  ? "Saved jobs"
                : searched
                  ? "Your search results"
                  : "Explore opportunities"}
            </h2>
            <p>
              {selectedJob
                ? "Review the role details before applying."
                : showSavedJobs
                  ? "Jobs you saved to your account."
                : searched
                  ? "Explore live listings from the connected job source."
                  : "Start with a search to discover live job opportunities."}
            </p>
          </div>

          {!selectedJob && (
            <label className="experience-select">
              <BriefcaseBusiness size={16} />
              <select
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
              >
                <option>Any experience</option>
                <option value="Fresher">Fresher (keyword match)</option>
                <option value="Experienced">Experienced (keyword match)</option>
              </select>
              <ChevronDown size={15} />
            </label>
          )}
        </div>

        {selectedJob ? (
          <div className="job-details-page">
            <button
              type="button"
              className="button button-ghost back-to-results"
              onClick={goBackToResults}
            >
              <ArrowLeft size={17} />
              Back to search results
            </button>

            <article className="job-details-card">
              <div className="details-company-header">
                <div className="company-icon violet">
                  <Building2 size={28} />
                </div>

                <div className="details-company-info">
                  <span className="section-kicker">JOB OPPORTUNITY</span>
                  <h2>{selectedJob.title}</h2>
                  <p>{selectedJob.company}</p>
                </div>

                <button
                  type="button"
                  className="save-button"
                  aria-label={
                    savedJobs.some((job) => job.id === selectedJob.id)
                      ? "Unsave job"
                      : "Save job"
                  }
                  onClick={() => void toggleSaved(selectedJob)}
                  disabled={savingJobIds.includes(selectedJob.id)}
                >
                  <Heart
                    size={21}
                    fill={
                      savedJobs.some((job) => job.id === selectedJob.id)
                        ? "currentColor"
                        : "none"
                    }
                  />
                </button>
              </div>

              {saveError && <p className="auth-error" role="status">{saveError}</p>}
              {applicationsError && <p className="auth-error" role="alert">{applicationsError}</p>}

              <div className="details-meta-grid">
                <div className="details-meta-item">
                  <MapPin size={19} />
                  <div>
                    <span>Location</span>
                    <strong>{selectedJob.location}</strong>
                  </div>
                </div>

                <div className="details-meta-item">
                  <Building2 size={19} />
                  <div>
                    <span>Company</span>
                    <strong>{selectedJob.company}</strong>
                  </div>
                </div>

                {selectedJob.experience && (
                  <div className="details-meta-item">
                    <Clock3 size={19} />
                    <div>
                      <span>Experience</span>
                      <strong>{selectedJob.experience}</strong>
                    </div>
                  </div>
                )}

                {selectedJob.type && (
                  <div className="details-meta-item">
                    <BriefcaseBusiness size={19} />
                    <div>
                      <span>Employment type</span>
                      <strong>{selectedJob.type}</strong>
                    </div>
                  </div>
                )}

                {selectedJob.salary && (
                  <div className="details-meta-item">
                    <Wallet size={19} />
                    <div>
                      <span>Salary</span>
                      <strong>{selectedJob.salary}</strong>
                    </div>
                  </div>
                )}

                {selectedJob.created && (
                  <div className="details-meta-item">
                    <CalendarDays size={19} />
                    <div>
                      <span>Listing date</span>
                      <strong>
                        {Number.isNaN(Date.parse(selectedJob.created))
                          ? selectedJob.created
                          : new Date(selectedJob.created).toLocaleDateString()}
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              <section className="job-highlights">
                <h3>
                  <Sparkles size={19} />
                  Job highlights
                </h3>

                <ul>
                  <li>
                    <CheckCircle2 size={17} />
                    <span>
                      <strong>Role:</strong> {selectedJob.title}
                    </span>
                  </li>
                  <li>
                    <CheckCircle2 size={17} />
                    <span>
                      <strong>Company:</strong> {selectedJob.company}
                    </span>
                  </li>
                  <li>
                    <CheckCircle2 size={17} />
                    <span>
                      <strong>Location:</strong> {selectedJob.location}
                    </span>
                  </li>

                  {selectedJob.experience && (
                    <li>
                      <CheckCircle2 size={17} />
                      <span>
                        <strong>Experience:</strong> {selectedJob.experience}
                      </span>
                    </li>
                  )}

                  {selectedJob.type && (
                    <li>
                      <CheckCircle2 size={17} />
                      <span>
                        <strong>Job type:</strong> {selectedJob.type}
                      </span>
                    </li>
                  )}

                  {selectedJob.salary && (
                    <li>
                      <CheckCircle2 size={17} />
                      <span>
                        <strong>Salary:</strong> {selectedJob.salary}
                      </span>
                    </li>
                  )}
                </ul>
              </section>

              {selectedJob.skills && selectedJob.skills.length > 0 && (
                <section className="details-section">
                  <h3>Required skills</h3>
                  <div className="job-skills">
                    {selectedJob.skills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))}
                  </div>
                </section>
              )}

              <section className="details-section job-full-description">
                <h3>Full job description</h3>
                {selectedJob.description ? (
                  <p>{selectedJob.description}</p>
                ) : (
                  <p>
                    A detailed description has not been provided by the job
                    source. Open the original listing to view more information.
                  </p>
                )}
              </section>

              <div className="details-apply-footer">
                <div>
                  <span className="section-kicker">LISTING SOURCE</span>
                  <p>{selectedJob.source}</p>
                </div>

                <div className="application-actions">
                {selectedJob.url ? (
                  <a
                    className="button button-primary apply-details-button"
                    href={selectedJob.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Apply now <ExternalLink size={16} />
                  </a>
                ) : (
                  <span className="sort-label">
                    Application link unavailable
                  </span>
                )}
                {applications.some((application) => application.job_id === selectedJob.id) ? <span className="applied-badge"><CheckCircle2 size={16} /> Applied</span> : <button type="button" className="button button-ghost" disabled={applicationBusy} onClick={() => void markApplied(selectedJob)}>{applicationBusy ? "Saving..." : "Mark as applied"}</button>}
                </div>
              </div>
            </article>
          </div>
        ) : (
          <div className="jobs-layout">
            <aside className="filter-card">
              <div className="filter-heading">
                <Globe2 size={18} />
                <h3>Refine your search</h3>
              </div>

              <p>Find opportunities that fit your journey.</p>

              <label className="filter-label" htmlFor="experience-filter">
                Experience keyword filter
              </label>

              <select
                id="experience-filter"
                className="filter-select"
                value={experience}
                onChange={(event) => setExperience(event.target.value)}
              >
                <option>Any experience</option>
                <option value="Fresher">Fresher (keyword match)</option>
                <option value="Experienced">Experienced (keyword match)</option>
              </select>

              <div className="filter-label">Job type</div>
              <div className="filter-tags" role="group" aria-label="Filter jobs by type">
                {["All types", "Full-time", "Part-time", "Internship", "Remote"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`filter-tag-button ${jobType === type ? "active" : ""}`}
                    aria-pressed={jobType === type}
                    onClick={() => setJobType(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <div className="filter-note">
                <Sparkles size={16} />
                Filters apply to loaded listings. Experience uses text
                keywords, not structured provider data.
              </div>

              <button
                type="button"
                className="reset-button"
                onClick={resetSearch}
              >
                Reset filters
              </button>
            </aside>

            <div className="job-results">
              <div className="results-toolbar">
                <span>
                  <strong>{filteredJobs.length}</strong>{" "}
                  {filteredJobs.length === 1 ? "job" : "jobs"} found
                </span>

                <span className="sort-label">
                  {showSavedJobs ? "Saved jobs" : jobs.length > 0
                    ? "Live results · Adzuna"
                    : "Search to load live jobs"}
                </span>
              </div>

              {loading && (
                <p role="status">Loading real job opportunities...</p>
              )}

              {showSavedJobs && savedJobsLoading && (
                <p role="status">Loading saved jobs...</p>
              )}

              {error && <div className="search-error" role="alert"><p>{error}</p><button type="button" className="button button-ghost" onClick={() => { if (loadingMore) void loadMoreJobs(); else void runSearch(); }}>Retry</button></div>}
              {savedJobsError && <p role="status">{savedJobsError}</p>}
              {saveError && <p role="status">{saveError}</p>}



              {!loading &&
                filteredJobs.map((job, index) => (
                  <article className="job-card" key={job.id}>
                    <div
                      className={`company-icon ${
                        ["violet", "blue", "pink"][index % 3]
                      }`}
                    >
                      <Building2 size={23} />
                    </div>

                    <div className="job-info">
                      <div className="job-title-row">
                        <button
                          type="button"
                          className="job-title-link"
                          onClick={() => openJobDetails(job)}
                        >
                          {job.title}
                        </button>

                        <button
                          type="button"
                          className="save-button"
                          aria-label={
                            savedJobs.some((savedJob) => savedJob.id === job.id)
                              ? `Unsave ${job.title}`
                              : `Save ${job.title}`
                          }
                          onClick={() => void toggleSaved(job)}
                          disabled={savingJobIds.includes(job.id)}
                        >
                          <Heart
                            size={18}
                            fill={
                              savedJobs.some((savedJob) => savedJob.id === job.id)
                                ? "currentColor"
                                : "none"
                            }
                          />
                        </button>
                      </div>

                      <div className="company-name">{job.company}</div>

                      <div className="job-metadata">
                        <span>
                          <MapPin size={14} /> {job.location}
                        </span>

                        {job.type && (
                          <span>
                            <BriefcaseBusiness size={14} /> {job.type}
                          </span>
                        )}

                        {job.experience && (
                          <span>
                            <Clock3 size={14} /> {job.experience}
                          </span>
                        )}
                      </div>

                      {job.description && (
                        <p className="job-description">
                          {job.description.length > 240
                            ? `${job.description.slice(0, 240)}…`
                            : job.description}
                        </p>
                      )}

                      {job.skills && job.skills.length > 0 && (
                        <div className="job-skills">
                          {job.skills.map((skill) => (
                            <span key={skill}>{skill}</span>
                          ))}
                        </div>
                      )}

                      <div className="job-footer">
                        <span>
                          {job.source}
                          {job.created ? ` · ${job.created}` : ""}
                        </span>

                        <div className="job-card-actions">
                          <button
                            type="button"
                            className="button button-ghost"
                            onClick={() => openJobDetails(job)}
                          >
                            View details <ArrowRight size={14} />
                          </button>

                          {job.url ? (
                            <a
                              className="button button-primary"
                              href={job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Apply now <ExternalLink size={14} />
                            </a>
                          ) : (
                            <span className="sort-label">
                              Application link unavailable
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}

              {!showSavedJobs && !loading && filteredJobs.length > 0 && hasMore && (
                <div className="load-more-wrap">
                  <button
                    type="button"
                    className="button button-primary load-more-button"
                    onClick={loadMoreJobs}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading more jobs..." : "Load more jobs"}
                    {!loadingMore && <ArrowRight size={16} />}
                  </button>
                </div>
              )}

              {!loading && !savedJobsLoading && !error && !savedJobsError && filteredJobs.length === 0 && (
                <div className="empty-state">
                  <Search size={28} />
                  <h3>
                    {showSavedJobs
                      ? "No saved jobs yet"
                      : searched
                        ? "No matching jobs yet"
                        : "Ready to find your next role?"}
                  </h3>

                  <p>
                    {showSavedJobs
                      ? "Save a job with the heart button and it will appear here."
                      : searched
                        ? "Try another role, location or filter to see more matching jobs."
                        : "Enter a role and location above to search live job listings."}
                  </p>

                  {!searched && (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() =>
                        document
                          .getElementById("home")
                          ?.scrollIntoView({ behavior: "smooth" })
                      }
                    >
                      Start searching <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              )}

            </div>
          </div>
        )}
      </section>

      <section className="how-section" id="how-it-works">
        <span className="section-kicker">LESS SEARCHING. MORE LIVING.</span>
        <h2>Your next opportunity, made simpler.</h2>

        <div className="steps-grid">
          <article>
            <span className="step-number">01</span>
            <Search size={24} />
            <h3>Tell us what matters</h3>
            <p>
              Choose your role, skills, experience and preferred location.
            </p>
          </article>

          <article>
            <span className="step-number">02</span>
            <Globe2 size={24} />
            <h3>Discover in one place</h3>
            <p>
              Browse live job listings from our connected job source.
            </p>
          </article>

          <article>
            <span className="step-number">03</span>
            <ArrowRight size={24} />
            <h3>Take your next step</h3>
            <p>
              Review the original listing and continue to its application page.
            </p>
          </article>
        </div>
      </section>

      <section className="recruiter-section" id="for-recruiters">
        <div>
            <span className="section-kicker">FOR HIRING TEAMS · COMING SOON</span>
          <h2>Good people deserve to find each other.</h2>
          <p>
            Recruiter tools and candidate management are planned for a later
            phase.
          </p>
        </div>

        <a className="button button-light" href="#jobs">
          Coming soon <ArrowRight size={16} />
        </a>
      </section>

      <footer className="footer">
        <a className="brand footer-brand" href="#home">
          <span className="brand-mark">k.</span>
          <span>
            kaam<span className="brand-dash">-</span>calm
          </span>
        </a>

        <span>Your career. One calm search.</span>
        <span>Built to make job discovery simpler.</span>
      </footer>
      </>
      )}

      <nav className="mobile-bottom-nav" aria-label="Primary mobile navigation">
        <button type="button" onClick={() => navigate("home")} aria-current={activeView === "home" ? "page" : undefined}><House size={20} /><span>Home</span></button>
        <button type="button" onClick={() => navigate("applied")} aria-current={activeView === "applied" ? "page" : undefined}><FileText size={20} /><span>Applied</span></button>
        <button type="button" onClick={() => navigate("profile")} aria-current={activeView === "profile" ? "page" : undefined}><UserRound size={20} /><span>Profile</span></button>
      </nav>

      {authOpen && (
        <div className="auth-overlay">
          <section
            className="auth-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
          >
            <button
              className="auth-close"
              type="button"
              aria-label="Close authentication"
              onClick={() => setAuthOpen(false)}
            >
              <X size={19} />
            </button>
            <span className="section-kicker">KAAM-CALM ACCOUNT</span>
            <h2 id="auth-title">
              {authMode === "sign_in" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="auth-description">
              {authMode === "sign_in"
                ? "Sign in to keep your saved jobs with you."
                : "Create an account to save jobs across sessions."}
            </p>

            {authNotice && <p className="auth-notice" role="status">{authNotice}</p>}
            {authError && <p className="auth-error" role="alert">{authError}</p>}

            {supabaseConfiguration !== "configured" ? (
              <p className="auth-error" role="alert">
                {supabaseConfiguration === "invalid"
                  ? "Supabase configuration is invalid. Check VITE_SUPABASE_URL and the publishable or anon key."
                  : "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) in your local environment."}
              </p>
            ) : (
              <form className="auth-form" onSubmit={handleAuthSubmit}>
                <label>
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete={authMode === "sign_in" ? "current-password" : "new-password"}
                    minLength={6}
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    required
                  />
                </label>
                <button className="button button-primary auth-submit" type="submit" disabled={authBusy}>
                  {authBusy
                    ? "Please wait..."
                    : authMode === "sign_in"
                      ? "Log in"
                      : "Create account"}
                </button>
              </form>
            )}

            <button
              className="auth-mode-toggle"
              type="button"
              onClick={() => {
                setAuthMode((mode) => mode === "sign_in" ? "sign_up" : "sign_in");
                setAuthError("");
                setAuthNotice("");
              }}
            >
              {authMode === "sign_in"
                ? "New to Kaam-Calm? Create an account"
                : "Already have an account? Log in"}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
