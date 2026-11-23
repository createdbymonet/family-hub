import type { ApiErrorDto } from '../shared/contracts';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof HttpError;
  if (!known) console.error(JSON.stringify({ event: 'api_request_failed' }));
  const body: ApiErrorDto = {
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'The request could not be completed.',
    },
  };
  return json(body, known ? error.status : 500);
}

export function secureApiResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Vary', 'Cookie');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return response;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireId(value: string): string {
  if (!UUID.test(value)) throw new HttpError(400, 'INVALID_INPUT', 'A valid UUID is required.');
  return value.toLowerCase();
}

export function requireVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
    throw new HttpError(400, 'INVALID_INPUT', 'A positive version is required.');
  }
  return value;
}

export function requireText(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    value.trim().length < 1 ||
    value.trim().length > max
  ) {
    throw new HttpError(400, 'INVALID_INPUT', `Text must contain between 1 and ${max} characters.`);
  }
  return value.trim();
}

export async function readObject(
  request: Request,
  allowedKeys: readonly string[],
  maxBytes = 16_384,
): Promise<Record<string, unknown>> {
  if (
    request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    throw new HttpError(415, 'INVALID_CONTENT_TYPE', 'Use application/json.');
  }
  if (!request.body) throw new HttpError(400, 'INVALID_INPUT', 'A JSON object is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.length;
    if (length > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data: unknown;
  try {
    data = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown;
  } catch {
    throw new HttpError(400, 'INVALID_INPUT', 'A valid JSON object is required.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new HttpError(400, 'INVALID_INPUT', 'A JSON object is required.');
  }
  const object = data as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowedKeys.includes(key))) {
    throw new HttpError(400, 'INVALID_INPUT', 'Unexpected input field.');
  }
  return object;
}

export function cookie(request: Request, name: string): string | null {
  const values = (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim());
  const matches = values.filter((part) => part.startsWith(`${name}=`));
  // Reject cookie tossing / ambiguous duplicate cookie names.
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : null;
}

export function protectedCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function rejectMethod(): never {
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not supported.');
}
