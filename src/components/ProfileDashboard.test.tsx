import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfileDashboard from "./ProfileDashboard";

const state = vi.hoisted(() => ({ client: null as any, configuration: "configured" as string }));
vi.mock("../lib/supabase", () => ({ get supabase() { return state.client; }, get supabaseConfiguration() { return state.configuration; } }));

function makeClient(row: Record<string, unknown> | null = null, upsertResult: { error: Error | null } = { error: null }) {
  const upsert = vi.fn(async (..._args: unknown[]) => upsertResult);
  const client = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: row, error: null })) })) })), upsert })) };
  return { client, upsert };
}

describe("job-seeker profile", () => {
  beforeEach(() => { state.configuration = "configured"; });
  afterEach(() => cleanup());

  it("renders an empty profile and completion dashboard", async () => {
    state.client = makeClient().client;
    render(<ProfileDashboard userId="user-1" email="person@example.com" />);
    expect(await screen.findByRole("heading", { name: "Build your job-seeker profile" })).toBeTruthy();
    expect(screen.getByText("Profile completion")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Education" })).toBeTruthy();
    expect(screen.getByText(/Resume uploads are not enabled/)).toBeTruthy();
  });

  it("loads persisted profile data and saves edits for the authenticated user", async () => {
    const mock = makeClient({ full_name: "Riya Sharma", headline: "Frontend engineer", skills: ["React"] });
    state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    expect(await screen.findByRole("heading", { name: "Riya Sharma" })).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Riya S.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.upsert).toHaveBeenCalled());
    expect(mock.upsert.mock.calls[0][0]).toMatchObject({ user_id: "user-1", full_name: "Riya S." });
    expect(await screen.findByText("Basic details saved.")).toBeTruthy();
  });

  it("reports a persistence error without claiming the profile was saved", async () => {
    const mock = makeClient(null, { error: new Error("database unavailable") });
    state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.type(screen.getByLabelText("Full name"), "Riya");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not save your changes/);
    expect(screen.queryByText("Basic details saved.")).toBeNull();
  });
});
