// What an uploaded file actually is, read from its leading bytes.
//
// Separate from the server action that uses it so it can be exercised directly:
// the browser path re-encodes every picture through a canvas before uploading,
// so a disguised file never survives that far, and the check can only be tested
// by calling it. The check exists for the path that skips the browser entirely
// — a server action is a public endpoint, reachable by anyone with a share
// token and an HTTP client.
//
// The values are the MIME types the client-profile-pictures bucket allows
// (supabase/032_client_profile_picture.sql), mapped to the extension to store
// them under, deliberately kept in step with it.
export const ALLOWED_IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png" } as const;

export type AllowedImageType = keyof typeof ALLOWED_IMAGE_TYPES;

// `file.type` is not consulted: the browser derives it from the filename, so it
// is whatever the caller says it is. The previous version of the upload did not
// even do that — it passed `contentType: "image/jpeg"` unconditionally, which
// meant the bucket's MIME allowlist was validating a value this server had just
// made up. Everything looked like a JPEG to Storage regardless of its contents,
// in a bucket that is public.
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  // FF D8 FF — start of image, then any APPn/JFIF/Exif marker.
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // The full 8-byte PNG signature. The trailing CR LF SUB LF is there to catch
  // a file mangled by a text-mode transfer, so checking only "\x89PNG" would
  // accept a corrupted one.
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}
