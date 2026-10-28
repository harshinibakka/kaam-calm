import { describe, expect, it } from "vitest";
import { rankRecommendedJobs } from "./recommendations";

describe("preference-based recommendations", () => {
  it("prioritizes matches in titles, skills, and preferred locations", () => {
    const jobs = [
      { id: "other", title: "Support Associate", location: "Delhi", skills: ["Customer support"] },
      { id: "match", title: "Frontend Developer", location: "Bengaluru", skills: ["React", "TypeScript"] },
      { id: "skill", title: "UI Engineer", location: "Pune", skills: ["Frontend development", "React"] },
    ];
    expect(rankRecommendedJobs(jobs, ["Frontend Developer"], ["Bengaluru"], null).map((job) => job.id)).toEqual(["match", "skill", "other"]);
  });

  it("uses annual salary only when a listing includes a parseable annual range", () => {
    const jobs = [
      { id: "below", title: "Data Analyst", location: "India", salary: "From 500,000 per year" },
      { id: "above", title: "Data Analyst", location: "India", salary: "800,000 - 1,200,000 per year" },
      { id: "unknown", title: "Data Analyst", location: "India", salary: "" },
    ];
    expect(rankRecommendedJobs(jobs, ["Data Analyst"], [], 700000).map((job) => job.id)).toEqual(["above", "below", "unknown"]);
  });

  it("preserves provider order when preferences or salary data are absent", () => {
    const jobs = [{ id: "a", title: "First", location: "India" }, { id: "b", title: "Second", location: "India" }];
    expect(rankRecommendedJobs(jobs, [], [], null)).toEqual(jobs);
  });
});
