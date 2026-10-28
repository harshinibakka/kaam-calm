import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfileDashboard from "./ProfileDashboard";

const state = vi.hoisted(() => ({ client: null as any, configuration: "configured" as string }));
vi.mock("../lib/supabase", () => ({ get supabase() { return state.client; }, get supabaseConfiguration() { return state.configuration; } }));

function makeClient(row: Record<string, unknown> | null = null, upsertResult: { error: Error | null } = { error: null }) {
  const upsert = vi.fn(async (..._args: unknown[]) => upsertResult);
  const upload = vi.fn(async (_path: string, _file: File, _options?: unknown) => ({ error: null }));
  const remove = vi.fn(async (_paths: string[]) => ({ error: null }));
  const createSignedUrl = vi.fn(async (_path: string, _expiresIn: number) => ({ data: { signedUrl: "https://example.test/private-file" }, error: null }));
  const storageFrom = vi.fn(() => ({ upload, remove, createSignedUrl }));
  const client = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: row, error: null })) })) })), upsert })), storage: { from: storageFrom } };
  return { client, upsert, upload, remove, createSignedUrl, storageFrom };
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
    expect(screen.getByRole("heading", { name: "Resume and CV" })).toBeTruthy();
    expect(screen.getByLabelText("Upload resume")).toBeTruthy();
    expect(screen.getByLabelText("Upload CV")).toBeTruthy();
  });

  it("loads persisted profile data and saves edits for the authenticated user", async () => {
    const mock = makeClient({ full_name: "Riya Sharma", first_name: "Riya", last_name: "Sharma", headline: "Frontend engineer", skills: ["React"] });
    state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    expect(await screen.findByRole("heading", { name: "Riya Sharma" })).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Riya");
    await user.clear(screen.getByLabelText("Last name (optional)"));
    await user.type(screen.getByLabelText("Last name (optional)"), "S.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mock.upsert).toHaveBeenCalled());
    expect(mock.upsert.mock.calls[0][0]).toMatchObject({ user_id: "user-1", first_name: "Riya", last_name: "S.", full_name: "Riya S." });
    expect(await screen.findByText("Basic details saved.")).toBeTruthy();
  });

  it("saves an empty date of birth as null", async () => {
    const mock = makeClient();
    state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    const personalSection = screen.getByRole("heading", { name: "Personal details" }).closest("section");
    expect(personalSection).not.toBeNull();
    await user.click(personalSection!.querySelector("button")!);
    expect((screen.getByLabelText("Date of birth (optional)") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mock.upsert).toHaveBeenCalled());
    expect(mock.upsert.mock.calls[0][0]).toMatchObject({ user_id: "user-1", date_of_birth: null });
  });

  it("reports a persistence error without claiming the profile was saved", async () => {
    const mock = makeClient(null, { error: new Error("database unavailable") });
    state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.type(screen.getByLabelText("First name"), "Riya");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not save your changes/);
    expect(screen.queryByText("Basic details saved.")).toBeNull();
  });

  it("discards unsaved edits only after confirmation and returns to the profile", async () => {
    state.client = makeClient({ full_name: "Riya Sharma" }).client;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Riya Sharma" });
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Unsaved change");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.confirm).toHaveBeenCalledWith("Discard your unsaved changes?");
    expect(await screen.findByRole("heading", { name: "Riya Sharma" })).toBeTruthy();
  });

  it("loads a legacy full name into separate fields", async () => {
    state.client = makeClient({ full_name: "Harshini B" }).client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Harshini B" });
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Harshini");
    expect((screen.getByLabelText("Last name (optional)") as HTMLInputElement).value).toBe("B");
  });

  it("notifies the dashboard when the saved profile name changes", async () => {
    const mock = makeClient({ full_name: "Harshini B", first_name: "Harshini", last_name: "B" }); state.client = mock.client;
    const onProfileChange = vi.fn();
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" onProfileChange={onProfileChange} />);
    await screen.findByRole("heading", { name: "Harshini B" });
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), "Harshini");
    await user.clear(screen.getByLabelText("Last name (optional)"));
    await user.type(screen.getByLabelText("Last name (optional)"), "Sharma");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onProfileChange).toHaveBeenLastCalledWith("Harshini Sharma", expect.any(Number), "", "Harshini Sharma"));
  });

  it("keeps profile editing available when a combined name exceeds the database limit", async () => {
    const mock = makeClient(); state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "a".repeat(80) } });
    fireEvent.change(screen.getByLabelText("Middle name (optional)"), { target: { value: "b".repeat(80) } });
    fireEvent.change(screen.getByLabelText("Last name (optional)"), { target: { value: "c" } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/160 characters or fewer/);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mock.upsert).not.toHaveBeenCalled();
  });

  it("uploads and persists document metadata only after storage and profile save succeed", async () => {
    const mock = makeClient(); state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    const file = new File(["resume"], "resume.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Upload resume"), file);
    await waitFor(() => expect(mock.upload).toHaveBeenCalled());
    expect(mock.upload.mock.calls[0][0]).toMatch(/^user-1\/resume\//);
    expect(mock.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", resume_file_name: "resume.pdf", resume_file_size: 6 }), { onConflict: "user_id" });
    expect(await screen.findByText("Resume uploaded successfully.")).toBeTruthy();
  });

  it("passes the extension-normalized MIME type to private Storage", async () => {
    const mock = makeClient(); state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    await user.upload(screen.getByLabelText("Upload CV"), new File(["cv"], "cv.docx", { type: "application/octet-stream" }));
    await waitFor(() => expect(mock.upload).toHaveBeenCalled());
    expect(mock.upload.mock.calls[0][2]).toMatchObject({ contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  });

  it("cleans up a stored upload when profile metadata persistence fails", async () => {
    const mock = makeClient(null, { error: new Error("db failed") }); state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    await user.upload(screen.getByLabelText("Upload CV"), new File(["cv"], "cv.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Upload failed/);
    expect(mock.remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("CV uploaded successfully.")).toBeNull();
  });

  it("supports empty employment history for freshers without blocking a save", async () => {
    const mock = makeClient({ full_name: "Riya Sharma", first_name: "Riya", last_name: "Sharma", employment: [] }); state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Riya Sharma" });
    const employmentSection = screen.getByRole("heading", { name: "Employment" }).closest("section");
    expect(employmentSection?.textContent).toContain("If you are a fresher, you can leave this section empty.");
    await user.click(within(employmentSection!).getByRole("button", { name: "Edit" }));
    expect(await screen.findByText(/Freshers can save this section without adding work experience/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mock.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", employment: [] }), { onConflict: "user_id" }));
  });

  it("marks the first name and entered work-history fields that are required to save", async () => {
    state.client = makeClient().client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect((screen.getByLabelText("First name") as HTMLInputElement).required).toBe(true);
    await user.click(screen.getByRole("button", { name: "Back to profile" }));
    const employmentSection = screen.getByRole("heading", { name: "Employment" }).closest("section");
    await user.click(within(employmentSection!).getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "+ Add Employment" }));
    expect((screen.getByLabelText("Company *") as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText("Job title *") as HTMLInputElement).required).toBe(true);
  });

  it("stores a private photo by user-owned path, persists its path, and removes old files on replacement", async () => {
    const mock = makeClient({ full_name: "Riya Sharma", first_name: "Riya", last_name: "Sharma", avatar_path: "user-1/old.png" }); state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Riya Sharma" });
    expect(await screen.findByRole("img", { name: "Your profile" })).toBeTruthy();
    expect(mock.storageFrom).toHaveBeenCalledWith("private-job-seeker-avatars");
    await user.upload(screen.getByLabelText("Replace photo"), new File(["new image"], "portrait.png", { type: "image/png" }));
    await waitFor(() => expect(mock.upload).toHaveBeenCalled());
    const uploadedPath = String(mock.upload.mock.calls[0][0]);
    expect(uploadedPath).toMatch(/^user-1\/[0-9a-f-]+\.png$/i);
    expect(mock.upload.mock.calls[0][2]).toMatchObject({ contentType: "image/png", upsert: false });
    expect(mock.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", avatar_path: uploadedPath }), { onConflict: "user_id" });
    await waitFor(() => expect(mock.remove).toHaveBeenCalledWith(["user-1/old.png"]));
    await user.click(await screen.findByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(mock.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: "user-1", avatar_path: "" }), { onConflict: "user_id" }));
    expect(mock.remove).toHaveBeenLastCalledWith([uploadedPath]);
    expect(await screen.findByText("Profile photo removed.")).toBeTruthy();
  });

  it("does not claim a photo was saved when profile metadata persistence fails", async () => {
    const mock = makeClient(null, { error: new Error("database unavailable") }); state.client = mock.client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Build your job-seeker profile" });
    await user.upload(screen.getByLabelText("Upload photo"), new File(["image"], "portrait.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mock.remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Profile photo updated.")).toBeNull();
  });

  it("suggests matching skills, de-duplicates selections case-insensitively, and accepts custom skills", async () => {
    state.client = makeClient({ full_name: "Riya Sharma", first_name: "Riya", skills: ["React"] }).client;
    const user = userEvent.setup();
    render(<ProfileDashboard userId="user-1" />);
    await screen.findByRole("heading", { name: "Riya Sharma" });
    const skillsSection = screen.getByRole("heading", { name: "Key skills" }).closest("section");
    await user.click(within(skillsSection!).getByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Add key skills");
    await user.type(input, "rea");
    expect(screen.queryByRole("button", { name: "+ React" })).toBeNull();
    await user.clear(input);
    await user.type(input, "type");
    await user.click(screen.getByRole("button", { name: "+ TypeScript" }));
    await user.type(input, "Custom skill");
    await user.keyboard("{Enter}");
    expect(skillsSection?.querySelectorAll(".profile-chip")).toHaveLength(3);
    expect(skillsSection?.textContent).toContain("TypeScript");
    expect(skillsSection?.textContent).toContain("Custom skill");
  });
});
