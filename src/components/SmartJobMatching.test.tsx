import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SmartJobMatching, { type SmartMatchCareerProfile } from "./SmartJobMatching";

const profile: SmartMatchCareerProfile = {
  skills: ["React", "TypeScript"],
  preferred_roles: ["Frontend Developer"],
  preferred_locations: ["Bengaluru"],
  experience: [{ role: "UI Engineer", duration: "3 years" }],
  work_preferences: ["Remote"],
};
const jobs = [{ id: "adzuna-1", page: 1, title: "Frontend Developer", company: "Example Co" }];

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, headers: new Headers(), json: async () => body } as Response;
}

function renderMatcher(overrides: Partial<ComponentProps<typeof SmartJobMatching>> = {}) {
  return render(<SmartJobMatching
    apiBaseUrl="http://localhost:8000"
    jobs={jobs}
    role="Frontend Developer"
    location="Bengaluru"
    careerProfile={profile}
    isAuthenticated
    getAccessToken={vi.fn(async () => "valid-token")}
    onAuthenticationRequired={vi.fn()}
    onBackToCareerTools={vi.fn()}
    {...overrides}
  />);
}

describe("Smart Job Matching", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("does not call the API automatically and can explain without sending profile data", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ matches: [{ job_id: "adzuna-1", fit_summary: "React aligns with the listing.", matching_skills: ["React"], skill_gaps: [] }] }));
    renderMatcher();
    expect(fetch).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Explain matches" }));
    expect(screen.getByText(/Google Gemini will receive only your skills/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Explain without profile" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/assistant/match-explanations", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer valid-token" }),
    }));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.profile_consent).toBe(false);
    expect(body).not.toHaveProperty("career_profile");
    expect(body.jobs).toEqual([{ id: "adzuna-1", page: 1 }]);
    expect(await screen.findByText("React aligns with the listing.")).toBeTruthy();
  });

  it("sends only the narrow career profile after an explicit unchecked-by-default consent", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ matches: [{ job_id: "adzuna-1", fit_summary: "Good fit.", matching_skills: [], skill_gaps: [] }] }));
    renderMatcher();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Explain matches" }));
    const consent = screen.getByRole("checkbox", { name: /I consent to sending these selected career details/ });
    expect((consent as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Explain with profile" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(consent);
    await user.click(screen.getByRole("button", { name: "Explain with profile" }));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.profile_consent).toBe(true);
    expect(body.career_profile).toEqual(profile);
    expect(JSON.stringify(body)).not.toMatch(/full_name|email|phone|address|salary|resume|storage_path/i);
  });

  it("requires sign in and does not fetch without a current access token", async () => {
    const onAuthenticationRequired = vi.fn();
    renderMatcher({ getAccessToken: vi.fn(async () => null), onAuthenticationRequired });
    await userEvent.setup().click(screen.getByRole("button", { name: "Explain matches" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Explain without profile" }));
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("filters explanations for unknown job IDs and shows an empty-result message", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ matches: [{ job_id: "invented", fit_summary: "Invented role.", matching_skills: [], skill_gaps: [] }] }));
    const { rerender } = renderMatcher();
    const props = {
      apiBaseUrl: "http://localhost:8000", jobs, role: "Frontend Developer", location: "Bengaluru",
      careerProfile: profile, isAuthenticated: true, getAccessToken: async () => "valid-token", onAuthenticationRequired: vi.fn(), onBackToCareerTools: vi.fn(),
    };
    await userEvent.setup().click(screen.getByRole("button", { name: "Explain matches" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Explain without profile" }));
    expect((await screen.findByRole("status")).textContent).toContain("No verified match explanations");
    expect(screen.queryByText("Invented role.")).toBeNull();
    rerender(<SmartJobMatching {...props} />);
    vi.mocked(fetch).mockResolvedValue(response({ matches: [], message: "Refresh listings and try again." }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Explain matches" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Explain without profile" }));
    expect((await screen.findByRole("status")).textContent).toContain("Refresh listings and try again.");
  });

  it("shows safe provider and rate limit errors", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ detail: "Too many assistant requests. Please try again later." }, false, 429));
    renderMatcher();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Explain matches" }));
    await user.click(screen.getByRole("button", { name: "Explain without profile" }));
    expect((await screen.findByRole("alert")).textContent).toContain("assistant is rate limited");
  });

  it("returns to Career Tools without clearing an unfinished workflow", async () => {
    const onBackToCareerTools = vi.fn();
    renderMatcher({ onBackToCareerTools });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Explain matches" }));
    await user.click(screen.getByRole("button", { name: "Back to Career Tools" }));
    expect(onBackToCareerTools).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("group", { name: "Career profile sharing choice" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /I consent to sending/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("requires confirmation to end a session and preserves it when cancelled", async () => {
    const onBackToCareerTools = vi.fn();
    renderMatcher({ onBackToCareerTools });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Explain matches" }));
    await user.click(screen.getByRole("button", { name: "End Session" }));
    expect(screen.getByRole("group", { name: "Confirm ending Smart Job Matching session" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("group", { name: "Career profile sharing choice" })).toBeTruthy();
    expect(onBackToCareerTools).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "End Session" }));
    await user.click(screen.getByRole("button", { name: "Confirm End Session" }));
    expect(onBackToCareerTools).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: "Career profile sharing choice" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Confirm ending Smart Job Matching session" })).toBeNull();
  });
});
