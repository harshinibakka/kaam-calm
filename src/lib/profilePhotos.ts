export const PROFILE_PHOTO_BUCKET = "private-job-seeker-avatars";
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
export const PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60;

const allowedTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function profilePhotoContentType(file: Pick<File, "name" | "type">): string {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return allowedTypes[extension] ?? "application/octet-stream";
}

export function validateProfilePhoto(file: Pick<File, "name" | "size" | "type">): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const expectedType = allowedTypes[extension];
  if (!expectedType) return "Choose a JPG, PNG, or WEBP image.";
  if (file.size <= 0) return "The selected image is empty.";
  if (file.size > PROFILE_PHOTO_MAX_BYTES) return "Choose an image smaller than 5 MB.";
  if (file.type && file.type !== "application/octet-stream" && file.type !== expectedType) return "The image type does not match its extension.";
  return null;
}

export function profilePhotoPath(userId: string, fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedTypes[extension]) throw new Error("Unsupported profile photo type");
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}
