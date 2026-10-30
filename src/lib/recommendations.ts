export type RecommendationJob = {
  title: string;
  location: string;
  skills?: string[];
  salary?: string;
};

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function salaryRange(salary: string): [number, number] | null {
  const values = [...salary.matchAll(/\d[\d,]*/g)].map(([value]) => Number(value.replaceAll(",", ""))).filter(Number.isFinite);
  if (!values.length) return null;
  return [values[0], values[1] ?? values[0]];
}

function scoreJob(job: RecommendationJob, roles: string[], locations: string[], expectedAnnualSalary: number | null): number {
  const title = normalize(job.title);
  const skills = (job.skills ?? []).map(normalize);
  const location = normalize(job.location);
  let score = 0;
  for (const role of roles) {
    const normalizedRole = normalize(role);
    if (!normalizedRole) continue;
    if (title.includes(normalizedRole)) score += 5;
    else if (skills.some((skill) => skill.includes(normalizedRole) || normalizedRole.includes(skill))) score += 3;
    else if (normalizedRole.split(/\s+/).some((token) => token.length > 2 && (title.includes(token) || skills.some((skill) => skill.includes(token))))) score += 1;
  }
  for (const preferredLocation of locations) {
    const normalizedLocation = normalize(preferredLocation);
    if (normalizedLocation && location.includes(normalizedLocation)) score += 3;
  }
  if (expectedAnnualSalary && job.salary) {
    const range = salaryRange(job.salary);
    if (range) score += range[1] >= expectedAnnualSalary ? (range[0] >= expectedAnnualSalary ? 2 : 1) : 0;
  }
  return score;
}

export function rankRecommendedJobs<T extends RecommendationJob>(jobs: T[], roles: string[], locations: string[], expectedAnnualSalary: number | null): T[] {
  return jobs.map((job, index) => ({ job, index, score: scoreJob(job, roles, locations, expectedAnnualSalary) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ job }) => job);
}
