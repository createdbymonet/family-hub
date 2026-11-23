const encoder = new TextEncoder();

export function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export async function secretEquals(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export function encodeJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

export function decodeJson(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2048) throw new Error('Invalid encoding');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
  ) as unknown;
}
