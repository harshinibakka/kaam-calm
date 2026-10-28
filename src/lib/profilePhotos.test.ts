import { describe, expect, it } from "vitest";
import { profilePhotoContentType, profilePhotoPath, validateProfilePhoto } from "./profilePhotos";

describe("private profile photo validation", () => {
  it.each([["photo.jpg", "image/jpeg"], ["photo.jpeg", "image/jpeg"], ["photo.png", "image/png"], ["photo.webp", "image/webp"]])("accepts %s", (name, type) => {
    const file = { name, type, size: 100 };
    expect(validateProfilePhoto(file)).toBeNull();
    expect(profilePhotoContentType(file)).toBe(type);
  });

  it("normalizes empty and generic browser MIME types from the extension", () => {
    expect(profilePhotoContentType({ name: "avatar.png", type: "" })).toBe("image/png");
    expect(profilePhotoContentType({ name: "avatar.webp", type: "application/octet-stream" })).toBe("image/webp");
  });

  it("rejects unsupported types, MIME mismatches, empty files, and files over 5 MiB", () => {
    expect(validateProfilePhoto({ name: "avatar.gif", type: "image/gif", size: 12 })).toMatch(/JPG, PNG, or WEBP/);
    expect(validateProfilePhoto({ name: "avatar.png", type: "image/jpeg", size: 12 })).toMatch(/does not match/);
    expect(validateProfilePhoto({ name: "avatar.png", type: "image/png", size: 0 })).toMatch(/empty/);
    expect(validateProfilePhoto({ name: "avatar.png", type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });

  it("stores photos under a user-owned unique folder path", () => {
    expect(profilePhotoPath("user-123", "portrait.png")).toMatch(/^user-123\/[0-9a-f-]+\.png$/i);
  });
});
