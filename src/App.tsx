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
  ArrowLeft,
  CalendarDays,
  Wallet,
  CheckCircle2,
} from "lucide-react";

const API_BASE_URL = "https://kaam-calm.onrender.com";

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

function App() {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [experience, setExperience] = useState("Any experience");
  const [jobType, setJobType] = useState("All types");
  const [searched, setSearched] = useState(false);
  const [savedJobs, setSavedJobs] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const filteredJobs = jobs.filter((job) => {
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

    setSelectedJob(null);
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

      const mappedJobs: Job[] = results.map(
        (item: any, index: number) => ({
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
          salary: item.salary ?? "",
        })
      );

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
    setJobType("All types");
    setJobs([]);
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
    <main className="app-shell">
      <header className="navbar">
        <a
          className="brand"
          href="#home"
          onClick={() => setSelectedJob(null)}
        >
          <span className="brand-mark">k.</span>
          <span>
            kaam<span className="brand-dash">-</span>calm
          </span>
        </a>

        <nav className="nav-links">
          <a href="#jobs" onClick={() => setSelectedJob(null)}>
            Explore jobs
          </a>
          <a href="#how-it-works" onClick={() => setSelectedJob(null)}>
            How it works
          </a>
          <a href="#for-recruiters" onClick={() => setSelectedJob(null)}>
            For recruiters
          </a>
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
                : searched
                  ? "Your search results"
                  : "Explore opportunities"}
            </h2>
            <p>
              {selectedJob
                ? "Review the role details before applying."
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
                <option>Fresher</option>
                <option>Experienced</option>
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
                    savedJobs.includes(selectedJob.id)
                      ? "Unsave job"
                      : "Save job"
                  }
                  onClick={() => toggleSaved(selectedJob.id)}
                >
                  <Heart
                    size={21}
                    fill={
                      savedJobs.includes(selectedJob.id)
                        ? "currentColor"
                        : "none"
                    }
                  />
                </button>
              </div>

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
                More personalized filters are coming soon.
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
                  {jobs.length > 0
                    ? "Live results · Adzuna"
                    : "Search to load live jobs"}
                </span>
              </div>

              {loading && (
                <p role="status">Loading real job opportunities...</p>
              )}

              {error && <p role="status">{error}</p>}



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
                            savedJobs.includes(job.id)
                              ? `Unsave ${job.title}`
                              : `Save ${job.title}`
                          }
                          onClick={() => toggleSaved(job.id)}
                        >
                          <Heart
                            size={18}
                            fill={
                              savedJobs.includes(job.id)
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

              {!loading && filteredJobs.length === 0 && (
                <div className="empty-state">
                  <Search size={28} />
                  <h3>
                    {searched
                      ? "No matching jobs yet"
                      : "Ready to find your next role?"}
                  </h3>

                  <p>
                    {searched
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
          <span className="section-kicker">FOR HIRING TEAMS</span>
          <h2>Good people deserve to find each other.</h2>
          <p>
            Recruiter tools and candidate management are planned for a later
            phase.
          </p>
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
