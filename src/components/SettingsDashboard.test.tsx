import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsDashboard from "./SettingsDashboard";

const state = vi.hoisted(() => ({ client: null as any }));
vi.mock("../lib/supabase", () => ({ get supabase() { return state.client; } }));

function makeClient(row: Record<string, unknown> | null = null, writeError: Error | null = null, readError: Error | null = null) {
  const upsert = vi.fn(async () => ({ error: writeError }));
  const updateUser = vi.fn(async (_input: unknown) => ({ data: { user: { email: "person@example.com" } }, error: null }));
  const resetPasswordForEmail = vi.fn(async (_email: string, _options: unknown) => ({ data: {}, error: null }));
  const select = vi.fn((_columns: string) => ({ eq: vi.fn((_column: string, _userId: string) => ({ maybeSingle: vi.fn(async () => ({ data: row, error: readError })) })) }));
  const client = {
    from: vi.fn(() => ({ select, upsert })),
    auth: { updateUser, resetPasswordForEmail },
  };
  return { client, upsert, updateUser, resetPasswordForEmail, select };
}

describe("Settings", () => {
  afterEach(() => cleanup());

  it("requests an email change through Supabase and leaves the current email unverified", async () => {
    const mock = makeClient(); state.client = mock.client;
    const user = userEvent.setup();
    render(<SettingsDashboard userId="user-1" email="person@example.com" />);
    await screen.findByRole("heading", { name: "Career Preferences" });
    await user.type(screen.getByLabelText("New email address"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Request email change" }));
    expect(mock.updateUser).toHaveBeenCalledWith({ email: "new@example.com" });
    expect((await screen.findByRole("status")).textContent).toMatch(/until verification completes/);
    expect(screen.getByText("person@example.com")).toBeTruthy();
  });

  it("requests a secure reset email with a local app redirect and explains that the password has not changed", async () => {
    const mock = makeClient(); state.client = mock.client;
    const user = userEvent.setup();
    render(<SettingsDashboard userId="user-1" email="person@example.com" />);
    await screen.findByRole("heading", { name: "Career Preferences" });
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(mock.resetPasswordForEmail).toHaveBeenCalledWith("person@example.com", { redirectTo: `${window.location.origin}/?auth=password-reset` });
    expect((await screen.findByRole("status")).textContent).toMatch(/password has not changed yet/);
  });

  it("validates and updates a password only during the verified recovery flow", async () => {
    const mock = makeClient(); state.client = mock.client;
    const user = userEvent.setup();
    render(<SettingsDashboard userId="user-1" email="person@example.com" recovery />);
    await screen.findByRole("heading", { name: "Career Preferences" });
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm new password"), "short");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 8 characters/);
    expect(mock.updateUser).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("New password"));
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("New password"), "better-password");
    await user.type(screen.getByLabelText("Confirm new password"), "different-password");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not match/);
    expect(mock.updateUser).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("Confirm new password"), "better-password");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(mock.updateUser).toHaveBeenCalledWith({ password: "better-password" }));
    expect((await screen.findByRole("status")).textContent).toContain("Your password was updated.");
  });

  it("holds the mobile change control until SMS provider configuration is confirmed", async () => {
    const mock = makeClient(); state.client = mock.client;
    render(<SettingsDashboard userId="user-1" email="person@example.com" />);
    await screen.findByRole("heading", { name: "Career Preferences" });
    expect(screen.getByText(/phone authentication and SMS delivery are verified/)).toBeTruthy();
    expect(screen.getByText("Verification setup not confirmed")).toBeTruthy();
    expect(mock.updateUser).not.toHaveBeenCalled();
  });

  it("saves at most three roles, ten locations, and annual salary using the existing profile row", async () => {
    const mock = makeClient({ preferred_roles: ["React"], preferred_locations: ["Pune"], expected_salary: "800000" }); state.client = mock.client;
    const user = userEvent.setup();
    const onPreferencesSaved = vi.fn();
    render(<SettingsDashboard userId="user-1" email="person@example.com" onPreferencesSaved={onPreferencesSaved} />);
    await screen.findByRole("heading", { name: "Career Preferences" });
    expect(screen.getByText("React")).toBeTruthy();
    expect(screen.getByText("Pune")).toBeTruthy();
    expect(screen.getByText(/8,00,000 per year/)).toBeTruthy();
    expect(mock.select).toHaveBeenCalledWith("preferred_roles,preferred_role,preferred_locations,expected_salary,salary_period");
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const roles = screen.getByLabelText("Add preferred role");
    await user.type(roles, "Data Analyst"); await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("Add preferred role"), "Backend Engineer"); await user.keyboard("{Enter}");
    expect(screen.queryByLabelText("Add preferred role")).toBeNull();
    const locations = screen.getByLabelText("Add preferred location");
    await user.type(locations, "Bengaluru"); await user.keyboard("{Enter}");
    await user.clear(screen.getByLabelText("Expected annual salary (₹)"));
    await user.type(screen.getByLabelText("Expected annual salary (₹)"), "1200000");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(mock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-1", preferred_roles: ["React", "Data Analyst", "Backend Engineer"], preferred_role: "React",
      preferred_locations: ["Pune", "Bengaluru"], expected_salary: "1200000", salary_period: "Per year",
    }), { onConflict: "user_id" }));
    expect(onPreferencesSaved).toHaveBeenCalledWith({ roles: ["React", "Data Analyst", "Backend Engineer"], locations: ["Pune", "Bengaluru"], salary: "1200000" });
  });

  it("identifies the preferred roles migration when the new profile column is missing", async () => {
    const readError = Object.assign(new Error("column missing"), { code: "PGRST204" });
    const mock = makeClient(null, null, readError); state.client = mock.client;
    render(<SettingsDashboard userId="user-1" email="person@example.com" />);
    expect((await screen.findByRole("alert")).textContent).toContain("202610270002_preferred_job_roles.sql");
    expect(screen.getByRole("alert").textContent).toContain("PGRST204");
  });

  it("supports cancel and reports failed preference persistence without showing saved status", async () => {
    const mock = makeClient({ preferred_roles: ["Designer"] }, new Error("RLS denied")); state.client = mock.client;
    const user = userEvent.setup();
    render(<SettingsDashboard userId="user-1" email="person@example.com" />);
    await screen.findByRole("heading", { name: "Career Preferences" });
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    await user.type(screen.getByLabelText("Add preferred role"), "Engineer");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Designer")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not save career preferences/);
    expect(screen.queryByText("Career preferences saved.")).toBeNull();
  });
});
