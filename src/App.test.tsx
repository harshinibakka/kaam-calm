import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const supabaseMockState = vi.hoisted(() => ({
  client: null as any,
  configuration: "missing" as "configured" | "missing" | "invalid",
}));
const assistantConversationMock = vi.hoisted(() => ({
  store: {
    list: vi.fn(async () => ({ data: [], error: null })),
    load: vi.fn(async () => ({ data: null, error: null })),
    save: vi.fn(async (id: string | null, messages: any[]) => ({ data: { id: id ?? "conversation-1", title: messages.find((message) => message.role === "user")?.content ?? "Career conversation", workflow_type: "career_chat", created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z", messages }, error: null })),
    delete: vi.fn(async () => ({ error: null })),
  },
}));

vi.mock("./lib/supabase", () => ({
  get supabase() {
    return supabaseMockState.client;
  },
  get supabaseConfiguration() {
    return supabaseMockState.configuration;
  },
}));

vi.mock("./lib/assistantConversations", () => ({
  createAssistantConversationStore: () => assistantConversationMock.store,
}));

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 502, json: async () => body } as Response;
}

function job(id: string, title: string, description = "") {
  return {
    id,
    title,
    company: "Example Co",
    location: "Bengaluru",
    description,
    url: `https://jobs.example/${id}`,
    source: "Adzuna",
    created: "",
    type: "",
    experience: "",
    salary: "",
  };
}

async function submitSearch(role = "Frontend Developer", location = "Bengaluru") {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Job title or skill"), role);
  await user.type(screen.getByPlaceholderText("City or country"), location);
  await user.click(screen.getByRole("button", { name: "Find jobs" }));
}

function createSupabaseMock(
  initialSession: any = null,
  initialRows: any[] = [],
  options: { applicationRows?: any[]; failApplicationRead?: boolean; applicationReadCode?: string; failApplicationWrite?: boolean; profileRow?: Record<string, unknown> | null; failSavedRead?: boolean; savedReadCode?: string; failSavedWrite?: boolean; savedWriteCode?: string; failSavedDelete?: boolean; savedDeleteCode?: string } = {},
) {
  let currentSession = initialSession;
  let authListener: ((event: string, session: any) => void) | null = null;
  const inserted: any[] = [];
  const upserted: any[] = [];
  const upsertOptions: any[] = [];
  const deleted: any[] = [];
  const queryFilters: any[] = [];
  const selectCalls: any[] = [];
  const rows = [...initialRows];
  const applicationRows = [...(options.applicationRows ?? [])];

  const client = {
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        authListener = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      getSession: vi.fn(async () => ({ data: { session: currentSession }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: currentSession }, error: null })),
      signInWithPassword: vi.fn(async ({ email }) => {
        currentSession = { user: { id: "user-1", email } };
        authListener?.("SIGNED_IN", currentSession);
        return { data: { session: currentSession, user: currentSession.user }, error: null };
      }),
      signUp: vi.fn(async ({ email }) => ({
        data: { session: null, user: { id: "user-1", email } },
        error: null,
      })),
      updateUser: vi.fn(async (_updates) => ({ data: { user: currentSession?.user }, error: null })),
      resetPasswordForEmail: vi.fn(async (_email, _options) => ({ data: {}, error: null })),
      signOut: vi.fn(async () => {
        currentSession = null;
        authListener?.("SIGNED_OUT", null);
        return { error: null };
      }),
    },
    from: vi.fn((tableName: string) => {
      const tableRows = tableName === "job_seeker_applications" ? applicationRows : rows;
      return ({
      select: vi.fn((columns: string) => {
        selectCalls.push({ tableName, columns });
        return { eq: vi.fn((column: string, userId: string) => {
          queryFilters.push({ tableName, column, userId });
          return {
          order: vi.fn(async () => ({
            data: tableRows.filter((row) => row.user_id === userId),
            error: tableName === "job_seeker_applications" && options.failApplicationRead ? Object.assign(new Error("select denied"), { code: options.applicationReadCode ?? "" }) : tableName === "saved_jobs" && options.failSavedRead ? Object.assign(new Error("select denied"), { code: options.savedReadCode ?? "" }) : null,
          })),
          maybeSingle: vi.fn(async () => ({ data: tableName === "job_seeker_profiles" ? options.profileRow ?? null : null, error: null })),
          };
        }) };
      }),
      insert: vi.fn(async (row) => {
        if (tableName === "saved_jobs" && options.failSavedWrite) return { error: Object.assign(new Error("insert denied"), { code: options.savedWriteCode ?? "" }) };
        inserted.push(row);
        rows.unshift(row);
        return { error: null };
      }),
      upsert: vi.fn(async (row, upsertConfig) => {
        upserted.push(row);
        upsertOptions.push(upsertConfig);
        if (tableName === "job_seeker_applications" && options.failApplicationWrite) return { error: new Error("insert denied") };
        const index = tableRows.findIndex((item) => item.user_id === row.user_id && item.job_id === row.job_id);
        if (index < 0) tableRows.unshift(row);
        return { error: null };
      }),
      delete: vi.fn(() => ({
        eq: vi.fn((column, value) => ({
          eq: vi.fn(async (secondColumn, secondValue) => {
            const filters: Record<string, unknown> = {
              [column]: value,
              [secondColumn]: secondValue,
            };
            deleted.push(filters);
            if (tableName === "saved_jobs" && options.failSavedDelete) return { error: Object.assign(new Error("delete denied"), { code: options.savedDeleteCode ?? "" }) };
            for (let index = rows.length - 1; index >= 0; index -= 1) {
              if (rows[index].user_id === filters.user_id && rows[index].job_id === filters.job_id) {
                rows.splice(index, 1);
              }
            }
            return { error: null };
          }),
        })),
      })),
      });
    }),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://example.test/avatar-signed" }, error: null })) })) },
  };

  return { client: client as any, inserted, deleted, upserted, upsertOptions, applicationRows, queryFilters, selectCalls };
}

describe("job search flows", () => {
  it("does not search when the home page mounts or is refreshed", () => {
    const firstMount = render(<App />);
    expect(screen.getByRole("button", { name: "Find jobs" })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    firstMount.unmount();

    render(<App />);
    expect(screen.getByRole("button", { name: "Find jobs" })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("orders the mobile tabs and gates AI Career behind sign-in", async () => {
    render(<App />);
    const mobileNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(mobileNav).getAllByRole("button").map((button) => button.textContent)).toEqual(["Home", "Applied Jobs", "AI Career", "Profile"]);
    await userEvent.setup().click(within(mobileNav).getByRole("button", { name: "AI Career" }));
    expect(await screen.findByRole("dialog", { name: "Welcome back" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "AI Career Assistant" })).toBeNull();
  });

  it("opens the AI Career tab after session restoration and forwards the current access token", async () => {
    const mock = createSupabaseMock({ access_token: "restored-session-token", user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "Use a specific example.", jobs: [] }));
    render(<App />);

    await screen.findByRole("region", { name: "Your job search dashboard" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "AI Career" }));
    expect(await screen.findByRole("heading", { name: "AI Career Assistant" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Interview advice");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer restored-session-token" }));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(request).not.toHaveProperty("user_id");
  });

  it("refreshes a rejected AI Career access token and retries with the new Supabase token", async () => {
    const mock = createSupabaseMock({ access_token: "stale-session-token", user: { id: "user-1", email: "person@example.com" } });
    mock.client.auth.refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: "fresh-session-token", user: { id: "user-1", email: "person@example.com" } } },
      error: null,
    });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: "private auth response" }) } as Response)
      .mockResolvedValueOnce(jsonResponse({ reply: "The refreshed session works.", jobs: [] }));
    render(<App />);
    await screen.findByRole("region", { name: "Your job search dashboard" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "AI Career" }));
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Interview advice");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("The refreshed session works.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer stale-session-token" }));
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer fresh-session-token" }));
    expect(mock.client.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Welcome back" })).toBeNull();
  });

  it("starts one search only after the user clicks Find jobs", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [], has_more: false }));
    render(<App />);
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Find jobs" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).pathname).toBe("/api/jobs");
  });

  it("explains a real Recommended Jobs shortlist only after explicit consent choice", async () => {
    const mock = createSupabaseMock(
      { access_token: "matching-session-token", user: { id: "user-1", email: "person@example.com" } },
      [],
      { profileRow: {
        full_name: "Private Name", phone: "+1 415 555 0199", address: "Private Address", expected_salary: "900000",
        resume_path: "user-1/resume/private.pdf", resume_file_name: "private.pdf", skills: ["React"],
        preferred_roles: ["Frontend Developer"], preferred_locations: ["Bengaluru"], employment_type: "Full-time", work_mode: "Remote",
        employment: [{ role: "UI Engineer", total_experience: "3 years", company: "Private Company", current_salary: "1000000", description: "Private duties" }],
      } },
    );
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ jobs: [job("adzuna-1", "Frontend Developer")], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ matches: [{ job_id: "adzuna-1", fit_summary: "React matches this Adzuna listing.", matching_skills: ["React"], skill_gaps: ["TypeScript"] }] }));
    render(<App />);
    await screen.findByRole("region", { name: "Your job search dashboard" });
    expect(fetch).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Recommended Jobs" }));
    expect(await screen.findByRole("button", { name: "Explain matches" })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Explain matches" }));
    await user.click(screen.getByRole("checkbox", { name: /I consent to sending these selected career details/ }));
    await user.click(screen.getByRole("button", { name: "Explain with profile" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const [url, options] = vi.mocked(fetch).mock.calls[1];
    expect(new URL(String(url)).pathname).toBe("/api/assistant/match-explanations");
    expect(options?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer matching-session-token" }));
    const body = JSON.parse(String(options?.body));
    expect(body.jobs).toEqual([{ id: "adzuna-1", page: 1 }]);
    expect(body.profile_consent).toBe(true);
    expect(body.career_profile.skills).toEqual(["React"]);
    expect(body.career_profile.experience).toEqual([{ role: "UI Engineer", duration: "3 years" }]);
    expect(JSON.stringify(body.career_profile)).not.toMatch(/Private Name|Private Address|Private Company|1000000|900000|private\.pdf|resume_path|person@example\.com|415/);
    expect(await screen.findByText("React matches this Adzuna listing.")).toBeTruthy();
  });

  it("distinguishes Recommended Jobs and AI Career icons and preserves matching state when returning", async () => {
    const mock = createSupabaseMock({ access_token: "workflow-token", user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [job("adzuna-workflow", "Frontend Developer")], has_more: false }));
    render(<App />);
    await screen.findByRole("region", { name: "Your job search dashboard" });

    expect(screen.getByRole("button", { name: "Open navigation menu" })).toBeTruthy();
    const mobileNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(mobileNav).getByRole("button", { name: "AI Career" }).querySelector("svg.lucide-sparkles")).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Recommended Jobs" }));
    await user.click(await screen.findByRole("button", { name: "Explain matches" }));
    expect(screen.getByRole("group", { name: "Career profile sharing choice" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to Career Tools" }));
    expect(await screen.findByRole("heading", { name: "AI Career Assistant" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Career profile sharing choice", hidden: true })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);

    await user.click(within(mobileNav).getByRole("button", { name: "Home" }));
    expect(screen.getByRole("group", { name: "Career profile sharing choice" })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts searches from Enter and clicked popular-search chips", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [], has_more: false }));
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByPlaceholderText("Job title or skill"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find jobs" })).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Java" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(new URL(String(vi.mocked(fetch).mock.calls[1][0])).searchParams.get("role")).toBe("Java");
  });

  it("keeps the compact signed-in header, hamburger, and four-item bottom navigation at laptop, tablet, and mobile widths", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    for (const width of [1440, 900, 390, 320]) {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      const { unmount } = render(<App />);
      const header = screen.getByRole("banner");
      expect(within(header).getByRole("button", { name: "Open navigation menu" })).toBeTruthy();
      expect(within(header).getByRole("button", { name: "Notifications" })).toBeTruthy();
      expect(await within(header).findByRole("button", { name: "Sign out" })).toBeTruthy();
      expect(within(header).getByRole("link", { name: /kaam-calm/i })).toBeTruthy();
      expect(screen.queryByRole("navigation", { name: "Dashboard navigation" })).toBeNull();
      const bottomNavigation = screen.getByRole("navigation", { name: "Primary navigation" });
      for (const label of ["Home", "Applied Jobs", "AI Career", "Profile"]) {
        expect(within(bottomNavigation).getByRole("button", { name: label })).toBeTruthy();
      }
      unmount();
    }
  });

  it("keeps the mobile drawer options in a keyboard-focusable scroll region", async () => {
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open navigation menu" }));
    const scrollArea = within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("region", { name: "Navigation options" });
    expect(scrollArea.getAttribute("tabindex")).toBe("0");
    expect(within(scrollArea).getByRole("navigation", { name: "Dashboard sections" })).toBeTruthy();
  });

  beforeEach(() => {
    window.localStorage.clear();
    supabaseMockState.client = null;
    supabaseMockState.configuration = "missing";
    assistantConversationMock.store.list.mockReset().mockResolvedValue({ data: [], error: null });
    assistantConversationMock.store.load.mockReset().mockResolvedValue({ data: null, error: null });
    assistantConversationMock.store.save.mockReset().mockImplementation(async (id: string | null, messages: any[]) => ({ data: { id: id ?? "conversation-1", title: messages.find((message) => message.role === "user")?.content ?? "Career conversation", workflow_type: "career_chat", created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z", messages }, error: null }));
    assistantConversationMock.store.delete.mockReset().mockResolvedValue({ error: null });
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows Update Profile in the hamburger drawer for a restored signed-in session", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    render(<App />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Open navigation menu" }));
    const profileLink = within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Update Profile" });
    await userEvent.setup().click(profileLink);
    expect(await screen.findByRole("heading", { name: "Build your job-seeker profile" })).toBeTruthy();
    expect(mock.client.from).toHaveBeenCalledWith("job_seeker_profiles");
    expect(screen.queryByPlaceholderText("Job title or skill")).toBeNull();
  });

  it("greets the signed-in user by saved first and last name and displays a private avatar", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], {
      profileRow: { full_name: "Riya K Sharma", first_name: "Riya", middle_name: "K", last_name: "Sharma", avatar_path: "user-1/photo.webp", employment: [] },
    });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Welcome back, Riya Sharma." })).toBeTruthy();
    await waitFor(() => expect(document.querySelector("img.summary-avatar")?.getAttribute("src")).toBe("https://example.test/avatar-signed"));
  });

  it("switches themes immediately and persists the choice for the current account key", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.querySelector(".app-shell")?.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("kaam-calm-theme:anonymous")).toBe("dark");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Main navigation" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(document.querySelector(".app-shell")?.getAttribute("data-theme")).toBe("light");
  });

  it("uses the device color preference when System is selected", async () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    let matches = true;
    vi.stubGlobal("matchMedia", vi.fn(() => ({ get matches() { return matches; }, media: "(prefers-color-scheme: dark)", addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => listeners.push(listener), removeEventListener: vi.fn() })));
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(screen.getByRole("button", { name: "System" }));
    await waitFor(() => expect(document.querySelector(".app-shell")?.getAttribute("data-theme")).toBe("dark"));
    matches = false;
    listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent));
    await waitFor(() => expect(document.querySelector(".app-shell")?.getAttribute("data-theme")).toBe("light"));
  });

  it("shows honest empty states for applications and notifications", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Applied Jobs" }));
    expect(await screen.findByRole("heading", { name: "Applied Jobs" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Main navigation" })).toBeNull();
    expect(screen.getByText(/No applications tracked yet/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByText(/no notification source configured/)).toBeTruthy();
  });

  it("shows only Account & Privacy and Career Preferences in Settings", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Account & Privacy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Career Preferences" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Blocked companies" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Display" })).toBeNull();
    expect(screen.getByText("person@example.com")).toBeTruthy();
    expect(screen.getByText("Verification setup not confirmed")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Display theme" })).toBeNull();
  });

  it("edits career preferences in Settings without redirecting to Update Profile", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Edit preferences" }));
    expect(await screen.findByLabelText("Add preferred role")).toBeTruthy();
    expect(screen.getByLabelText("Expected annual salary (₹)")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Build your job-seeker profile" })).toBeNull();
  });

  it("gives accurate Help guidance for listings, applications, and unavailable support", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Help & Support" }));
    expect(await screen.findByRole("heading", { name: "Help with your job search" })).toBeTruthy();
    expect(screen.getByText(/Listings are currently provided by Adzuna/)).toBeTruthy();
    expect(screen.getByText(/Kaam-Calm does not submit applications to employers/)).toBeTruthy();
    expect(screen.getByText(/support email, and phone channel are not configured/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Main navigation" })).toBeNull();
  });

  it("keeps both job search fields labeled within the styled search form", () => {
    render(<App />);
    const roleInput = screen.getByPlaceholderText("Job title or skill");
    const locationInput = screen.getByPlaceholderText("City or country");
    expect(roleInput.closest(".search-field")).toBeTruthy();
    expect(locationInput.closest(".search-field")).toBeTruthy();
    expect(roleInput.closest("label")?.textContent).toContain("WHAT ARE YOU LOOKING FOR?");
    expect(locationInput.closest("label")?.textContent).toContain("WHERE?");
  });

  it("records an application only after explicit confirmation and loads it in Applied Jobs", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [job("a1", "Frontend Engineer")], count: 1, total_count: 1, has_more: false }));
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    await submitSearch();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Frontend Engineer" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark as applied" }));
    expect(mock.upserted).toHaveLength(0);
    confirmation.mockReturnValue(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark as applied" }));
    await waitFor(() => expect(mock.upserted).toHaveLength(1));
    expect(mock.upserted[0]).toMatchObject({ user_id: "user-1", job_id: "a1", status: "applied" });
    expect(mock.upsertOptions[0]).toMatchObject({ onConflict: "user_id,job_id", ignoreDuplicates: true });
    expect(mock.client.from).toHaveBeenCalledWith("job_seeker_applications");
    expect(screen.getByText("Applied", { selector: ".applied-badge" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Open navigation menu" }));
    await userEvent.setup().click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Applied Jobs" }));
    expect(await screen.findByText("Frontend Engineer")).toBeTruthy();
  });

  it("loads a previously tracked application from the authenticated user's records", async () => {
    const savedApplication = { user_id: "user-1", job_id: "persisted-1", title: "Saved Engineer", company: "Example Co", location: "Bengaluru", url: "https://jobs.example/persisted-1", source: "Adzuna", job_created: "", status: "applied", applied_at: "2026-10-25T10:00:00.000Z" };
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], { applicationRows: [savedApplication] });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Applied Jobs" }));
    expect(await screen.findByText("Saved Engineer")).toBeTruthy();
    expect(mock.client.from).toHaveBeenCalledWith("job_seeker_applications");
    expect(mock.selectCalls).toContainEqual({ tableName: "job_seeker_applications", columns: "job_id,title,company,location,url,source,job_created,status,applied_at" });
    expect(mock.queryFilters).toContainEqual({ tableName: "job_seeker_applications", column: "user_id", userId: "user-1" });
    expect(mock.applicationRows).toHaveLength(1);
  });

  it("does not create a duplicate when the user's existing application is loaded", async () => {
    const savedApplication = { user_id: "user-1", job_id: "a1", title: "Frontend Engineer", company: "Example Co", location: "Bengaluru", url: "https://jobs.example/a1", source: "Adzuna", job_created: "", status: "applied", applied_at: "2026-10-25T10:00:00.000Z" };
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], { applicationRows: [savedApplication] });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [job("a1", "Frontend Engineer")], has_more: false }));
    render(<App />);
    await submitSearch();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Frontend Engineer" }));
    expect(screen.getByText("Applied", { selector: ".applied-badge" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark as applied" })).toBeNull();
    expect(mock.upserted).toHaveLength(0);
    expect(mock.applicationRows).toHaveLength(1);
  });

  it("asks signed-out users to sign in instead of creating an application", async () => {
    render(<App />);
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [job("a1", "Frontend Engineer")], has_more: false }));
    await submitSearch();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Frontend Engineer" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark as applied" }));
    expect(await screen.findByRole("dialog", { name: "Welcome back" })).toBeTruthy();
    expect(screen.getByText("Sign in to track an application.")).toBeTruthy();
  });

  it("keeps the application unmarked and shows an error when the insert fails", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], { failApplicationWrite: true });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [job("a1", "Frontend Engineer")], has_more: false }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await submitSearch();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Frontend Engineer" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Mark as applied" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save your application confirmation");
    expect(screen.queryByText("Applied", { selector: ".applied-badge" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark as applied" })).toBeTruthy();
  });

  it("does not show persisted Applied badges when application loading fails", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], { applicationRows: [{ user_id: "user-1", job_id: "persisted-1", title: "Saved Engineer", company: "Example Co", location: "Bengaluru", url: "", source: "Adzuna", job_created: "", status: "applied", applied_at: "2026-10-25T10:00:00.000Z" }], failApplicationRead: true });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Applied Jobs" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load your application records");
    expect(screen.queryByText("Applied", { selector: ".applied-badge" })).toBeNull();
  });

  it("identifies an unapplied application-tracking migration and retries after setup", async () => {
    const options = { failApplicationRead: true, applicationReadCode: "PGRST205" };
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], options);
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Applied Jobs" }));
    expect((await screen.findByRole("alert")).textContent).toContain("202610260002_job_seeker_applications.sql");
    expect(screen.getByRole("alert").textContent).toContain("PGRST205");
    expect(screen.getByRole("alert").textContent).toContain("public.job_seeker_applications");
    options.failApplicationRead = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No applications tracked yet/)).toBeTruthy();
  });

  it("explains application access policy failures without showing another user's records", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], { failApplicationRead: true, applicationReadCode: "42501" });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Applied Jobs" }));
    expect((await screen.findByRole("alert")).textContent).toContain("owner-scoped RLS policies");
    expect(screen.queryByText("Saved Engineer")).toBeNull();
  });

  it("keeps search text readable in the selected dark theme", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(screen.getByRole("button", { name: "Dark" }));
    const searchInput = screen.getByPlaceholderText("Job title or skill");
    expect(searchInput.closest(".app-shell")?.getAttribute("data-theme")).toBe("dark");
    expect(searchInput.closest(".search-field")).toBeTruthy();
  });

  it("sends role and location and maps the backend jobs response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      count: 1,
      total_count: 1,
      has_more: false,
      jobs: [job("a1", "Frontend Engineer")],
      source: "Adzuna",
    }));
    render(<App />);

    await submitSearch();

    expect(await screen.findByRole("button", { name: "Frontend Engineer" })).toBeTruthy();
    const requestedUrl = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe("/api/jobs");
    expect(requestedUrl.searchParams.get("role")).toBe("Frontend Developer");
    expect(requestedUrl.searchParams.get("location")).toBe("Bengaluru");
    expect(requestedUrl.searchParams.get("page")).toBe("1");
  });

  it("shows and clears the loading state", async () => {
    let resolveResponse!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => {
      resolveResponse = resolve;
    }));
    render(<App />);

    await submitSearch();
    expect(screen.getByText("Loading real job opportunities...")).toBeTruthy();

    resolveResponse(jsonResponse({ jobs: [], count: 0, total_count: 0, has_more: false }));
    expect(await screen.findByText("No matching jobs yet")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Loading real job opportunities...")).toBeNull());
  });

  it("does not let a slower earlier search replace newer results", async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Job title or skill"), "First role");
    await user.type(screen.getByPlaceholderText("City or country"), "Bengaluru");
    await user.click(screen.getByRole("button", { name: "Find jobs" }));
    await user.clear(screen.getByPlaceholderText("Job title or skill"));
    await user.type(screen.getByPlaceholderText("Job title or skill"), "Second role");
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: "Recommended Jobs" }));
    resolveSecond(jsonResponse({ jobs: [job("new", "New result")], has_more: false }));
    expect(await screen.findByRole("button", { name: "New result" })).toBeTruthy();
    resolveFirst(jsonResponse({ jobs: [job("old", "Old result")], has_more: false }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Old result" })).toBeNull());
    expect(screen.getByRole("button", { name: "New result" })).toBeTruthy();
  });

  it("shows a request error without presenting it as an empty search", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false));
    render(<App />);

    await submitSearch();

    expect(await screen.findByText(/Could not load jobs/)).toBeTruthy();
    expect(screen.queryByText("No matching jobs yet")).toBeNull();
  });

  it("appends new jobs and removes duplicates across and within pages", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        count: 1,
        total_count: 25,
        has_more: true,
        jobs: [job("a1", "Existing job")],
      }))
      .mockResolvedValueOnce(jsonResponse({
        count: 3,
        total_count: 25,
        has_more: false,
        jobs: [job("a1", "Existing job"), job("b2", "New job"), job("b2", "Duplicate new job")],
      }));
    render(<App />);

    await submitSearch();
    await screen.findByRole("button", { name: "Existing job" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more jobs" }));

    expect(await screen.findByRole("button", { name: "New job" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Existing job" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "New job" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Duplicate new job" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more jobs" })).toBeNull();
    const nextPageUrl = new URL(String(vi.mocked(fetch).mock.calls[1][0]));
    expect(nextPageUrl.searchParams.get("role")).toBe("Frontend Developer");
    expect(nextPageUrl.searchParams.get("location")).toBe("Bengaluru");
    expect(nextPageUrl.searchParams.get("page")).toBe("2");
  });

  it("filters loaded jobs by keyword and listing text, not structured experience", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      count: 2,
      total_count: 2,
      has_more: false,
      jobs: [
        job("f1", "Graduate Software Intern", "Remote role"),
        job("e1", "Senior Engineer", "Full-time onsite role"),
      ],
    }));
    render(<App />);

    await submitSearch();
    await screen.findByRole("button", { name: "Senior Engineer" });
    expect(screen.getAllByLabelText("Experience keyword filter")).toHaveLength(1);
    await userEvent.setup().selectOptions(screen.getByLabelText("Experience keyword filter"), "Fresher");

    expect(screen.getByRole("button", { name: "Graduate Software Intern" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Senior Engineer" })).toBeNull();
    expect(screen.getByText(/Experience uses text keywords, not structured provider data/)).toBeTruthy();

    await userEvent.setup().click(
      within(screen.getByRole("group", { name: "Filter jobs by type" })).getByRole("button", { name: "Remote" })
    );
    expect(screen.getByRole("button", { name: "Graduate Software Intern" })).toBeTruthy();
  });

  it("requires authentication to save and explains missing Supabase configuration", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [job("a1", "Frontend Engineer")] }));
    render(<App />);

    await submitSearch();
    await screen.findByRole("button", { name: "Frontend Engineer" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save Frontend Engineer" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Sign in to save jobs to your account.")).toBeTruthy();
    expect(within(dialog).getByRole("alert").textContent).toContain("Supabase is not configured");
  });

  it("signs in, restores saved jobs, and signs out through Supabase auth", async () => {
    const savedRow = {
      user_id: "user-1",
      job_id: "saved-1",
      title: "Previously saved role",
      company: "Saved Co",
      location: "Pune",
      description: "Saved description",
      url: "https://jobs.example/saved-1",
      source: "Adzuna",
      job_created: "",
      type: "Full Time",
      experience: "",
      skills: [],
      salary: "",
      saved_at: "2026-10-25T00:00:00Z",
    };
    const mock = createSupabaseMock(null, [savedRow, { ...savedRow, user_id: "another-user", job_id: "private-row", title: "Other account role" }]);
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Log in" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Email"), "person@example.com");
    await user.type(within(dialog).getByLabelText("Password"), "test-password");
    await user.click(within(dialog).getByRole("button", { name: "Log in" }));

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: /Saved Jobs/ }));
    expect(await screen.findByRole("button", { name: "Previously saved role" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Other account role" })).toBeNull();
    expect(screen.getByRole("link", { name: /Apply now/ }).getAttribute("href")).toBe(
      "https://jobs.example/saved-1"
    );
    expect(mock.selectCalls).toContainEqual({ tableName: "saved_jobs", columns: "job_id,title,company,location,description,url,source,job_created,type,experience,skills,salary" });
    expect(mock.queryFilters).toContainEqual({ tableName: "saved_jobs", column: "user_id", userId: "user-1" });
    expect(mock.client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "test-password",
    });

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.getByText(/Your session ended/)).toBeTruthy();
  });

  it("inserts and deletes only through the signed-in saved-jobs client flow", async () => {
    const session = { user: { id: "user-1", email: "person@example.com" } };
    const mock = createSupabaseMock(session);
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [job("a1", "Frontend Engineer")] }));
    const user = userEvent.setup();
    render(<App />);

    await submitSearch();
    await user.click(await screen.findByRole("button", { name: "Save Frontend Engineer" }));

    await screen.findByRole("button", { name: "Unsave Frontend Engineer" });
    expect(mock.inserted).toHaveLength(1);
    expect(mock.inserted[0]).toMatchObject({
      user_id: "user-1",
      job_id: "a1",
      title: "Frontend Engineer",
    });

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: /Saved Jobs/ }));
    await user.click(await screen.findByRole("button", { name: "Unsave Frontend Engineer" }));
    expect(mock.deleted).toEqual([{ user_id: "user-1", job_id: "a1" }]);
    expect(await screen.findByText("No saved jobs yet")).toBeTruthy();
  }, 10_000);

  it("surfaces a retryable Saved Jobs migration error instead of an empty state", async () => {
    const options = { failSavedRead: true, savedReadCode: "PGRST205" };
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], options);
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open navigation menu" }));
    await user.click(within(screen.getByRole("dialog", { name: "Main navigation" })).getByRole("button", { name: /Saved Jobs/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("202610250001_saved_jobs.sql");
    expect(screen.queryByText("No saved jobs yet")).toBeNull();
    options.failSavedRead = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No saved jobs yet")).toBeTruthy();
  });

  it("keeps Saved Jobs controls unchanged after insert or delete errors", async () => {
    const options = { failSavedWrite: true, savedWriteCode: "42501", failSavedDelete: false, savedDeleteCode: "" };
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } }, [], options);
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ jobs: [job("a1", "Frontend Engineer")] }));
    const user = userEvent.setup();
    render(<App />);
    await submitSearch();
    await user.click(await screen.findByRole("button", { name: "Save Frontend Engineer" }));
    expect((await screen.findByRole("alert")).textContent).toContain("42501");
    expect(screen.getByRole("button", { name: "Save Frontend Engineer" })).toBeTruthy();
    options.failSavedWrite = false;
    await user.click(screen.getByRole("button", { name: "Save Frontend Engineer" }));
    expect(await screen.findByRole("button", { name: "Unsave Frontend Engineer" })).toBeTruthy();
    options.failSavedDelete = true;
    options.savedDeleteCode = "42501";
    await user.click(screen.getByRole("button", { name: "Unsave Frontend Engineer" }));
    expect((await screen.findByRole("alert")).textContent).toContain("42501");
    expect(screen.getByRole("button", { name: "Unsave Frontend Engineer" })).toBeTruthy();
  }, 10_000);

  it("shows the email confirmation state after sign-up", async () => {
    const mock = createSupabaseMock();
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Email"), "new@example.com");
    await user.type(within(dialog).getByLabelText("Password"), "test-password");
    await user.click(within(dialog).getByRole("button", { name: "Create account" }));

    expect(await within(dialog).findByText(/Check your email for a confirmation link/)).toBeTruthy();
    expect(mock.client.auth.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "test-password",
    });
  });

  it("keeps passwords hidden by default and provides an accessible visibility toggle in both auth modes", async () => {
    supabaseMockState.client = createSupabaseMock().client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Log in" }));
    let password = within(screen.getByRole("dialog")).getByLabelText("Password") as HTMLInputElement;
    expect(password.type).toBe("password");
    const show = within(screen.getByRole("dialog")).getByRole("button", { name: "Show password" });
    expect(show.getAttribute("aria-controls")).toBe("auth-password");
    await user.click(show);
    expect(password.type).toBe("text");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hide password" }));
    expect(password.type).toBe("password");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Create an account/ }));
    password = within(screen.getByRole("dialog")).getByLabelText("Password") as HTMLInputElement;
    expect(password.type).toBe("password");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Show password" }));
    expect(password.type).toBe("text");
  });

  it("shows authentication and session-restoration errors without exposing session data", async () => {
    const mock = createSupabaseMock();
    mock.client.auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error("Invalid login credentials"),
    });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Log in" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Email"), "person@example.com");
    await user.type(within(dialog).getByLabelText("Password"), "wrong-password");
    await user.click(within(dialog).getByRole("button", { name: "Log in" }));

    const authError = await within(dialog).findByRole("alert");
    expect(authError.textContent).toContain("Invalid login credentials");
    expect(screen.queryByRole("navigation", { name: "Dashboard navigation" })).toBeNull();
  });

  it("handles a failed session restore with a sign-in message", async () => {
    const mock = createSupabaseMock();
    mock.client.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new Error("mock restore failure"),
    });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    render(<App />);

    expect(await screen.findByText("Could not restore your session. Please sign in again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });
});
