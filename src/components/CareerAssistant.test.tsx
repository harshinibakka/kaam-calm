import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CareerAssistant from "./CareerAssistant";
import type { AssistantConversation, AssistantConversationStore, AssistantConversationSummary } from "../lib/assistantConversations";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const storedConversation: AssistantConversation = {
  id: "conversation-1",
  title: "Interview preparation",
  workflow_type: "career_chat",
  created_at: "2026-10-28T00:00:00.000Z",
  updated_at: "2026-10-28T00:00:00.000Z",
  messages: [{ role: "user", content: "Help me prepare for interviews." }, { role: "assistant", content: "Start with a specific example." }],
};
const storedSummary: AssistantConversationSummary = {
  id: storedConversation.id,
  title: storedConversation.title,
  workflow_type: "career_chat",
  created_at: storedConversation.created_at,
  updated_at: storedConversation.updated_at,
};

function createConversationStore(overrides: Partial<AssistantConversationStore> = {}): AssistantConversationStore {
  return {
    list: vi.fn(async () => ({ data: [], error: null })),
    load: vi.fn(async () => ({ data: storedConversation, error: null })),
    save: vi.fn(async (id, messages) => ({ data: { ...storedConversation, id: id ?? storedConversation.id, messages }, error: null })),
    delete: vi.fn(async () => ({ deleted: true, error: null })),
    ...overrides,
  };
}

function renderAssistant(getAccessToken: () => Promise<string | null> = vi.fn(async () => "test-access-token"), onAuthenticationRequired = vi.fn(), conversationStore?: AssistantConversationStore) {
  render(<CareerAssistant visible apiBaseUrl="http://localhost:8000" getAccessToken={getAccessToken} onAuthenticationRequired={onAuthenticationRequired} onSmartMatching={vi.fn()} conversationStore={conversationStore} />);
  return { getAccessToken, onAuthenticationRequired };
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(max-width: 700px)" && width <= 700,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

describe("CareerAssistant", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the three workspace panels, all career tools and the exact guide subtitle", () => {
    renderAssistant();
    expect(screen.getByRole("navigation", { name: "Career tools" })).toBeTruthy();
    expect(screen.getByRole("main", { name: "Career assistant conversation" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Assistant welcome and suggestions" })).toBeTruthy();
    expect(screen.getByText("Your personal career guide")).toBeTruthy();
    for (const tool of ["New Chat", "Interview Preparation", "Resume Guidance & Analyzer", "Skill Development", "Career Guidance", "Job Search Strategy", "Smart Job Matching"]) {
      expect(screen.getByRole("button", { name: new RegExp(tool) })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Find jobs matching my skills" })).toBeTruthy();
  });

  it("shows the signed-in profile photo on the right and robot avatar for assistant messages", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "Here is a useful answer.", jobs: [] }));
    render(<CareerAssistant visible apiBaseUrl="http://localhost:8000" getAccessToken={async () => "test-token"} onAuthenticationRequired={vi.fn()} onSmartMatching={vi.fn()} profileName="Harshini B" profileAvatarUrl="https://example.test/profile.png" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me prepare");
    await user.keyboard("{Enter}");
    const userRow = await screen.findByText("Help me prepare");
    const assistantRow = await screen.findByText("Here is a useful answer.");
    expect(userRow.closest(".career-assistant-message")?.classList.contains("user")).toBe(true);
    expect(userRow.closest(".career-assistant-message")?.querySelector(".career-message-avatar img")?.getAttribute("src")).toBe("https://example.test/profile.png");
    expect(assistantRow.closest(".career-assistant-message")?.classList.contains("assistant")).toBe(true);
    expect(assistantRow.closest(".career-assistant-message")?.querySelector(".career-message-avatar img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
  });

  it("sends only bounded chat messages to the backend", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "Use the STAR format.", jobs: [] }));
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "How should I prepare for an interview?");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/assistant/chat", expect.objectContaining({ method: "POST" }));
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer test-access-token" }));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(request).toEqual({ messages: [{ role: "user", content: "How should I prepare for an interview?" }] });
    expect(await screen.findByText("Use the STAR format.")).toBeTruthy();
  });

  it("shows an invalid production API configuration and keeps the draft without making a request", async () => {
    render(<CareerAssistant visible apiBaseUrl="" apiConfigurationError="Set VITE_API_BASE_URL to the public HTTPS API URL." getAccessToken={async () => "test-token"} onAuthenticationRequired={vi.fn()} onSmartMatching={vi.fn()} />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "Message the career assistant" }) as HTMLTextAreaElement;
    await user.type(input, "Keep this question");
    await user.keyboard("{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain("Set VITE_API_BASE_URL");
    expect(input.value).toBe("Keep this question");
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".career-assistant-message.user")).toHaveLength(0);
  });

  it("renders assistant Markdown headings, paragraphs, emphasis, lists, and safe external links", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      reply: "## Interview plan\n\nUse the **STAR method**:\n\n- Situation\n- Task\n\n[Official guide](https://careers.example/guide)",
      jobs: [],
    }));
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Give me a plan");
    await user.keyboard("{Enter}");

    const heading = await screen.findByRole("heading", { name: "Interview plan", level: 2 });
    const bubble = heading.closest(".career-assistant-message");
    expect(bubble?.querySelector("strong")?.textContent).toBe("STAR method");
    expect(bubble?.querySelectorAll("li")).toHaveLength(2);
    const link = within(bubble as HTMLElement).getByRole("link", { name: "Official guide" });
    expect(link.getAttribute("href")).toBe("https://careers.example/guide");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("omits raw HTML from assistant responses", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      reply: 'Safe text\n\n<img src=x onerror="alert(1)"><script>alert(1)</script>\n\nMore safe text',
      jobs: [],
    }));
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Plain answer");
    await user.keyboard("{Enter}");

    const safeText = await screen.findByText("Safe text");
    const bubble = safeText.closest(".career-assistant-message");
    expect(bubble?.querySelector("script")).toBeNull();
    expect(bubble?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
    expect(bubble?.innerHTML).not.toContain("onerror");
  });

  it("renders unsafe URL schemes as non-links", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      reply: "[Unsafe](javascript:alert%281%29) [Data](data:text/html,example) [Safe](https://safe.example/path)",
      jobs: [],
    }));
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Show links");
    await user.keyboard("{Enter}");

    const safeLink = await screen.findByRole("link", { name: "Safe" });
    const bubble = safeLink.closest(".career-assistant-message");
    expect(within(bubble as HTMLElement).queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(within(bubble as HTMLElement).queryByRole("link", { name: "Data" })).toBeNull();
    expect(safeLink.getAttribute("href")).toBe("https://safe.example/path");
  });

  it("keeps ordinary plain-text assistant responses readable", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "Build one clear example for each core skill.", jobs: [] }));
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Give me advice");
    await user.keyboard("{Enter}");

    const reply = await screen.findByText("Build one clear example for each core skill.");
    const bubble = reply.closest(".career-assistant-message");
    expect(bubble?.querySelector("h1, h2, h3, ul, ol")).toBeNull();
    expect(bubble?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
  });

  it("searches real job listings through the assistant endpoint and renders returned links", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      reply: "I found one live match from Adzuna.",
      jobs: [{ id: "adzuna-1", title: "Data Analyst", company: "Example Co", location: "Pune", url: "https://jobs.example/adzuna-1", source: "Adzuna", salary: "From 800,000 per year" }],
    }));
    renderAssistant();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Find actual jobs" }));
    const searchForm = screen.getByRole("button", { name: "Search listings" }).closest("form");
    expect(searchForm).toBeTruthy();
    await user.type(within(searchForm as HTMLFormElement).getByLabelText("Role"), "Data Analyst");
    await user.type(within(searchForm as HTMLFormElement).getByLabelText("Location"), "Pune");
    await user.click(screen.getByRole("button", { name: "Search listings" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(request.job_search).toEqual({ role: "Data Analyst", location: "Pune" });
    expect(await screen.findByText("Data Analyst")).toBeTruthy();
    const listingLink = screen.getByRole("link", { name: "View on Adzuna" });
    expect(listingLink.getAttribute("href")).toBe("https://jobs.example/adzuna-1");
  });

  it("shows safe backend errors and makes no profile or file requests", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: "private Gemini key detail" }) } as Response);
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me with my resume");
    await user.keyboard("{Enter}");

    expect((await screen.findByRole("alert")).textContent).toContain("AI Career is temporarily unavailable");
    expect(screen.getByRole("alert").textContent).not.toContain("private Gemini key detail");
    const requestBody = String(vi.mocked(fetch).mock.calls[0][1]?.body);
    expect(requestBody).not.toContain("email");
    expect(requestBody).not.toContain("phone");
    expect(requestBody).not.toContain("resume_path");
    expect(requestBody).not.toContain("profile");
  });

  it("explains how to fix a local backend connection failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me plan my career");
    await user.keyboard("{Enter}");

    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("Could not reach FastAPI at http://localhost:8000");
    expect(error.textContent).toContain("Restart Vite after changing VITE_API_BASE_URL");
    expect(error.textContent).not.toContain("Failed to fetch");
  });

  it("does not send a chat request without a current access token", async () => {
    const onAuthenticationRequired = vi.fn();
    renderAssistant(vi.fn(async () => null), onAuthenticationRequired);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me prepare");
    await user.keyboard("{Enter}");

    expect(fetch).not.toHaveBeenCalled();
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("alert")).textContent).toContain("Your session is unavailable");
  });

  it("shows the workspace welcome and suggested prompts without sending automatically", async () => {
    renderAssistant();
    const user = userEvent.setup();
    expect(screen.getByText(/Hi there!.*I'm your AI Career Assistant\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Common interview questions for SDE" }));
    expect((screen.getByRole("textbox", { name: "Message the career assistant" }) as HTMLInputElement).value).toContain("software development engineer interview questions");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([360, 390, 430])("shows the compact mobile welcome at %ipx and sends a suggested prompt", async (width) => {
    setViewportWidth(width);
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "Here are some resume improvements.", jobs: [] }));
    renderAssistant();
    const user = userEvent.setup();

    expect(screen.getByText("Kaam-Calm")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open career navigation" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Kaam-Calm career assistant welcome" })).toBeTruthy();
    expect(document.querySelector(".career-assistant-guide-panel")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button", { name: "Choose emoji" })).toBeNull();
    expect(screen.getByRole("button", { name: "Attach resume" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "How to improve my resume?" }));
    expect(await screen.findByText("Here are some resume improvements.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/assistant/chat", expect.objectContaining({ method: "POST" }));
    expect(screen.queryByRole("region", { name: "Kaam-Calm career assistant welcome" })).toBeNull();
  });

  it("opens and closes the mobile navigation drawer and returns focus on Escape", async () => {
    setViewportWidth(390);
    renderAssistant();
    const user = userEvent.setup();
    const menu = screen.getByRole("button", { name: "Open career navigation" });
    const drawer = document.getElementById("career-assistant-navigation-drawer") as HTMLElement;

    await user.click(menu);
    expect(drawer.getAttribute("aria-hidden")).toBe("false");
    expect(drawer.querySelector('button[aria-label="Close career navigation"]')).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(menu);

    await user.click(menu);
    fireEvent.touchStart(drawer, { touches: [{ identifier: 1, target: drawer, clientX: 240, clientY: 80 }] });
    fireEvent.touchEnd(drawer, { changedTouches: [{ identifier: 1, target: drawer, clientX: 150, clientY: 82 }] });
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
  });

  it("closes the mobile drawer when a tool is selected and leaves job search usable", async () => {
    setViewportWidth(390);
    renderAssistant();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open career navigation" }));
    await user.click(screen.getByRole("button", { name: "Job Search Strategy" }));
    expect(screen.getByRole("button", { name: "Search listings" })).toBeTruthy();
    expect(document.getElementById("career-assistant-navigation-drawer")?.getAttribute("aria-hidden")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Open career navigation" }));
    await user.click(screen.getByRole("button", { name: "Career Guidance" }));
    expect(screen.queryByRole("button", { name: "Search listings" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Message the career assistant" }) as HTMLTextAreaElement).value).toContain("next career steps");
  });

  it.each([1366, 1920])("keeps desktop workspace controls available at %ipx", async (width) => {
    setViewportWidth(width);
    renderAssistant();
    expect(screen.queryByRole("button", { name: "Open career navigation" })).toBeNull();
    expect(document.querySelector(".career-assistant-guide-panel")?.getAttribute("aria-hidden")).toBe("false");
  });

  it.each([360, 700, 701, 768, 1024, 1366, 1920])("keeps only Attachment and Send in the composer at %ipx", (width) => {
    setViewportWidth(width);
    renderAssistant();
    const composer = document.querySelector(".career-assistant-compose");
    expect(composer?.querySelector('[aria-label="Choose emoji"]')).toBeNull();
    expect(composer?.querySelector('[aria-label="Attach resume"]')).toBeTruthy();
    expect(composer?.querySelector('[aria-label="Send message"]')).toBeTruthy();
    expect(document.querySelector(".career-emoji-picker")).toBeNull();
  });

  it("preserves emoji characters in ordinary chat content and assistant responses", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "Happy to help 😊", jobs: [] }));
    renderAssistant();
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "Message the career assistant" });
    await user.type(input, "Hi 😊");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(request.messages).toEqual([{ role: "user", content: "Hi 😊" }]);
    expect(await screen.findByText("Happy to help 😊")).toBeTruthy();
  });

  it("sends selected resume content to the analyzer endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "## Resume review\n\n**Extracted facts:** Analyst experience." }));
    renderAssistant();
    const user = userEvent.setup();
    const resume = new File(["Experience: Data analyst. Skills: SQL, Excel. Project: Built a dashboard."], "resume.txt", { type: "text/plain" });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, resume);
    expect(screen.getByText(/resume.txt/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/assistant/resume-analysis", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByRole("heading", { name: "Resume review", level: 2 })).toBeTruthy();
  });

  it("retries a failed response without adding another user message or conversation", async () => {
    const store = createConversationStore();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network down")).mockResolvedValueOnce(jsonResponse({ reply: "Recovered answer.", jobs: [] }));
    renderAssistant(vi.fn(async () => "test-access-token"), vi.fn(), store);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me prepare");
    await user.keyboard("{Enter}");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry response" }));
    expect(await screen.findByText("Recovered answer.")).toBeTruthy();
    expect(document.querySelectorAll(".career-assistant-message.user")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenNthCalledWith(2, "conversation-1", expect.arrayContaining([{ role: "user", content: "Help me prepare" }, { role: "assistant", content: "Recovered answer." }]));
  });

  it("opens the existing Smart Job Matching flow from its welcome shortcut", async () => {
    const onSmartMatching = vi.fn();
    render(<CareerAssistant visible apiBaseUrl="http://localhost:8000" getAccessToken={vi.fn(async () => "token")} onAuthenticationRequired={vi.fn()} onSmartMatching={onSmartMatching} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Smart Job Matching" }));
    expect(onSmartMatching).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requests sign-in again when the backend rejects an expired session", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: "private auth response" }) } as Response);
    const onAuthenticationRequired = vi.fn();
    renderAssistant(vi.fn(async () => "expired-access-token"), onAuthenticationRequired);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me prepare");
    await user.keyboard("{Enter}");

    expect((await screen.findByRole("alert")).textContent).toContain("Your sign-in session expired");
    expect(screen.getByRole("alert").textContent).not.toContain("private auth response");
    expect(onAuthenticationRequired).toHaveBeenCalledTimes(1);
  });

  it("forces one Supabase token refresh and retries a chat request after an authentication rejection", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ detail: "private auth response" }) } as Response)
      .mockResolvedValueOnce(jsonResponse({ reply: "Your session was refreshed.", jobs: [] }));
    const refreshAccessToken = vi.fn(async () => "refreshed-access-token");
    const onAuthenticationRequired = vi.fn();
    render(<CareerAssistant visible apiBaseUrl="http://localhost:8000" getAccessToken={async () => "stale-access-token"} refreshAccessToken={refreshAccessToken} onAuthenticationRequired={onAuthenticationRequired} onSmartMatching={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Give me interview advice");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Your session was refreshed.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer stale-access-token" }));
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer refreshed-access-token" }));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(onAuthenticationRequired).not.toHaveBeenCalled();
  });

  it("handles malformed success JSON without showing response contents", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("<html>private proxy body</html>"); } } as unknown as Response);
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me prepare");
    await user.keyboard("{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("unreadable response");
    expect(alert.textContent).not.toContain("private proxy body");
  });

  it("shows a safe rate-limit message and respects Retry-After", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429, headers: new Headers({ "Retry-After": "17" }), json: async () => ({ detail: "private limiter data" }) } as Response);
    renderAssistant();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me prepare");
    await user.keyboard("{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("try again in 17 seconds");
    expect(alert.textContent).not.toContain("private limiter data");
  });

  it("loads saved history and continues the selected conversation", async () => {
    const store = createConversationStore({
      list: vi.fn(async () => ({ data: [storedSummary], error: null })),
    });
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "Use a concrete example and close with the result.", jobs: [] }));
    renderAssistant(vi.fn(async () => "test-access-token"), vi.fn(), store);
    const user = userEvent.setup();
    const saved = await screen.findByRole("button", { name: "Open conversation: Interview preparation" });
    await user.click(saved);
    await waitFor(() => expect(store.load).toHaveBeenCalledWith("conversation-1"));
    expect(await screen.findByText("Start with a specific example.")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me add a result");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(request.messages).toEqual([
      { role: "user", content: "Help me prepare for interviews." },
      { role: "assistant", content: "Start with a specific example." },
      { role: "user", content: "Help me add a result" },
    ]);
    expect(store.save).toHaveBeenCalledWith("conversation-1", expect.arrayContaining([
      { role: "assistant", content: "Use a concrete example and close with the result." },
    ]));
  });

  it("shows loading, empty, and safe history error states", async () => {
    let finishList: ((value: { data: AssistantConversationSummary[]; error: unknown | null }) => void) | undefined;
    const pendingStore = createConversationStore({ list: vi.fn(() => new Promise<{ data: AssistantConversationSummary[]; error: unknown | null }>((resolve) => { finishList = resolve; })) });
    renderAssistant(vi.fn(async () => "test-access-token"), vi.fn(), pendingStore);
    expect(screen.getByText(/Loading conversations/)).toBeTruthy();
    finishList?.({ data: [], error: null });
    expect(await screen.findByText("Your saved conversations will appear here.")).toBeTruthy();

    cleanup();
    const errorStore = createConversationStore({
      list: vi.fn()
        .mockResolvedValueOnce({ data: [], error: { code: "PGRST205", message: "private database details" } })
        .mockResolvedValueOnce({ data: [], error: null }),
    });
    renderAssistant(vi.fn(async () => "test-access-token"), vi.fn(), errorStore);
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("missing or has not refreshed the conversation schema");
    expect(error.textContent).toContain("202610280001");
    expect(error.textContent).not.toContain("private database details");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry history" }));
    expect(await screen.findByText("Your saved conversations will appear here.")).toBeTruthy();
    expect(errorStore.list).toHaveBeenCalledTimes(2);
  });

  it("continues the AI response when conversation saving fails", async () => {
    const store = createConversationStore({
      save: vi.fn(async () => ({ data: null, error: { code: "PGRST205", message: "private database details" } })),
    });
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ reply: "Use one concise example for each skill.", jobs: [] }));
    renderAssistant(vi.fn(async () => "test-access-token"), vi.fn(), store);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message the career assistant" }), "Help me prepare");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Use one concise example for each skill.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("alert")).textContent).toContain("This chat remains available until you leave this page.");
    expect(screen.getByRole("alert").textContent).not.toContain("private database details");
  });

  it("handles conversations deleted elsewhere and confirms local deletion", async () => {
    const store = createConversationStore({
      list: vi.fn(async () => ({ data: [storedSummary], error: null })),
      load: vi.fn(async () => ({ data: null, error: null })),
    });
    renderAssistant(vi.fn(async () => "test-access-token"), vi.fn(), store);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open conversation: Interview preparation" }));
    expect((await screen.findByRole("status")).textContent).toContain("may have been deleted");

    const deletingStore = createConversationStore({
      list: vi.fn(async () => ({ data: [storedSummary], error: null })),
    });
    cleanup();
    renderAssistant(vi.fn(async () => "test-access-token"), vi.fn(), deletingStore);
    await user.click(await screen.findByRole("button", { name: "Delete conversation" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(deletingStore.delete).toHaveBeenCalledWith("conversation-1");
    expect((await screen.findByRole("status")).textContent).toContain("Conversation deleted.");
  });

  it("does not claim deletion succeeded when the row no longer exists", async () => {
    const store = createConversationStore({
      list: vi.fn(async () => ({ data: [storedSummary], error: null })),
      delete: vi.fn(async () => ({ deleted: false, error: null })),
    });
    renderAssistant(vi.fn(async () => "test-access-token"), vi.fn(), store);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete conversation" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect((await screen.findByRole("status")).textContent).toContain("no longer available");
    expect(screen.queryByText("Conversation deleted.")).toBeNull();
  });
});
