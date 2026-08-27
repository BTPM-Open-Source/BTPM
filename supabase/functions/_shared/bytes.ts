// Phase 6B.6d — Canonical byte/hash utilities shared between
// Decision Case and Roadmap Story Pack generation paths.

export function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid the "Maximum call stack size exceeded" hazard with
  // String.fromCharCode(...spread) on large buffers.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
