
import { useState, type FormEvent } from "react";
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
} from "lucide-react";

const API_BASE_URL = "https://kaam-calm.onrender.com";

const portals = [
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/jobs/search/?keywords=",
  },
  {
    name: "Naukri",
    url: "https://www.naukri.com/",
  },
  {
    name: "Indeed",
    url: "https://www.indeed.com/jobs?q=",
  },
  {
    name: "Glassdoor",
    url: "https://www.glassdoor.com/Job/jobs.htm?sc.keyword=",
  },
  {
    name: "Google Jobs",
    url: "https://www.google.com/search?q=",
  },
  {
    name: "Unstop",
    url: "https://unstop.com/",
  },
];

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
};

function App() {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [experience, setExperience] = useState("Any experience");
  const [searched, setSearched] = useState(false);
  const [savedJobs, setSavedJobs] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const filteredJobs = jobs.filter((job) => {
    if (experience === "Any experience" || !job.experience) {
      return true;
    }

    const exp = job.experience.toLowerCase();

    if (experience === "Fresher") {
      return (
        exp.includes("fresher") ||
        exp.includes("entry") ||
        exp.includes("intern") ||
        exp.includes("graduate") ||
        exp.includes("0-1") ||
        exp.includes("0–1")
      );
    }

    return !(
      exp.includes("fresher") ||
      exp.includes("entry level") ||
      exp.includes("internship") ||
      exp.includes("graduate")
    );
  });

  const searchText = [
    role,
    location,
    experience !== "Any experience" ? experience : "",
  ]
    .filter(Boolean)
    .join(" ");

  const openPortal = (portalName: string) => {
    const query = encodeURIComponent(
      [role || "jobs", location, experience !== "Any experience" ? experience : ""]
        .filter(Boolean)
        .join(" ")
    );

    const portal = portals.find((item) => item.name === portalName);
    if (!portal) return;

    let url = portal.url;

    if (portalName === "Naukri") {
      url = `https://www.naukri.com/${(role || "jobs")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")}-jobs`;

      if (location.trim()) {
        url += `-in-${location.toLowerCase().trim().replace(/\s+/g, "-")}`;
      }
    } else if (portalName === "Unstop") {
      url = `https://unstop.com/search?query=${query}`;
    } else {
      url += query;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const toggleSaved = (id: string) => {
    setSavedJobs((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const runSearch = async (
    event?: FormEvent<HTMLFormElement>,
    searchRole?: string
  ) => {
    event?.preventDefault();

    const requestedRole = searchRole ?? role;
    if (searchRole !== undefined) {
      setRole(searchRole);
    }

    setSearched(true);
    setLoading(true);
    setError("");
    setJobs([]);

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
        `${API_BASE_URL}/api/jobs?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`Job search failed (${response.status})`);
      }

      const data = await response.json();

      const results: unknown[] = Array.isArray(data)
        ? data
        : Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.jobs)
            ? data.jobs
            : [];

      const mappedJobs: Job[] = results.map((item: any, index: number) => ({
        id: String(item.id ?? item.url ?? `${item.title ?? "job"}-${index}`),
        title: item.title ?? "Untitled position",
        company: item.company ?? "Company not specified",
        location: item.location ?? "Location not specified",
        description: item.description ?? "",
        url: item.url ?? "",
        source: item.source ?? "Job portal",
        created: item.created ?? "",
        type: item.type ?? "",
        experience: item.experience ?? "",
        skills: Array.isArray(item.skills) ? item.skills : [],
      }));

      setJobs(mappedJobs);

      if (mappedJobs.length === 0) {
        setError("No jobs found. Try another role or location.");
      }
    } catch {
      setError(
        "Could not load jobs. Please try again. If this continues, check the backend API."
      );
    } finally {
      setLoading(false);
    }
  };

  const resetSearch = () => {
    setRole("");
    setLocation("");
    setExperience("Any experience");
    setJobs([]);
    setSearched(false);
    setError("");
  };

  return (
    <main className="app-shell">
      <header className="navbar">
        <a className="brand" href="#home">
          <span className="brand-mark">k.</span>
          <span>
            kaam<span className="brand-dash">-</span>calm
          </span>
        </a>

        <nav className="nav-links">
          <a href="#jobs">Explore jobs</a>
          <a href="#how-it-works">How it works</a>
          <a href="#for-recruiters">For recruiters</a>
        </nav>

        <div className="nav-actions">
          <a className="button button-ghost" href="#jobs">
            Log in
          </a>
          <a className="button button-primary" href="#jobs">
            Get started <ArrowRight size={16} />
          </a>
        </div>
      </header>

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

          <form className="search-panel" onSubmit={(event) => runSearch(event)}>
            <label className="search-field">
              <Search size={20} />
              <span className="field-content">
                <span className="field-label">WHAT ARE YOU LOOKING FOR?</span>
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

            <button className="button button-search" type="submit" disabled={loading}>
              <Search size={18} /> {loading ? "Searching..." : "Find jobs"}
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
            <h2>{searched ? "Your search results" : "Explore opportunities"}</h2>
            <p>
              {searched
                ? "Explore live listings and open more job searches across supported portals."
                : "Start with a search, then explore opportunities across supported portals."}
            </p>
          </div>

          <label className="experience-select">
            <BriefcaseBusiness size={16} />
            <select
              value={experience}
              onChange={(event) => setExperience(event.target.value)}
            >
              <option>Any experience</option>
              <option>Fresher</option>
              <option>Experienced</option>
            </select>
            <ChevronDown size={15} />
          </label>
        </div>

        <div className="jobs-layout">
          <aside className="filter-card">
            <div className="filter-heading">
              <Globe2 size={18} />
              <h3>Refine your search</h3>
            </div>
            <p>Find opportunities that fit your journey.</p>

            <label className="filter-label" htmlFor="experience-filter">
              Experience level
            </label>
            <select
              id="experience-filter"
              className="filter-select"
              value={experience}
              onChange={(event) => setExperience(event.target.value)}
            >
              <option>Any experience</option>
              <option>Fresher</option>
              <option>Experienced</option>
            </select>

            <div className="filter-label">Popular job types</div>
            <div className="filter-tags">
              <span>Full-time</span>
              <span>Remote</span>
              <span>Internship</span>
            </div>

            <div className="filter-note">
              <Sparkles size={16} />
              More personalized filters are coming soon.
            </div>

            <button type="button" className="reset-button" onClick={resetSearch}>
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
                {jobs.length > 0 ? "Live results · Adzuna" : "Search to load live jobs"}
              </span>
            </div>

            {loading && <p role="status">Loading real job opportunities...</p>}

            {error && <p role="status">{error}</p>}

            <div className="portal-grid">
              {portals.map((portal) => (
                <button
                  key={portal.name}
                  type="button"
                  className="portal-card"
                  onClick={() => openPortal(portal.name)}
                >
                  <Globe2 size={20} />
                  <span>{portal.name}</span>
                  <ExternalLink size={15} />
                </button>
              ))}
            </div>

            {!loading && filteredJobs.length > 0 &&
              filteredJobs.map((job, index) => (
                <article className="job-card" key={job.id}>
                  <div
                    className={`company-icon ${["violet", "blue", "pink"][index % 3]}`}
                  >
                    <Building2 size={23} />
                  </div>

                  <div className="job-info">
                    <div className="job-title-row">
                      <h3>{job.title}</h3>
                      <button
                        type="button"
                        className="save-button"
                        aria-label={`${savedJobs.includes(job.id) ? "Unsave" : "Save"} ${job.title}`}
                        onClick={() => toggleSaved(job.id)}
                      >
                        <Heart
                          size={18}
                          fill={savedJobs.includes(job.id) ? "currentColor" : "none"}
                        />
                      </button>
                    </div>

                    <div className="company-name">{job.company}</div>

                    <div className="job-metadata">
                      <span><MapPin size={14} /> {job.location}</span>
                      {job.type && (
                        <span><BriefcaseBusiness size={14} /> {job.type}</span>
                      )}
                      {job.experience && (
                        <span><Clock3 size={14} /> {job.experience}</span>
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
                        <span className="sort-label">Application link unavailable</span>
                      )}
                    </div>
                  </div>
                </article>
              ))}

            {!loading && filteredJobs.length === 0 && (
              <div className="empty-state">
                <Search size={28} />
                <h3>{searched ? "No matching jobs yet" : "Ready to find your next role?"}</h3>
                <p>
                  {searched
                    ? "Try another role or location, or open one of the job portals above."
                    : "Enter a role and location above to search live job listings."}
                </p>
                {!searched && (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => document.getElementById("home")?.scrollIntoView({ behavior: "smooth" })}
                  >
                    Start searching <ArrowRight size={16} />
                  </button>
                )}
              </div>
            )}

            <p className="sort-label">
              {searchText
                ? `Portal searches use: ${searchText}`
                : "Enter a role and location to personalize portal searches."}
            </p>
          </div>
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <span className="section-kicker">LESS SEARCHING. MORE LIVING.</span>
        <h2>Your next opportunity, made simpler.</h2>
        <div className="steps-grid">
          <article>
            <span className="step-number">01</span>
            <Search size={24} />
            <h3>Tell us what matters</h3>
            <p>Choose your role, skills, experience and preferred location.</p>
          </article>
          <article>
            <span className="step-number">02</span>
            <Globe2 size={24} />
            <h3>Discover in one place</h3>
            <p>Search live listings and open searches across supported portals.</p>
          </article>
          <article>
            <span className="step-number">03</span>
            <ArrowRight size={24} />
            <h3>Take your next step</h3>
            <p>Review the original listing and continue to its application page.</p>
          </article>
        </div>
      </section>

      <section className="recruiter-section" id="for-recruiters">
        <div>
          <span className="section-kicker">FOR HIRING TEAMS</span>
          <h2>Good people deserve to find each other.</h2>
          <p>Recruiter tools and candidate management are planned for a later phase.</p>
        </div>
        <a className="button button-light" href="#jobs">
          Recruiter features <ArrowRight size={16} />
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
    </main>
  );
}

export default App;
