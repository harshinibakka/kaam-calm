import type { SupabaseClient } from "@supabase/supabase-js";

export type StoredAssistantMessage = { role: "user" | "assistant"; content: string };
export type AssistantConversation = {
  id: string;
  title: string;
  workflow_type: "career_chat";
  created_at: string;
  updated_at: string;
  messages: StoredAssistantMessage[];
};
export type AssistantConversationSummary = Omit<AssistantConversation, "messages">;

export type AssistantConversationStore = {
  list: () => Promise<{ data: AssistantConversationSummary[]; error: unknown | null }>;
  load: (id: string) => Promise<{ data: AssistantConversation | null; error: unknown | null }>;
  save: (id: string | null, messages: StoredAssistantMessage[]) => Promise<{ data: AssistantConversation | null; error: unknown | null }>;
  delete: (id: string) => Promise<{ deleted: boolean; error: unknown | null }>;
};

const TABLE = "assistant_conversations";
const COLUMNS = "id,title,workflow_type,created_at,updated_at,messages";
const SUMMARY_COLUMNS = "id,title,workflow_type,created_at,updated_at";
const MAX_HISTORY_ITEMS = 50;
const MAX_MESSAGES = 48;
const MAX_SERIALIZED_BYTES = 120 * 1024;
const MAX_MESSAGE_CHARS = 10_000;
const MAX_TITLE_CHARS = 80;

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_ASSIGNMENT = /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|secret|password)\s*[:=]\s*[^\s,;]+/gi;
const COMMON_API_KEY = /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{20,})\b/g;
const PRIVATE_FILE_URL = /https?:\/\/[^\s)\]]+/gi;

export function sanitizeConversationText(value: string): string {
  return value
    .replace(BEARER, "[bearer token removed]")
    .replace(JWT, "[token removed]")
    .replace(SECRET_ASSIGNMENT, "$1=[secret removed]")
    .replace(COMMON_API_KEY, "[API key removed]")
    .replace(PRIVATE_FILE_URL, (url) => /\/storage\/v1\/object\/(?:sign|authenticated)\//i.test(url) ? "[private file URL removed]" : url)
    .replace(EMAIL, "[email removed]")
    .replace(PHONE, "[phone removed]")
    .slice(0, MAX_MESSAGE_CHARS);
}

export function sanitizeConversationMessages(messages: StoredAssistantMessage[]): StoredAssistantMessage[] {
  const safeMessages = messages.slice(-MAX_MESSAGES).map(({ role, content }) => ({
    role,
    content: sanitizeConversationText(content),
  }));
  while (safeMessages.length > 1 && new TextEncoder().encode(JSON.stringify(safeMessages)).byteLength > MAX_SERIALIZED_BYTES) {
    safeMessages.shift();
  }
  return safeMessages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function conversationStorageErrorMessage(error: unknown): string {
  const details = isRecord(error) ? error : {};
  const code = typeof details.code === "string" ? details.code : "";
  const status = typeof details.status === "number" ? details.status : 0;

  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) {
    return "Conversation history is unavailable because this Supabase project is missing or has not refreshed the conversation schema. Ask the project maintainer to verify migrations 202610280001 and 202610280002. Your chat can still continue, but it may not be saved.";
  }
  if (["42501", "PGRST301"].includes(code) || status === 401 || status === 403) {
    return "Supabase denied access to conversation history. Confirm your sign-in session and the authenticated conversation grants and owner policies. Your chat can still continue.";
  }
  if (code === "23514") {
    return "Supabase rejected the saved conversation because its message format or size did not meet the database limits. Your chat can still continue.";
  }
  return "Conversation history is unavailable. Check your Supabase connection and try again. Your current chat can still be used, but it may not be saved.";
}

export function isStoredAssistantMessage(value: unknown): value is StoredAssistantMessage {
  return isRecord(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "role")
    && Object.hasOwn(value, "content")
    && (value.role === "user" || value.role === "assistant")
    && typeof value.content === "string"
    && value.content.length <= MAX_MESSAGE_CHARS;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isAssistantConversationSummary(value: unknown): value is AssistantConversationSummary {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.title === "string" && value.title.length >= 1 && value.title.length <= MAX_TITLE_CHARS
    && value.workflow_type === "career_chat"
    && isValidTimestamp(value.created_at)
    && isValidTimestamp(value.updated_at);
}

export function isAssistantConversation(value: unknown): value is AssistantConversation {
  if (!isAssistantConversationSummary(value)) return false;
  const messages = (value as Record<string, unknown>).messages;
  return Array.isArray(messages)
    && messages.length <= MAX_MESSAGES
    && messages.every(isStoredAssistantMessage)
    && new TextEncoder().encode(JSON.stringify(messages)).byteLength <= MAX_SERIALIZED_BYTES;
}

function titleFromMessages(messages: StoredAssistantMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content ?? "Career conversation";
  const normalized = sanitizeConversationText(firstUserMessage).replace(/\s+/g, " ").trim();
  if (normalized.length <= 80) return normalized || "Career conversation";
  return `${normalized.slice(0, 77).trimEnd()}…`;
}

export function createAssistantConversationStore(client: SupabaseClient): AssistantConversationStore {
  return {
    async list() {
      const { data, error } = await client
        .from(TABLE)
        .select(SUMMARY_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(MAX_HISTORY_ITEMS);
      const rows: unknown[] = Array.isArray(data) ? data : [];
      const validRows = rows.filter(isAssistantConversationSummary);
      return {
        data: validRows,
        error: error ?? (validRows.length === rows.length ? null : new Error("Invalid assistant conversation summary")),
      };
    },
    async load(id) {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) return { data: null, error };
      if (data === null) return { data: null, error: null };
      return isAssistantConversation(data)
        ? { data, error: null }
        : { data: null, error: new Error("Invalid assistant conversation record") };
    },
    async save(id, messages) {
      const safeMessages = sanitizeConversationMessages(messages);
      const payload = {
        title: titleFromMessages(safeMessages),
        workflow_type: "career_chat" as const,
        messages: safeMessages,
      };
      const query = id
        ? client.from(TABLE).update(payload).eq("id", id)
        : client.from(TABLE).insert(payload);
      const { data, error } = await query.select(COLUMNS).single();
      if (error) return { data: null, error };
      return isAssistantConversation(data)
        ? { data, error: null }
        : { data: null, error: new Error("Invalid assistant conversation response") };
    },
    async delete(id) {
      const { data, error } = await client.from(TABLE).delete().eq("id", id).select("id").maybeSingle();
      return { deleted: !error && isRecord(data) && data.id === id, error };
    },
  };
}
