import { useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";

export type SmartMatchCareerProfile = {
  skills: string[];
  preferred_roles: string[];
  preferred_locations: string[];
  experience: { role: string; duration: string }[];
  work_preferences: string[];
  education?: string[];
  projects?: string[];
  certifications?: string[];
};

export type SmartMatchJob = {
  id: string;
  page: number;
  title: string;
  company: string;
  provider?: "Adzuna" | "TheirStack";
};

type MatchExplanation = {
  job_id: string;
  fit_summary: string;
  matching_skills: string[];
  skill_gaps: string[];
  match_score: number;
  recommendation: string;
  personalized: boolean;
};

type Props = {
  apiBaseUrl: string;
  apiConfigurationError?: string | null;
  jobs: SmartMatchJob[];
  role: string;
  location: string;
  careerProfile: SmartMatchCareerProfile;
  isAuthenticated: boolean;
  getAccessToken: () => Promise<string | null>;
  onAuthenticationRequired: () => void;
  onBackToCareerTools: () => void;
};

class SafeMatchRequestError extends Error {}

function responseDetail(status: number, retryAfter: string | null) {
  if (status === 401) return new SafeMatchRequestError("Your sign-in session expired. Sign in again, then retry.");
  if (status === 403) return new SafeMatchRequestError("Your account does not have access to this assistant request.");
  if (status === 429) return new SafeMatchRequestError(retryAfter ? `The assistant is rate limited. Please try again in ${retryAfter} seconds.` : "The assistant is rate limited. Please wait a moment and try again.");
  if (status === 503) return new SafeMatchRequestError("AI Career is temporarily unavailable. Check the backend AI provider and assistant protection configuration, then retry.");
  if (status === 502 || status === 504) return new SafeMatchRequestError("The AI service could not complete this request. Please try again later.");
  return new SafeMatchRequestError("Could not explain these job matches. Please try again.");
}

export default function SmartJobMatching({ apiBaseUrl, apiConfigurationError = null, jobs, role, location, careerProfile, isAuthenticated, getAccessToken, onAuthenticationRequired, onBackToCareerTools }: Props) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [matches, setMatches] = useState<MatchExplanation[]>([]);
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);

  const workflowStarted = consentOpen || matches.length > 0 || Boolean(error || notice);
  const endSession = () => {
    setConsentOpen(false);
    setConsentChecked(false);
    setBusy(false);
    setError("");
    setNotice("");
    setMatches([]);
    setEndConfirmationOpen(false);
    onBackToCareerTools();
  };

  const explain = async (includeProfile: boolean) => {
    if (busy || jobs.length === 0 || jobs.length > 5) return;
    if (includeProfile && !consentChecked) return;
    if (apiConfigurationError) { setError(apiConfigurationError); return; }
    setBusy(true);
    setError("");
    setNotice("");
    setMatches([]);
    try {
      const token = await getAccessToken();
      if (!token) {
        onAuthenticationRequired();
        throw new Error("Your session is unavailable. Please sign in again.");
      }
      const response = await fetch(`${apiBaseUrl}/api/assistant/match-explanations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          role,
          location,
          jobs: jobs.map(({ id, page, provider }) => ({ id, page, ...(provider && provider !== "Adzuna" ? { provider } : {}) })),
          profile_consent: includeProfile,
          ...(includeProfile ? { career_profile: careerProfile } : {}),
        }),
        signal: AbortSignal.timeout(65000),
      });
      let result: unknown = null;
      try { result = await response.json(); } catch { /* Do not display non-JSON proxy or server bodies. */ }
      if (!response.ok) {
        if (response.status === 401) onAuthenticationRequired();
        throw responseDetail(response.status, response.headers.get("Retry-After"));
      }
      if (typeof result !== "object" || result === null || !Array.isArray((result as { matches?: unknown }).matches)) throw new Error("The assistant returned an unreadable match explanation. Please retry.");
      const responseResult = result as { matches: unknown[]; message?: unknown };
      if (responseResult.matches.length === 0) {
        setNotice(typeof responseResult.message === "string" ? responseResult.message : "No match explanations are available for this shortlist.");
        setMatches([]);
        setConsentOpen(false);
        setConsentChecked(false);
        return;
      }
      const knownIds = new Set(jobs.map((job) => job.id));
      const safeMatches = responseResult.matches.filter((item: unknown): item is MatchExplanation => {
        if (typeof item !== "object" || item === null) return false;
        const match = item as Partial<MatchExplanation>;
        return typeof match.job_id === "string" && knownIds.has(match.job_id)
          && typeof match.fit_summary === "string"
          && Array.isArray(match.matching_skills) && match.matching_skills.every((skill) => typeof skill === "string")
          && Array.isArray(match.skill_gaps) && match.skill_gaps.every((skill) => typeof skill === "string")
          && typeof match.match_score === "number" && Number.isInteger(match.match_score) && match.match_score >= 0 && match.match_score <= 100
          && typeof match.recommendation === "string" && typeof match.personalized === "boolean";
      });
      setMatches(safeMatches);
      if (safeMatches.length === 0) setNotice("No verified match explanations were returned for these listings.");
      setConsentOpen(false);
      setConsentChecked(false);
    } catch (requestError) {
      if (requestError instanceof TypeError) setError("Could not reach the Kaam-Calm API. Check the backend address and connection.");
      else if (requestError instanceof Error && requestError.name === "TimeoutError") setError("The AI match explanation took too long. Please retry.");
      else if (requestError instanceof SafeMatchRequestError) setError(requestError.message);
      else setError(requestError instanceof Error && requestError.message === "Your session is unavailable. Please sign in again."
        ? requestError.message
        : "Could not explain these job matches. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="smart-matching" aria-label="Smart Job Matching">
      {workflowStarted && <div className="smart-matching-workflow-controls">
        <button className="button button-ghost" type="button" onClick={onBackToCareerTools}><ArrowLeft size={16} /> Back to Career Tools</button>
        {!endConfirmationOpen ? (
          <button className="button button-ghost" type="button" onClick={() => setEndConfirmationOpen(true)} disabled={busy}>End Session</button>
        ) : (
          <div className="smart-matching-end-confirmation" role="group" aria-label="Confirm ending Smart Job Matching session">
            <p>End this matching session and clear its temporary explanation?</p>
            <button className="button button-ghost" type="button" onClick={() => setEndConfirmationOpen(false)} disabled={busy}>Cancel</button>
            <button className="button button-primary" type="button" onClick={endSession} disabled={busy}>Confirm End Session</button>
          </div>
        )}
      </div>}
      {isAuthenticated ? (
        <button className="button button-primary" type="button" onClick={() => { setConsentOpen((open) => !open); setError(""); }} disabled={busy}>
          <Sparkles size={16} /> Explain matches
        </button>
      ) : (
        <button className="button button-primary" type="button" onClick={onAuthenticationRequired}>Sign in to explain matches</button>
      )}

      {consentOpen && isAuthenticated && <div className="smart-matching-consent" role="group" aria-label="Career profile sharing choice">
        <strong>Choose what to share</strong>
        <p>For a personalized explanation, Google Gemini will receive only your skills, preferred roles and locations, job titles and experience duration, selected education qualifications, project titles and descriptions, certifications, and work preferences. Kaam-Calm will not send your name, contact details, address, salary, resume or CV, file names, credential links, or storage paths. This explanation is temporary and is not saved.</p>
        <label><input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} /> I consent to sending these selected career details to Google Gemini for this explanation.</label>
        <div className="smart-matching-actions">
          <button className="button button-ghost" type="button" onClick={() => void explain(false)} disabled={busy}>{busy ? "Explaining…" : "Explain without profile"}</button>
          <button className="button button-primary" type="button" onClick={() => void explain(true)} disabled={busy || !consentChecked}>{busy ? "Explaining…" : "Explain with profile"}</button>
        </div>
      </div>}

      {error && <p role="alert" className="smart-matching-error">{error}</p>}
      {notice && <p role="status" className="smart-matching-notice">{notice}</p>}
      {matches.length > 0 && <div className="smart-matching-results" aria-live="polite">
        <h3>Match explanations</h3>
        {matches.map((match) => {
          const job = jobs.find((item) => item.id === match.job_id);
          if (!job) return null;
          return <article className="smart-matching-card" key={match.job_id}>
            <h4>{job.title} <span>at {job.company}</span></h4>
            <p className="smart-matching-score"><strong>{match.personalized ? `${match.match_score}% match` : `${match.match_score}% search relevance`}</strong> · {match.recommendation}</p>
            <p>{match.fit_summary}</p>
            {match.matching_skills.length > 0 && <p><strong>Relevant strengths:</strong> {match.matching_skills.join(", ")}</p>}
            {match.skill_gaps.length > 0 && <p><strong>Potential skills to build:</strong> {match.skill_gaps.join(", ")}</p>}
          </article>;
        })}
      </div>}
    </section>
  );
}
