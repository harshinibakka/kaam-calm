export const PROFILE_DOCUMENT_BUCKET = "private-job-seeker-documents";
export const PROFILE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PROFILE_DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.txt";

const allowedTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

export function profileDocumentContentType(file: Pick<File, "name" | "type">): string {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const expectedType = allowedTypes[extension];
  if (!expectedType) return "application/octet-stream";
  return !file.type || file.type === "application/octet-stream" ? expectedType : file.type;
}

export function validateProfileDocument(file: Pick<File, "name" | "size" | "type">): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedTypes[extension]) return "Choose a PDF, DOC, DOCX, or TXT document.";
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > PROFILE_DOCUMENT_MAX_BYTES) return "Choose a file smaller than 10 MB.";
  if (file.type && file.type !== "application/octet-stream" && file.type !== allowedTypes[extension]) return "The file type does not match its extension.";
  return null;
}

export function profileDocumentPath(userId: string, kind: "resume" | "cv", fileName: string): string {
  const safeName = fileName.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100) || "document";
  return `${userId}/${kind}/${crypto.randomUUID()}-${safeName}`;
}
