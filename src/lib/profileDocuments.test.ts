import { describe, expect, it } from "vitest";
import { PROFILE_DOCUMENT_MAX_BYTES, profileDocumentContentType, profileDocumentPath, validateProfileDocument } from "./profileDocuments";

describe("profile document validation", () => {
  it.each([
    ["resume.pdf", "application/pdf"],
    ["resume.doc", "application/msword"],
    ["resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["resume.txt", "text/plain"],
  ])("accepts %s", (name, type) => {
    expect(validateProfileDocument({ name, type, size: 100 })).toBeNull();
  });
  it("rejects unsupported, mismatched, empty, and oversized files", () => {
    expect(validateProfileDocument({ name: "resume.exe", type: "application/octet-stream", size: 100 })).toMatch(/PDF, DOC/);
    expect(validateProfileDocument({ name: "resume.pdf", type: "text/plain", size: 100 })).toMatch(/does not match/);
    expect(validateProfileDocument({ name: "empty.pdf", type: "application/pdf", size: 0 })).toMatch(/empty/);
    expect(validateProfileDocument({ name: "large.pdf", type: "application/pdf", size: PROFILE_DOCUMENT_MAX_BYTES + 1 })).toMatch(/10 MB/);
  });
  it("scopes storage object paths beneath the authenticated user folder", () => {
    expect(profileDocumentPath("user-1", "cv", "My CV.pdf")).toMatch(/^user-1\/cv\/[\w-]+-My-CV\.pdf$/);
  });
  it("infers an allowed storage MIME type when a mobile browser omits it", () => {
    const cases = [
      ["resume.pdf", "application/pdf"],
      ["resume.doc", "application/msword"],
      ["resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["resume.txt", "text/plain"],
    ];
    for (const [name, expected] of cases) {
      expect(profileDocumentContentType({ name, type: "" })).toBe(expected);
      expect(profileDocumentContentType({ name, type: "application/octet-stream" })).toBe(expected);
      expect(validateProfileDocument({ name, type: "", size: 100 })).toBeNull();
      expect(validateProfileDocument({ name, type: "application/octet-stream", size: 100 })).toBeNull();
    }
  });
  it("keeps the normalized types aligned with supported extensions", () => {
    expect(profileDocumentContentType({ name: "cv.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(validateProfileDocument({ name: "notes.exe", type: "", size: 10 })).toMatch(/PDF, DOC/);
  });
});
