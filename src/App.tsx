
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
} from "lucide-react";

type Job = {
  title: string;
  company: string;
  location: string;
  type: string;
  experience: string;
  source: string;
  skills: string[];
  color: string;
};

const jobs: Job[] = [
  {
    title: "Software Development Engineer",
    company: "Example Technology",
    location: "Bengaluru, India",
    type: "Full-time",
    experience: "Fresher",
    source: "Company Careers",
    skills: ["Java", "SQL", "Problem Solving"],
    color: "violet",
  },
  {
    title: "Junior Data Analyst",
    company: "Example Analytics",
    location: "Hyderabad, India",
    type: "Full-time",
    experience: "0–1 years",
    source: "Company Careers",
    skills: ["Python", "SQL", "Excel"],
    color: "blue",
  },
  {
    title: "Frontend Developer",
    company: "Example Digital",
    location: "Remote · India",
    type: "Remote",
    experience: "Fresher",
    source: "Company Careers",
    skills: ["React", "TypeScript", "CSS"],
    color: "pink",
  },
];

function App() {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [experience, setExperience] = useState("Any experience");
  const [searched, setSearched] = useState(false);

  const filteredJobs = jobs.filter((job) => {
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

  return (
    <main className="app-shell">
      <header className="navbar">
        <a className="brand" href="#home" aria-label="Kaam-Calm home">
          <span className="brand-mark">k.</span>
          <span>kaam<span className="brand-dash">-</span>calm</span>
        </a>

        <nav className="nav-links">
          <a href="#jobs">Explore jobs</a>
          <a href="#how-it-works">How it works</a>
          <a href="#for-recruiters">For recruiters</a>
        </nav>

        <div className="nav-actions">
          <button className="button button-ghost" onClick={() => alert("Account sign-in will be added in a later phase.")}>
            Log in
          </button>
          <button className="button button-primary" onClick={() => alert("Account creation will be added in a later phase.")}>
            Get started <ArrowRight size={16} />
          </button>
        </div>
      </header>

      <section className="hero" id="home">
        <div className="hero-orb orb-one" />
        <div className="hero-orb orb-two" />

        <div className="hero-content">
          <div className="eyebrow">
            <Sparkles size={14} />
            YOUR NEXT CHAPTER STARTS HERE
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
            Multiple job sources
            <span className="source-divider">·</span>
            Local and global opportunities
          </div>

          <form
            className="search-panel"
            onSubmit={(event) => {
              event.preventDefault();
              setSearched(true);
              document.getElementById("jobs")?.scrollIntoView({ behavior: "smooth" });
            }}
          >
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
              <Search size={18} />
              Find jobs
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
                ? `Showing ${filteredJobs.length} matching demonstration listings.`
                : "A first look at how your job discovery dashboard will feel."}
            </p>
          </div>

          <label className="experience-select">
            <BriefcaseBusiness size={16} />
            <select
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

            <button
              className="reset-button"
              onClick={() => {
                setRole("");
                setLocation("");
                setExperience("Any experience");
                setSearched(false);
              }}
            >
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

            {filteredJobs.length > 0 ? (
              filteredJobs.map((job) => (
                <article className="job-card" key={job.title}>
                  <div className={`company-icon ${job.color}`}>
                    <Building2 size={23} />
                  </div>

                  <div className="job-info">
                    <div className="job-title-row">
                      <h3>{job.title}</h3>
                      <button
                        className="save-button"
                        aria-label={`Save ${job.title}`}
                        onClick={() => alert("Saved jobs will be available after account features are implemented.")}
                      >
                        <Heart size={18} />
                      </button>
                    </div>

                    <div className="company-name">{job.company}</div>

                    <div className="job-metadata">
                      <span><MapPin size={14} /> {job.location}</span>
                      <span><BriefcaseBusiness size={14} /> {job.type}</span>
                      <span><Clock3 size={14} /> {job.experience}</span>
                    </div>

                    <div className="job-skills">
                      {job.skills.map((skill) => (
                        <span key={skill}>{skill}</span>
                      ))}
                    </div>

                    <div className="job-footer">
                      <span>Source: {job.source}</span>
                      <span className="sample-label">DEMO LISTING</span>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <Search size={28} />
                <h3>No matching demo listings</h3>
                <p>Try another role, skill or location.</p>
                <button
                  className="button button-primary"
                  onClick={() => {
                    setRole("");
                    setLocation("");
                    setExperience("Any experience");
                    setSearched(false);
                  }}
                >
                  Clear search
                </button>
              </div>
            )}
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
            <p>Explore opportunities collected from supported job sources.</p>
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
          <p>
            We're planning tools to help recruiters connect with suitable
            candidates and manage opportunities.
          </p>
        </div>
        <button
          className="button button-light"
          onClick={() => alert("Recruiter features will be developed in a later phase.")}
        >
          Recruiter features <ArrowRight size={16} />
        </button>
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
