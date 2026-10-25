import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const supabaseMockState = vi.hoisted(() => ({
  client: null as any,
  configuration: "missing" as "configured" | "missing" | "invalid",
}));

vi.mock("./lib/supabase", () => ({
  get supabase() {
    return supabaseMockState.client;
  },
  get supabaseConfiguration() {
    return supabaseMockState.configuration;
  },
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

function createSupabaseMock(initialSession: any = null, initialRows: any[] = []) {
  let currentSession = initialSession;
  let authListener: ((event: string, session: any) => void) | null = null;
  const inserted: any[] = [];
  const deleted: any[] = [];
  const rows = [...initialRows];

  const client = {
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        authListener = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      getSession: vi.fn(async () => ({ data: { session: currentSession }, error: null })),
      signInWithPassword: vi.fn(async ({ email }) => {
        currentSession = { user: { id: "user-1", email } };
        authListener?.("SIGNED_IN", currentSession);
        return { data: { session: currentSession, user: currentSession.user }, error: null };
      }),
      signUp: vi.fn(async ({ email }) => ({
        data: { session: null, user: { id: "user-1", email } },
        error: null,
      })),
      signOut: vi.fn(async () => {
        currentSession = null;
        authListener?.("SIGNED_OUT", null);
        return { error: null };
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((_column, userId) => ({
          order: vi.fn(async () => ({
            data: rows.filter((row) => row.user_id === userId),
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
      insert: vi.fn(async (row) => {
        inserted.push(row);
        rows.unshift(row);
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
            for (let index = rows.length - 1; index >= 0; index -= 1) {
              if (rows[index].user_id === filters.user_id && rows[index].job_id === filters.job_id) {
                rows.splice(index, 1);
              }
            }
            return { error: null };
          }),
        })),
      })),
    })),
  };

  return { client: client as any, inserted, deleted };
}

describe("job search flows", () => {
  beforeEach(() => {
    window.localStorage.clear();
    supabaseMockState.client = null;
    supabaseMockState.configuration = "missing";
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

  it("shows My Profile only for a restored signed-in session and opens the dashboard", async () => {
    const mock = createSupabaseMock({ user: { id: "user-1", email: "person@example.com" } });
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    render(<App />);

    const profileLink = await screen.findByRole("button", { name: "My Profile" });
    await userEvent.setup().click(profileLink);
    expect(await screen.findByRole("heading", { name: "Build your job-seeker profile" })).toBeTruthy();
    expect(mock.client.from).toHaveBeenCalledWith("job_seeker_profiles");
    expect(screen.queryByPlaceholderText("Job title or skill")).toBeNull();
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
    await user.click(screen.getByRole("button", { name: "Applied Jobs" }));
    expect(await screen.findByRole("heading", { name: "Applied Jobs" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Main navigation" })).toBeNull();
    expect(screen.getByText(/does not receive application confirmations/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByText(/no notification source configured/)).toBeTruthy();
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
    const mock = createSupabaseMock(null, [savedRow]);
    supabaseMockState.client = mock.client;
    supabaseMockState.configuration = "configured";
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Log in" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Email"), "person@example.com");
    await user.type(within(dialog).getByLabelText("Password"), "test-password");
    await user.click(within(dialog).getByRole("button", { name: "Log in" }));

    const savedJobsButton = await screen.findByRole("button", { name: "Saved jobs (1)" });
    await user.click(savedJobsButton);
    expect(await screen.findByRole("button", { name: "Previously saved role" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Apply now/ }).getAttribute("href")).toBe(
      "https://jobs.example/saved-1"
    );
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

    await screen.findByRole("button", { name: "Saved jobs (0)" });
    await submitSearch();
    await user.click(await screen.findByRole("button", { name: "Save Frontend Engineer" }));

    await screen.findByRole("button", { name: "Unsave Frontend Engineer" });
    expect(mock.inserted).toHaveLength(1);
    expect(mock.inserted[0]).toMatchObject({
      user_id: "user-1",
      job_id: "a1",
      title: "Frontend Engineer",
    });

    await user.click(screen.getByRole("button", { name: "Saved jobs (1)" }));
    await user.click(await screen.findByRole("button", { name: "Unsave Frontend Engineer" }));
    expect(mock.deleted).toEqual([{ user_id: "user-1", job_id: "a1" }]);
    expect(await screen.findByText("No saved jobs yet")).toBeTruthy();
  });

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
    expect(screen.queryByRole("button", { name: "Saved jobs (0)" })).toBeNull();
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
