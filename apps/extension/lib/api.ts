import type { ZodType } from 'zod';
import { pairingToken } from './session';

const messages: Record<string, string> = {
  BACKEND_OFFLINE: 'Backend Offline',
  UNAUTHORIZED: 'Pair the extension with the local backend.',
  MISSING_GEMINI_KEY: 'Not Configured',
  INVALID_GEMINI_KEY: 'Gemini rejected the saved API key. Check AI Settings.',
  GEMINI_ACCESS_DENIED: 'Gemini denied access. Check the API key’s project permissions.',
  GEMINI_QUOTA_EXHAUSTED: 'Gemini rate limit or quota reached. Try again later.',
  GEMINI_NETWORK_FAILURE: 'The local backend could not connect to Gemini.',
  GEMINI_TLS_FAILURE: 'The local backend could not verify Gemini’s TLS certificate. Check Windows certificate trust.',
  GEMINI_DNS_FAILURE: 'The local backend could not resolve Gemini’s hostname.',
  GEMINI_TIMEOUT: 'Gemini did not respond before the deadline. Try again or paste a shorter vacancy.',
  GEMINI_INPUT_TOO_LARGE: 'Gemini rejected the request size. Paste a shorter vacancy.',
  GEMINI_REQUEST_REJECTED: 'Gemini rejected the request. Check the local API terminal for the provider status.',
  GEMINI_SERVICE_UNAVAILABLE: 'Gemini is temporarily unavailable. Try again later.',
  GEMINI_CLIENT_FAILURE: 'The local API’s Gemini client failed. Check the local API terminal.',
  GEMINI_MODEL_UNAVAILABLE: 'The configured Gemini model is unavailable.',
  AI_RESPONSE_INVALID: 'Gemini returned an invalid response.',
  CREDENTIAL_STORE_FAILURE: 'Windows credential storage is unavailable.',
  INVALID_INPUT: 'Check the submitted information.',
  LOCAL_RATE_LIMIT: 'Too many requests. Try again shortly.',
  LOCAL_BUSY: 'The backend is processing another request.',
};

export async function api<T = undefined>(path: string, options: { method?: string; body?: unknown; schema?: ZodType<T>; signal?: AbortSignal } = {}) {
  const { method = 'GET', body, schema, signal } = options;
  const token = path === '/health' ? '' : await pairingToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  const deadline = AbortSignal.timeout(35_000);
  try {
    response = await fetch('http://127.0.0.1:8787' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch {
    throw new Error(deadline.aborted ? 'The local backend did not respond before the deadline.' : messages.BACKEND_OFFLINE);
  }
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
