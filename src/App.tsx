import { useState } from "react";
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

const demoJobs = [
  {
    title: "Software Development Engineer",
    company: "Example Technology",
    location: "Bengaluru, India",
    type: "Full-time",
    experience: "Fresher",
    skills: ["Java", "SQL", "Problem Solving"],
  },
  {
    title: "Junior Data Analyst",
    company: "Example Analytics",
    location: "Hyderabad, India",
    type: "Full-time",
    experience: "Experienced",
    skills: ["Python", "SQL", "Excel"],
  },
  {
    title: "Frontend Developer",
    company: "Example Digital",
    location: "Remote · India",
    type: "Remote",
    experience: "Fresher",
    skills: ["React", "TypeScript", "CSS"],
  },
];

function App() {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [experience, setExperience] = useState("Any experience");
  const [searched, setSearched] = useState(false);
  const [savedJobs, setSavedJobs] = useState<string[]>([]);

  const filteredJobs = demoJobs.filter((job) => {
    const matchesRole =
      !role ||
      `${job.title} ${job.skills.join(" ")}`
        .toLowerCase()
        .includes(role.toLowerCase());

    const matchesLocation =
      !location ||
      job.location.toLowerCase().includes(location.toLowerCase());

    const matchesExperience =
      experience === "Any experience" ||
      (experience === "Fresher" && job.experience === "Fresher") ||
      (experience === "Experienced" && job.experience !== "Fresher");

    return matchesRole && matchesLocation && matchesExperience;
  });

  const searchText = [role, location, experience !== "Any experience" ? experience : ""]
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
      url = `https://www.naukri.com/${(role || "jobs").toLowerCase().trim().replace(/\s+/g, "-")}-jobs`;
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

  const toggleSaved = (title: string) => {
    setSavedJobs((current) =>
      current.includes(title)
        ? current.filter((item) => item !== title)
        : [...current, title]
    );
  };

  const runSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearched(true);
    document.getElementById("jobs")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="app-shell">
      <header className="navbar">
        <a className="brand" href="#home">
          <span className="brand-mark">k.</span>
          <span>kaam<span className="brand-dash">-</span>calm</span>
        </a>

        <nav className="nav-links">
          <a href="#jobs">Explore jobs</a>
          <a href="#how-it-works">How it works</a>
          <a href="#for-recruiters">For recruiters</a>
        </nav>

        <div className="nav-actions">
          <a className="button button-ghost" href="#jobs">Log in</a>
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

          <form className="search-panel" onSubmit={runSearch}>
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

            <button className="button button-search" type="submit">
              <Search size={18} /> Find jobs
            </button>
          </form>

          <div className="quick-filters">
            <span>Popular searches</span>
            {["Java", "Data Analyst", "Frontend", "Remote"].map((item) => (
              <button
                key={item}
                className="quick-chip"
                onClick={() => {
                  setRole(item);
                  setSearched(true);
                  document.getElementById("jobs")?.scrollIntoView({ behavior: "smooth" });
                }}
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
                ? "Search job portals or explore matching demonstration listings."
                : "Start with one search, then explore jobs across supported portals."}
            </p>
          </div>

          <label className="experience-select">
            <BriefcaseBusiness size={16} />
            <select value={experience} onChange={(event) => {
              setExperience(event.target.value);
              setSearched(true);
            }}>
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
              onChange={(event) => {
                setExperience(event.target.value);
                setSearched(true);
              }}
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

            <button className="reset-button" onClick={() => {
              setRole("");
              setLocation("");
              setExperience("Any experience");
              setSearched(false);
            }}>
              Reset filters
            </button>
          </aside>

          <div className="job-results">
            <div className="results-toolbar">
              <span>
                <strong>{filteredJobs.length}</strong> demonstration listings
              </span>
              <span className="sort-label">Sample data · Not live jobs</span>
            </div>

            <div className="portal-grid">
              {portals.map((portal) => (
                <button
                  key={portal.name}
                  className="portal-card"
                  onClick={() => openPortal(portal.name)}
                >
                  <Globe2 size={20} />
                  <span>{portal.name}</span>
                  <ExternalLink size={15} />
                </button>
              ))}
            </div>

            {filteredJobs.length > 0 ? (
              filteredJobs.map((job, index) => (
                <article className="job-card" key={job.title}>
                  <div className={`company-icon ${["violet", "blue", "pink"][index % 3]}`}>
                    <Building2 size={23} />
                  </div>

                  <div className="job-info">
                    <div className="job-title-row">
                      <h3>{job.title}</h3>
                      <button
                        className="save-button"
                        aria-label={`Save ${job.title}`}
                        onClick={() => toggleSaved(job.title)}
                      >
                        <Heart
                          size={18}
                          fill={savedJobs.includes(job.title) ? "currentColor" : "none"}
                        />
                      </button>
                    </div>

                    <div className="company-name">{job.company}</div>

                    <div className="job-metadata">
                      <span><MapPin size={14} /> {job.location}</span>
                      <span><BriefcaseBusiness size={14} /> {job.type}</span>
                      <span><Clock3 size={14} /> {job.experience}</span>
                    </div>

                    <div className="job-skills">
                      {job.skills.map((skill) => <span key={skill}>{skill}</span>)}
                    </div>

                    <div className="job-footer">
                      <span>Sample listing</span>
                      <span className="sample-label">DEMO LISTING</span>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <Search size={28} />
                <h3>No matching demo listings</h3>
                <p>Try another role, skill or location, or search the job portals above.</p>
                <button className="button button-primary" onClick={() => {
                  setRole("");
                  setLocation("");
                  setExperience("Any experience");
                  setSearched(false);
                }}>
                  Clear search
                </button>
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
            <p>Open job searches across supported portals from one dashboard.</p>
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
          <span>kaam<span className="brand-dash">-</span>calm</span>
        </a>
        <span>Your career. One calm search.</span>
        <span>Built to make job discovery simpler.</span>
      </footer>
    </main>
  );
}

export default App;
