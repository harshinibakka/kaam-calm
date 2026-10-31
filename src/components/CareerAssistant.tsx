import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent, type TouchEvent as ReactTouchEvent } from "react";
import { ArrowUpRight, BriefcaseBusiness, Clock3, Menu, MessageSquareText, Send, Sparkles, Trash2, Paperclip, X, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { conversationStorageErrorMessage, type AssistantConversationStore, type AssistantConversationSummary, type StoredAssistantMessage } from "../lib/assistantConversations";
import careerRobot from "../assets/career-robot.svg";

type ChatRole = "user" | "assistant";
type AssistantMessage = { role: ChatRole; content: string; jobs?: AssistantJob[]; createdAt?: string };
type AssistantJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  salary: string;
};

type CareerAssistantProps = {
  visible: boolean;
  apiBaseUrl: string;
  apiConfigurationError?: string | null;
  getAccessToken: () => Promise<string | null>;
  refreshAccessToken?: () => Promise<string | null>;
  onAuthenticationRequired: () => void;
  onSmartMatching: () => void;
  conversationStore?: AssistantConversationStore | null;
  profileName?: string;
  profileAvatarUrl?: string;
};

function assistantHttpError(response: Response, operation: "chat" | "resume"): Error {
  if (response.status === 401) return new Error("Your sign-in session expired. Sign in again, then retry.");
  if (response.status === 403) return new Error("Your account does not have access to this assistant request.");
  if (response.status === 413) return new Error(operation === "resume" ? "The attachment is too large. Choose a file smaller than 10 MB." : "This request is too large. Shorten your message and try again.");
  if (response.status === 415) return new Error("Unsupported attachment. Use PDF, DOCX, TXT, JPG, PNG, or WEBP.");
  if (response.status === 422) return new Error("The request could not be validated. Check the message or attachment and try again.");
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    return new Error(Number.isFinite(retryAfter) && retryAfter > 0
      ? `The assistant is rate limited. Please try again in ${Math.ceil(retryAfter)} seconds.`
      : "The assistant is rate limited. Please wait a moment and try again.");
  }
  if (response.status === 503) return new Error("AI Career is temporarily unavailable. Check the backend AI provider and assistant protection configuration, then retry.");
  if (response.status === 504) return new Error("The AI request took too long. Please try again.");
  if (response.status === 502) return new Error("The AI service could not complete this request. Please try again later.");
  return new Error("The career assistant is temporarily unavailable. Please try again.");
}

async function assistantJson(response: Response, operation: "chat" | "resume", onAuthenticationRequired: () => void): Promise<Record<string, unknown>> {
  let result: unknown = null;
  try { result = await response.json(); } catch { /* Do not display an empty or non-JSON proxy response. */ }
  if (!response.ok) {
    if (response.status === 401) onAuthenticationRequired();
    throw assistantHttpError(response, operation);
  }
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("The career assistant returned an unreadable response. Please retry.");
  }
  return result as Record<string, unknown>;
}

async function fetchAssistantWithRefresh(
  url: string,
  init: RequestInit,
  accessToken: string,
  refreshAccessToken?: () => Promise<string | null>,
): Promise<Response> {
  const send = (token: string) => {
    const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` };
    return fetch(url, { ...init, headers });
  };
  const response = await send(accessToken);
  if (response.status !== 401 || !refreshAccessToken) return response;
  console.warn("AI Career auth diagnostic (attempt=initial result=401 bearer_header_attached=true)");

  try {
    const refreshedToken = await refreshAccessToken();
    console.info(`AI Career auth diagnostic (refresh_access_token_available=${Boolean(refreshedToken)})`);
    if (!refreshedToken) return response;
    const retryResponse = await send(refreshedToken);
    console.info(`AI Career auth diagnostic (attempt=refreshed_retry result_status=${retryResponse.status})`);
    return retryResponse;
  } catch {
    // Keep the original 401 behavior when refresh itself is unavailable.
    console.warn("AI Career auth diagnostic (refresh_attempt=failed result=original_401_retained)");
    return response;
  }
}

function requestErrorMessage(error: unknown, apiBaseUrl: string, timeoutMessage: string): string {
  if (error instanceof TypeError) return connectionError(apiBaseUrl);
  if (error instanceof Error && error.name === "TimeoutError") return timeoutMessage;
  return error instanceof Error ? error.message : "The career assistant is temporarily unavailable. Please try again.";
}

function connectionError(apiBaseUrl: string): string {
  try {
    const apiUrl = new URL(apiBaseUrl);
    if (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1" || apiUrl.hostname === "[::1]") {
      return `Could not reach FastAPI at ${apiUrl.origin}. Confirm the backend is running and allows requests from ${window.location.origin}. Restart Vite after changing VITE_API_BASE_URL.`;
    }
  } catch {
    // Fall through to the generic message when the configured API URL is invalid.
  }
  return "Could not reach the configured Kaam-Calm API. Check your connection and frontend API URL.";
}

function safeMarkdownUrl(value: string): string {
  const url = value.trim();
  if (url.startsWith("#")) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function MarkdownLink({ href, children }: ComponentProps<"a">) {
  const safeHref = href ? safeMarkdownUrl(href) : "";
  if (!safeHref) return <span>{children}</span>;
  const external = /^https?:\/\//i.test(safeHref);
  return (
    <a href={safeHref} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}
const suggestedPrompts = [
  { label: "How to improve my resume?", prompt: "How can I improve my resume for the roles I want?" },
  { label: "Common interview questions for SDE", prompt: "What are common software development engineer interview questions, and how should I prepare?" },
  { label: "Tell me a learning roadmap for AI/ML", prompt: "Create a practical learning roadmap for AI and machine learning." },
  { label: "Find jobs matching my skills", action: "matching" as const },
];

export default function CareerAssistant({ visible, apiBaseUrl, apiConfigurationError = null, getAccessToken, refreshAccessToken, onAuthenticationRequired, onSmartMatching, conversationStore = null, profileName = "", profileAvatarUrl = "" }: CareerAssistantProps) {
  const [isMobileViewport, setIsMobileViewport] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 700px)").matches));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [conversations, setConversations] = useState<AssistantConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRetry, setHistoryRetry] = useState(0);
  const [historyNotice, setHistoryNotice] = useState("");
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [showJobSearch, setShowJobSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [uploadStage, setUploadStage] = useState("");
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState("");
  const [profileAvatarFailed, setProfileAvatarFailed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(max-width: 700px)");
    const updateViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
      if (!mediaQuery.matches) setMobileNavOpen(false);
    };
    updateViewport();
    mediaQuery.addEventListener?.("change", updateViewport);
    return () => mediaQuery.removeEventListener?.("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!visible || !isMobileViewport) return;
    const workspace = workspaceRef.current;
    const visualViewport = window.visualViewport;
    const updateVisibleViewport = () => {
      workspace?.style.setProperty("--career-visual-height", `${visualViewport?.height ?? window.innerHeight}px`);
      workspace?.style.setProperty("--career-visual-top", `${visualViewport?.offsetTop ?? 0}px`);
    };
    updateVisibleViewport();
    visualViewport?.addEventListener("resize", updateVisibleViewport);
    visualViewport?.addEventListener("scroll", updateVisibleViewport);
    window.addEventListener("resize", updateVisibleViewport);
    return () => {
      visualViewport?.removeEventListener("resize", updateVisibleViewport);
      visualViewport?.removeEventListener("scroll", updateVisibleViewport);
      window.removeEventListener("resize", updateVisibleViewport);
    };
  }, [isMobileViewport, visible]);

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const measuredMax = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
    const maxHeight = Number.isFinite(measuredMax) ? measuredMax : 160;
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 38), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft, isMobileViewport, visible]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  useEffect(() => setProfileAvatarFailed(false), [profileAvatarUrl]);

  useEffect(() => {
    if (!attachment || !attachment.type.startsWith("image/")) { setAttachmentPreview(""); return; }
    const url = URL.createObjectURL(attachment); setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  const selectAttachment = (file: File | null) => {
    setAttachmentError(""); setAttachment(null);
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const types: Record<string, string[]> = { pdf: ["application/pdf"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], txt: ["text/plain"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"], webp: ["image/webp"] };
    if (!types[extension]) { setAttachmentError("Supported attachments: PDF, DOCX, TXT, JPG, PNG, and WEBP. Legacy DOC files are unsupported."); if (fileRef.current) fileRef.current.value = ""; return; }
    if (file.size <= 0) { setAttachmentError("The selected file is empty."); return; }
    if (file.size > 10 * 1024 * 1024) { setAttachmentError("Choose a file smaller than 10 MB."); return; }
    if (file.type && file.type !== "application/octet-stream" && !types[extension].includes(file.type)) { setAttachmentError("The file type does not match its extension."); return; }
    setAttachment(file);
  };
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, visible, busy]);

  useEffect(() => {
    if (!visible || !conversationStore) return;
    let current = true;
    setHistoryLoading(true);
    setHistoryError("");
    void (async () => {
      try {
        const { data, error: listError } = await conversationStore.list();
        if (!current) return;
        if (listError) throw listError;
        setConversations(data);
      } catch (listError: unknown) {
        if (current) setHistoryError(conversationStorageErrorMessage(listError));
      } finally {
        if (current) setHistoryLoading(false);
      }
    })();
    return () => { current = false; };
  }, [visible, conversationStore, historyRetry]);

  const saveConversation = async (transcript: StoredAssistantMessage[], conversationId = activeConversationId): Promise<string | null> => {
    if (!conversationStore) return conversationId;
    try {
      const { data, error: saveError } = await conversationStore.save(conversationId, transcript);
      if (saveError || !data) throw saveError ?? new Error("Conversation save returned no record");
      setActiveConversationId(data.id);
      setConversations((current) => [
        { id: data.id, title: data.title, workflow_type: data.workflow_type, created_at: data.created_at, updated_at: data.updated_at },
        ...current.filter((conversation) => conversation.id !== data.id),
      ].slice(0, 50));
      setHistoryError("");
      return data.id;
    } catch (saveError: unknown) {
      setHistoryError(`${conversationStorageErrorMessage(saveError)} This chat remains available until you leave this page.`);
      return conversationId;
    }
  };

  const startNewConversation = () => {
    if (busy || conversationBusy) return;
    setActiveConversationId(null);
    setMessages([]);
    setDraft("");
    setError("");
    setRetryAction(null);
    setHistoryError("");
    setHistoryNotice("");
    setShowJobSearch(false);
    setJobRole("");
    setJobLocation("");
    setDeletingConversationId(null);
  };

  const prepareMobileToolSelection = () => {
    if (isMobileViewport) setShowJobSearch(false);
    setMobileNavOpen(false);
  };

  const openSmartMatching = () => {
    prepareMobileToolSelection();
    onSmartMatching();
  };

  const rememberDrawerTouch = (event: ReactTouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (touch) drawerTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const closeDrawerOnLeftSwipe = (event: ReactTouchEvent<HTMLElement>) => {
    const start = drawerTouchStartRef.current;
    const touch = event.changedTouches[0];
    drawerTouchStartRef.current = null;
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (deltaX < -60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) setMobileNavOpen(false);
  };

  const openConversation = async (conversationId: string) => {
    if (!conversationStore || busy || conversationBusy) return;
    setConversationBusy(true);
    setHistoryError("");
    setHistoryNotice("");
    try {
      const { data, error: loadError } = await conversationStore.load(conversationId);
      if (loadError) throw loadError;
      if (!data) {
        setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
        setActiveConversationId(null);
        setMessages([]);
        setHistoryNotice("This conversation is no longer available. It may have been deleted.");
        return;
      }
      setActiveConversationId(data.id);
      setMessages(data.messages.filter((message) => message.role === "user" || message.role === "assistant").map((message) => ({ role: message.role, content: message.content })));
      setDraft("");
      setError("");
      setShowJobSearch(false);
    } catch {
      setHistoryError("Could not open this conversation. Please refresh the history and try again.");
    } finally {
      setConversationBusy(false);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    if (!conversationStore || busy || conversationBusy) return;
    setConversationBusy(true);
    setHistoryError("");
    try {
      const { deleted, error: deleteError } = await conversationStore.delete(conversationId);
      if (deleteError) throw deleteError;
      setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
        setDraft("");
      }
      setHistoryNotice(deleted ? "Conversation deleted." : "This conversation is no longer available. It may have been deleted.");
    } catch {
      setHistoryError("Could not delete this conversation. Please try again.");
    } finally {
      setDeletingConversationId(null);
      setConversationBusy(false);
    }
  };

  const sendMessage = async (content: string, jobSearch?: { role: string; location: string }) => {
    const trimmed = content.trim();
    if (apiConfigurationError) { setError(apiConfigurationError); return; }
    if (!trimmed || busy || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    const userMessage: AssistantMessage = { role: "user", content: trimmed, createdAt: new Date().toISOString() };
    const nextHistory = [...messages, userMessage].slice(-12).map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError("");
    setRetryAction(null);
    setBusy(true);
    let savedConversationId = activeConversationId;

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        onAuthenticationRequired();
        throw new Error("Your session is unavailable. Please sign in again.");
      }
      if (conversationStore) {
        savedConversationId = await saveConversation(
          [...messages, userMessage].map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          savedConversationId,
        );
      }
      const response = await fetchAssistantWithRefresh(`${apiBaseUrl}/api/assistant/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: nextHistory, ...(jobSearch ? { job_search: jobSearch } : {}) }),
        signal: AbortSignal.timeout(65000),
      }, accessToken, refreshAccessToken);
      const result = await assistantJson(response, "chat", onAuthenticationRequired);
      if (typeof result?.reply !== "string") throw new Error("The career assistant returned an invalid response.");
      const jobs = Array.isArray(result.jobs) ? result.jobs as AssistantJob[] : [];
      const assistantMessage: AssistantMessage = { role: "assistant", content: result.reply, createdAt: new Date().toISOString(), ...(jobs.length ? { jobs } : {}) };
      setMessages((current) => [...current, assistantMessage]);
      setRetryAction(null);
      if (conversationStore) {
        await saveConversation(
          [...messages, userMessage, assistantMessage].map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          savedConversationId,
        );
      }
    } catch (requestError) {
      setError(requestErrorMessage(requestError, apiBaseUrl, "The AI response took too long. Please retry."));
      setRetryAction(() => async () => {
        if (apiConfigurationError || requestInFlightRef.current) return;
        requestInFlightRef.current = true;
        setBusy(true); setError("");
        try {
          const token = await getAccessToken();
          if (!token) { onAuthenticationRequired(); throw new Error("Your session is unavailable. Please sign in again."); }
          const retryResponse = await fetchAssistantWithRefresh(`${apiBaseUrl}/api/assistant/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextHistory, ...(jobSearch ? { job_search: jobSearch } : {}) }), signal: AbortSignal.timeout(65000) }, token, refreshAccessToken);
          const retryResult = await assistantJson(retryResponse, "chat", onAuthenticationRequired);
          if (typeof retryResult?.reply !== "string") throw new Error("The career assistant returned an invalid response.");
          const answer: AssistantMessage = { role: "assistant", content: retryResult.reply, createdAt: new Date().toISOString(), ...(Array.isArray(retryResult.jobs) && retryResult.jobs.length ? { jobs: retryResult.jobs as AssistantJob[] } : {}) };
          setMessages((current) => [...current, answer]);
          if (conversationStore) await saveConversation([...messages, userMessage, answer].map(({ role, content }) => ({ role, content })), savedConversationId);
          setRetryAction(null);
        } catch (cause) { setError(requestErrorMessage(cause, apiBaseUrl, "The AI response took too long. Please retry.")); }
        finally { requestInFlightRef.current = false; setBusy(false); }
      });
    } finally {
      requestInFlightRef.current = false;
      setBusy(false);
    }
  };

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(draft);
  };

  const submitWithAttachment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!attachment) { void sendMessage(draft); return; }
    if (apiConfigurationError) { setError(apiConfigurationError); return; }
    if (busy || requestInFlightRef.current) return;
    const validation = !/\.(pdf|docx|txt|png|jpe?g|webp)$/i.test(attachment.name) ? "Choose a PDF, DOCX, TXT, JPG, PNG, or WEBP attachment. Legacy DOC files are unsupported." : attachment.size <= 0 ? "The selected file is empty." : attachment.size > 10 * 1024 * 1024 ? "Choose a file smaller than 10 MB." : "";
    if (validation) { setAttachmentError(validation); return; }
    const text = draft.trim() || "Please analyze this resume and suggest truthful, specific improvements.";
    const userMessage: AssistantMessage = { role: "user", content: `${text}\n\nAttached file for analysis: ${attachment.name}`, createdAt: new Date().toISOString() };
    requestInFlightRef.current = true;
    setMessages((current) => [...current, userMessage]); setDraft(""); setBusy(true); setError(""); setAttachmentError("");
    let savedId = activeConversationId;
    try {
      const token = await getAccessToken();
      if (!token) { onAuthenticationRequired(); throw new Error("Your session is unavailable. Please sign in again."); }
      savedId = conversationStore ? await saveConversation([...messages, userMessage].map(({ role, content }) => ({ role, content }))) : activeConversationId;
      setUploadStage("Uploading attachment…");
      const data = new FormData(); data.append("file", attachment); data.append("job_description", text.toLowerCase().includes("job description:") ? text.split(/job description:/i).slice(1).join("").slice(0, 6000) : "");
      setUploadStage("Uploading and analyzing attachment…");
      const response = await fetchAssistantWithRefresh(`${apiBaseUrl}/api/assistant/resume-analysis`, { method: "POST", body: data, signal: AbortSignal.timeout(45000) }, token, refreshAccessToken);
      const result = await assistantJson(response, "resume", onAuthenticationRequired);
      if (typeof result?.reply !== "string") throw new Error("The attachment analyzer returned an invalid response.");
      const assistantMessage: AssistantMessage = { role: "assistant", content: result.reply, createdAt: new Date().toISOString() };
      setMessages((current) => [...current, assistantMessage]);
      if (conversationStore) await saveConversation([...messages, userMessage, assistantMessage].map(({ role, content }) => ({ role, content })), savedId);
      setAttachment(null); setRetryAction(null);
    } catch (cause) {
      setError(requestErrorMessage(cause, apiBaseUrl, "Attachment analysis took too long. Try again with a smaller file."));
      setRetryAction(() => async () => {
        if (apiConfigurationError || requestInFlightRef.current) return;
        requestInFlightRef.current = true;
        setBusy(true); setError(""); setUploadStage("Uploading and analyzing attachment…");
        try {
          const token = await getAccessToken(); if (!token) { onAuthenticationRequired(); throw new Error("Your session is unavailable. Please sign in again."); }
          const retryData = new FormData(); retryData.append("file", attachment); retryData.append("job_description", text.toLowerCase().includes("job description:") ? text.split(/job description:/i).slice(1).join("").slice(0, 6000) : "");
          const retryResponse = await fetchAssistantWithRefresh(`${apiBaseUrl}/api/assistant/resume-analysis`, { method: "POST", body: retryData, signal: AbortSignal.timeout(45000) }, token, refreshAccessToken);
          const retryResult = await assistantJson(retryResponse, "resume", onAuthenticationRequired);
          if (typeof retryResult?.reply !== "string") throw new Error("The attachment analyzer returned an invalid response.");
          const answer: AssistantMessage = { role: "assistant", content: retryResult.reply, createdAt: new Date().toISOString() }; setMessages((current) => [...current, answer]);
          if (conversationStore) await saveConversation([...messages, userMessage, answer].map(({ role, content }) => ({ role, content })), savedId);
          setAttachment(null); setRetryAction(null);
        } catch (retryError) { setError(requestErrorMessage(retryError, apiBaseUrl, "Attachment analysis took too long. Try again with a smaller file.")); }
        finally { requestInFlightRef.current = false; setBusy(false); setUploadStage(""); }
      });
    }
    finally { requestInFlightRef.current = false; setBusy(false); setUploadStage(""); }
  };

  const submitJobSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const role = jobRole.trim();
    const location = jobLocation.trim();
    if (!role || !location) return;
    void sendMessage(`Find current job listings for ${role} in ${location} and recommend suitable options.`, { role, location });
    setShowJobSearch(false);
  };

  const showMobileWelcome = isMobileViewport && messages.length === 0 && !showJobSearch;

  return (
    <section ref={workspaceRef} className="career-assistant-workspace" aria-labelledby="career-assistant-title" hidden={!visible}>
      {isMobileViewport && <header className="career-assistant-mobile-header">
        <button
          ref={mobileMenuButtonRef}
          type="button"
          className="career-assistant-mobile-menu"
          aria-label={mobileNavOpen ? "Close career navigation" : "Open career navigation"}
          aria-expanded={mobileNavOpen}
          aria-controls="career-assistant-navigation-drawer"
          onClick={() => setMobileNavOpen((open) => !open)}
        ><Menu size={21} /></button>
        <span>Kaam-Calm</span>
      </header>}
      <header className="career-assistant-header">
        <div><span className="career-assistant-icon"><Sparkles size={19} /></span><div><span className="career-assistant-eyebrow">YOUR CAREER WORKSPACE</span><h1 id="career-assistant-title">AI Career Assistant</h1><small>Your personal career guide</small></div></div>
        <span className="career-assistant-secure"><span aria-hidden="true" /> Private session</span>
      </header>
      {isMobileViewport && mobileNavOpen && <button type="button" className="career-assistant-drawer-backdrop" aria-label="Close career navigation" onClick={() => setMobileNavOpen(false)} />}
      <div className="career-assistant-layout">
        <aside
          id="career-assistant-navigation-drawer"
          className={`career-assistant-sidebar${mobileNavOpen ? " is-open" : ""}`}
          aria-label="AI Career tools and recent chats"
          aria-hidden={isMobileViewport ? !mobileNavOpen : undefined}
          onTouchStart={isMobileViewport && mobileNavOpen ? rememberDrawerTouch : undefined}
          onTouchEnd={isMobileViewport && mobileNavOpen ? closeDrawerOnLeftSwipe : undefined}
        >
          {isMobileViewport && <div className="career-assistant-drawer-heading"><span>Career tools</span><button type="button" aria-label="Close career navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>}
          <nav className="career-assistant-tools" aria-label="Career tools">
            <button type="button" className="career-assistant-tool active" onClick={() => { startNewConversation(); setMobileNavOpen(false); }}><MessageSquareText size={17} />New Chat</button>
            <button type="button" className="career-assistant-tool" onClick={() => { prepareMobileToolSelection(); setDraft("Help me prepare for a software engineering interview. Ask me common questions and give feedback on my answers."); inputRef.current?.focus(); }}><BriefcaseBusiness size={17} />Interview Preparation</button>
            <button type="button" className="career-assistant-tool" onClick={() => { prepareMobileToolSelection(); setDraft("Please review my resume and suggest specific improvements."); fileRef.current?.click(); }}><FileText size={17} />Resume Guidance &amp; Analyzer</button>
            <button type="button" className="career-assistant-tool" onClick={() => { prepareMobileToolSelection(); setDraft("Create a practical skill development roadmap for my career goals."); inputRef.current?.focus(); }}><Sparkles size={17} />Skill Development</button>
            <button type="button" className="career-assistant-tool" onClick={() => { prepareMobileToolSelection(); setDraft("Help me choose my next career steps based on my goals and experience."); inputRef.current?.focus(); }}><ArrowUpRight size={17} />Career Guidance</button>
            <button type="button" className="career-assistant-tool" onClick={() => { setShowJobSearch(true); setMobileNavOpen(false); }}><BriefcaseBusiness size={17} />Job Search Strategy</button>
            <button type="button" className="career-assistant-tool" onClick={openSmartMatching}><ArrowUpRight size={17} />Smart Job Matching</button>
          </nav>
          <section className="career-assistant-history" aria-labelledby="career-assistant-history-title">
            <div className="career-assistant-history-heading">
              <div><MessageSquareText size={17} /><h2 id="career-assistant-history-title">Recent Chats</h2></div>
              {conversations.length > 0 && <button type="button" className="career-assistant-clear" onClick={() => setDeletingConversationId("__all__")} disabled={busy || conversationBusy}>Clear</button>}
            </div>
            {historyLoading && <p className="career-assistant-history-status" role="status">Loading conversations…</p>}
            {historyError && <p className="career-assistant-history-error" role="alert">{historyError} <button type="button" className="button button-ghost" onClick={() => setHistoryRetry((attempt) => attempt + 1)} disabled={historyLoading}>{historyLoading ? "Retrying…" : "Retry history"}</button></p>}
            {historyNotice && <p className="career-assistant-history-status" role="status">{historyNotice}</p>}
            {!historyLoading && conversations.length === 0 && !historyError && <p className="career-assistant-history-empty">Your saved conversations will appear here.</p>}
            {deletingConversationId === "__all__" && <div className="career-assistant-history-delete-confirm" role="group" aria-label="Confirm clearing recent chats"><span>Clear saved chats?</span><button type="button" onClick={() => setDeletingConversationId(null)} disabled={conversationBusy}>Cancel</button><button type="button" onClick={async () => { if (!conversationStore) return; setConversationBusy(true); setHistoryError(""); try { for (const chat of conversations) { const result = await conversationStore.delete(chat.id); if (result.error) throw result.error; } setConversations([]); setActiveConversationId(null); setMessages([]); setDraft(""); setHistoryNotice("Saved conversations cleared."); } catch { setHistoryError("Could not clear all conversations. Please try again."); } finally { setDeletingConversationId(null); setConversationBusy(false); } }} disabled={conversationBusy}>{conversationBusy ? "Clearing…" : "Confirm"}</button></div>}
            {conversations.length > 0 && <ul className="career-assistant-history-list" aria-label="Saved conversations">
              {conversations.map((conversation) => (
                <li className="career-assistant-history-item" key={conversation.id}>
                  <button type="button" className="career-assistant-history-open" aria-label={`Open conversation: ${conversation.title}`} aria-current={activeConversationId === conversation.id ? "true" : undefined} onClick={() => { setMobileNavOpen(false); void openConversation(conversation.id); }} disabled={busy || conversationBusy}>
                    <strong id={`assistant-conversation-title-${conversation.id}`}>{conversation.title}</strong>
                    <small><Clock3 size={13} /> Updated <time dateTime={conversation.updated_at}>{new Date(conversation.updated_at).toLocaleDateString()}</time></small>
                  </button>
                  {deletingConversationId === conversation.id ? (
                    <div className="career-assistant-history-delete-confirm" role="group" aria-label={`Confirm deleting ${conversation.title}`}>
                      <button type="button" onClick={() => setDeletingConversationId(null)} disabled={conversationBusy}>Cancel</button>
                      <button type="button" onClick={() => void deleteConversation(conversation.id)} disabled={conversationBusy}>{conversationBusy ? "Deleting…" : "Confirm delete"}</button>
                    </div>
                  ) : <button type="button" className="career-assistant-history-delete" aria-label="Delete conversation" aria-describedby={`assistant-conversation-title-${conversation.id}`} onClick={() => setDeletingConversationId(conversation.id)} disabled={busy || conversationBusy}><Trash2 size={15} /></button>}
                </li>
              ))}
            </ul>}
          </section>
        </aside>
        <main className={`career-assistant-chat-panel${showMobileWelcome ? " has-mobile-welcome" : ""}`} aria-label="Career assistant conversation">
          {showMobileWelcome && <section className="career-assistant-mobile-welcome" aria-label="Kaam-Calm career assistant welcome">
            <img src={careerRobot} alt="" />
            <h2>Welcome to Kaam-Calm</h2>
            <p>I'm your AI Career Assistant. Ask about interviews, resumes, skills, job search, or career growth.</p>
            <div className="career-assistant-mobile-prompts" aria-label="Suggested questions">
              {suggestedPrompts.map(({ label, action }) => <button type="button" key={label} onClick={() => { if (action === "matching") openSmartMatching(); else void sendMessage(label); }}><span>{label}</span><ArrowUpRight size={17} /></button>)}
            </div>
          </section>}
          <div className="career-assistant-messages" ref={scrollRef} aria-live="polite" aria-label="Conversation">
            {messages.map((message, index) => (
              <div className={`career-assistant-message ${message.role}`} key={`${index}-${message.role}`}>
                {message.role === "assistant" && <span className="career-message-avatar assistant" aria-hidden="true"><img src={careerRobot} alt="" /></span>}
                <div className="career-assistant-message-body">
                {message.role === "assistant" ? (
                  <ReactMarkdown
                    allowedElements={[
                      "a", "blockquote", "br", "code", "del", "em",
                      "h1", "h2", "h3", "h4", "h5", "h6", "hr",
                      "li", "ol", "p", "pre", "strong", "ul",
                    ]}
                    skipHtml
                    urlTransform={safeMarkdownUrl}
                    components={{ a: MarkdownLink }}
                  >
                    {message.content}
                  </ReactMarkdown>
                ) : <p>{message.content}</p>}
                {message.jobs?.map((job) => (
                  <article className="career-assistant-job" key={job.id}>
                    <strong>{job.title}</strong><span>{job.company} · {job.location}</span>
                    {job.salary && <small>{job.salary}</small>}
                    {job.url && <a href={job.url} target="_blank" rel="noopener noreferrer">View on {job.source || "Adzuna"}</a>}
                  </article>
                ))}
                {message.createdAt && <small className="career-assistant-message-time"><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></small>}
                </div>
                {message.role === "user" && <span className="career-message-avatar user" aria-hidden="true">{profileAvatarUrl && !profileAvatarFailed ? <img src={profileAvatarUrl} alt="" onError={() => setProfileAvatarFailed(true)} /> : (profileName.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "You")}</span>}
              </div>
            ))}
            {busy && <p className="career-assistant-status" role="status">{uploadStage || "Thinking…"}</p>}
            {apiConfigurationError && !error && <p className="career-assistant-error" role="alert">{apiConfigurationError}</p>}
            {error && <div className="career-assistant-error" role="alert"><span>{error}</span>{retryAction && <button type="button" className="button button-ghost" onClick={() => void retryAction()} disabled={busy}>Retry response</button>}</div>}
          </div>

          {showJobSearch && <form className="career-assistant-job-search" onSubmit={submitJobSearch}>
            <label>Role<input value={jobRole} onChange={(event) => setJobRole(event.target.value)} maxLength={100} required placeholder="e.g. Data Analyst" /></label>
            <label>Location<input value={jobLocation} onChange={(event) => setJobLocation(event.target.value)} maxLength={100} required placeholder="e.g. Bengaluru" /></label>
            <div><button type="button" className="button button-ghost" onClick={() => setShowJobSearch(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>Search listings</button></div>
          </form>}

          <div className="career-assistant-composer-area">
          <p className="career-assistant-privacy">Conversations are saved to your signed-in account. Avoid entering passwords, tokens, contact details, or private file links.</p>
          <div className="career-assistant-actions">
            <button type="button" className="career-assistant-find-jobs" onClick={() => setShowJobSearch((shown) => !shown)} disabled={busy}><BriefcaseBusiness size={15} /> Find actual jobs</button>
            <form className="career-assistant-compose" onSubmit={submitWithAttachment}>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/jpeg,image/png,image/webp" hidden onChange={(event) => selectAttachment(event.target.files?.[0] ?? null)} />
              <button type="button" className="career-composer-tool career-composer-attachment" aria-label="Attach resume" onClick={() => fileRef.current?.click()} disabled={busy}><Paperclip size={17} /></button>
              <textarea ref={inputRef} aria-label="Message the career assistant" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (draft.trim() || attachment) void submitWithAttachment({ preventDefault() {} } as FormEvent<HTMLFormElement>); } }} maxLength={2500} placeholder="Ask a career question…" disabled={busy} rows={1} />
              <button type="submit" aria-label="Send message" disabled={busy || (!draft.trim() && !attachment)}><Send size={17} /></button>
            </form>
            {attachment && <div className="career-attachment-chip">{attachmentPreview ? <img src={attachmentPreview} alt="Selected image preview" /> : <FileText size={15} />}<span>{attachment.name} · {(attachment.size / 1024).toFixed(0)} KB</span><button type="button" aria-label="Remove attachment" onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = ""; }}><X size={14} /></button></div>}
            {attachmentError && <p role="alert" className="career-assistant-error">{attachmentError}</p>}
          </div>
          </div>
        </main>
        <aside className="career-assistant-guide-panel" aria-label="Assistant welcome and suggestions" aria-hidden={isMobileViewport}>
          <img className="career-assistant-robot-art" src={careerRobot} alt="Friendly AI assistant robot" />
          <section className="career-assistant-guide-card"><strong>Hi there! 👋<br />I'm your AI Career Assistant.</strong><p>Ask me anything about interviews, resumes, skills, job search, or career growth.</p></section>
          <div className="career-assistant-guide-prompts" aria-label="Suggested prompts">
            {suggestedPrompts.map(({ label, prompt, action }) => <button type="button" key={label} onClick={() => { if (action === "matching") onSmartMatching(); else { setDraft(prompt ?? ""); inputRef.current?.focus(); } }}><span>{label}</span><ArrowUpRight size={16} /></button>)}
          </div>
        </aside>
      </div>
    </section>
  );
}
