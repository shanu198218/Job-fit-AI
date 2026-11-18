import type { ZodType } from 'zod';
import { pairingToken } from './session';

const messages: Record<string, string> = {
  BACKEND_OFFLINE: 'Backend Offline',
  UNAUTHORIZED: 'Pair the extension with the local backend.',
  MISSING_GEMINI_KEY: 'Not Configured',
  INVALID_GEMINI_KEY: 'Invalid Key',
  GEMINI_QUOTA_EXHAUSTED: 'Quota Exceeded',
  GEMINI_NETWORK_FAILURE: 'Gemini network request failed.',
  GEMINI_MODEL_UNAVAILABLE: 'The configured Gemini model is unavailable.',
  AI_RESPONSE_INVALID: 'Gemini returned an invalid analysis.',
  CREDENTIAL_STORE_FAILURE: 'Windows credential storage is unavailable.',
  INVALID_INPUT: 'Check the submitted information.',
  LOCAL_RATE_LIMIT: 'Too many requests. Try again shortly.',
  LOCAL_BUSY: 'The backend is processing another request.',
};

export async function api<T = undefined>(path: string, options: { method?: string; body?: unknown; schema?: ZodType<T> } = {}) {
  const { method = 'GET', body, schema } = options;
  const token = path === '/health' ? '' : await pairingToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch('http://127.0.0.1:8787' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(35_000),
    });
  } catch { throw new Error(messages.BACKEND_OFFLINE); }
  if (response.status === 204 && !schema) return undefined;
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
    throw new Error(typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : 'Local API request failed.');
  }
  if (!schema) return undefined;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error('Local API returned an invalid response.');
  return parsed.data;
}
