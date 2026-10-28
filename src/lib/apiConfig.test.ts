import { describe, expect, it } from "vitest";
import { resolveApiConfiguration } from "./apiConfig";

describe("API configuration", () => {
  it("uses the local FastAPI server in development when no URL is set", () => {
    expect(resolveApiConfiguration({ value: "", production: false })).toEqual({ baseUrl: "http://127.0.0.1:8001", error: null });
  });

  it("requires an explicit API URL in production", () => {
    const result = resolveApiConfiguration({ production: true });
    expect(result.baseUrl).toBe("");
    expect(result.error).toContain("Set VITE_API_BASE_URL");
  });

  it.each(["http://localhost:8001", "http://127.0.0.1:8001", "https://[::1]:8001"]) (
    "rejects a loopback production URL: %s",
    (value) => expect(resolveApiConfiguration({ value, production: true }).error).toContain("cannot point to localhost"),
  );

  it("rejects malformed and non-HTTP URLs", () => {
    expect(resolveApiConfiguration({ value: "not a url", production: false }).error).toContain("absolute HTTP or HTTPS");
    expect(resolveApiConfiguration({ value: "ftp://api.example.com", production: false }).error).toContain("HTTP or HTTPS");
  });

  it("normalizes a configured production API URL", () => {
    expect(resolveApiConfiguration({ value: "https://api.example.com/v1/", production: true })).toEqual({ baseUrl: "https://api.example.com/v1", error: null });
  });
});
