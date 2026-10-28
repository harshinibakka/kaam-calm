import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conversationStorageErrorMessage, createAssistantConversationStore, sanitizeConversationMessages } from "./assistantConversations";

function createSupabaseQueryMock() {
  const stored = {
    id: "conversation-1",
    title: "Career guidance",
    workflow_type: "career_chat",
    created_at: "2026-10-28T00:00:00Z",
    updated_at: "2026-10-28T00:00:00Z",
    messages: [],
  };
  const query: any = {};
  query.select = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(async () => ({ data: [stored], error: null }));
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data: stored, error: null }));
  query.insert = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.single = vi.fn(async () => ({ data: stored, error: null }));
  const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  return { client, query, stored };
}

describe("assistant conversation persistence", () => {
  it("maps storage failures to actionable messages without exposing provider details", () => {
    const missingSchema = conversationStorageErrorMessage({ code: "PGRST205", message: "private schema detail" });
    expect(missingSchema).toContain("missing or has not refreshed the conversation schema");
    expect(missingSchema).not.toContain("private schema detail");
    expect(conversationStorageErrorMessage({ code: "42501" })).toContain("denied access");
    expect(conversationStorageErrorMessage({ message: "private network detail" })).toContain("Check your Supabase connection");
    expect(conversationStorageErrorMessage({ message: "private network detail" })).not.toContain("private network detail");
  });

  it("redacts tokens, API keys, contact details, and private storage URLs before saving", () => {
    const safe = sanitizeConversationMessages([{
      role: "user",
      content: "Email me@example.com, Bearer secret-token-value, eyJabcde.eyJfghij.signature123, api_key=hidden, AIza123456789012345678901234, +1 415 555 0199, https://project.supabase.co/storage/v1/object/sign/private/file.pdf?token=secret",
    }]);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("me@example.com");
    expect(serialized).not.toContain("secret-token-value");
    expect(serialized).not.toContain("eyJabcde");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toContain("AIza123");
    expect(serialized).not.toContain("415 555");
    expect(serialized).not.toContain("storage/v1/object/sign");
  });

  it("bounds the stored transcript to the configured message and byte limits", () => {
    const safe = sanitizeConversationMessages(Array.from({ length: 70 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message ${index} ${"x".repeat(9000)}`,
    })));
    expect(safe.length).toBeLessThanOrEqual(48);
    expect(new TextEncoder().encode(JSON.stringify(safe)).byteLength).toBeLessThanOrEqual(120 * 1024);
  });

  it("limits history and inserts/updates only owner-derived conversation fields", async () => {
    const { client, query, stored } = createSupabaseQueryMock();
    const store = createAssistantConversationStore(client);
    await store.list();
    expect(client.from).toHaveBeenCalledWith("assistant_conversations");
    expect(query.limit).toHaveBeenCalledWith(50);

    await store.save(null, [{ role: "user", content: "Help me plan an interview." }]);
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ workflow_type: "career_chat", title: "Help me plan an interview." }));
    expect(query.insert.mock.calls[0][0]).not.toHaveProperty("user_id");
    await store.save(stored.id, [{ role: "user", content: "Continue this plan." }]);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ workflow_type: "career_chat" }));
    expect(query.eq).toHaveBeenCalledWith("id", stored.id);
    expect(query.update.mock.calls[0][0]).not.toHaveProperty("user_id");
  });

  it("rejects malformed conversation records instead of trusting database casts", async () => {
    const { client, query, stored } = createSupabaseQueryMock();
    const store = createAssistantConversationStore(client);
    query.maybeSingle.mockResolvedValue({
      data: { ...stored, messages: [{ role: "system", content: "unexpected role" }] },
      error: null,
    });

    const result = await store.load(stored.id);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it("filters malformed history summaries before exposing them to the UI", async () => {
    const { client, query, stored } = createSupabaseQueryMock();
    const store = createAssistantConversationStore(client);
    query.limit.mockResolvedValue({
      data: [stored, { ...stored, workflow_type: "unexpected_workflow" }],
      error: null,
    });

    const result = await store.list();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].workflow_type).toBe("career_chat");
  });

  it("enforces allowed roles and the per-message character limit on loaded records", async () => {
    const { client, query, stored } = createSupabaseQueryMock();
    const store = createAssistantConversationStore(client);
    query.maybeSingle.mockResolvedValue({
      data: { ...stored, messages: [{ role: "user", content: "x".repeat(10_001) }] },
      error: null,
    });

    const result = await store.load(stored.id);

    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it("confirms deletion without disclosing whether a hidden row exists", async () => {
    const { client, query, stored } = createSupabaseQueryMock();
    const store = createAssistantConversationStore(client);

    await expect(store.delete(stored.id)).resolves.toEqual({ deleted: true, error: null });
    expect(query.delete).toHaveBeenCalledOnce();
    expect(query.select).toHaveBeenCalledWith("id");

    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(store.delete("missing-or-inaccessible")).resolves.toEqual({ deleted: false, error: null });

    const deleteError = new Error("database internals must not reach the UI");
    query.maybeSingle.mockResolvedValue({ data: null, error: deleteError });
    await expect(store.delete(stored.id)).resolves.toEqual({ deleted: false, error: deleteError });
  });
});
