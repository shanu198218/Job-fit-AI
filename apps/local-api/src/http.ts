import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { matchJob } from '../../../packages/matching-engine/src/index.ts';
import { reportSchema } from '../../../packages/shared-types/src/report.ts';
import type { Credentials } from './credentials.ts';
import { ApiError, type Gemini } from './gemini.ts';
import { analyzeInput, keyInput } from './validation.ts';

const maxBody = 160_000;

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function json(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    throw new ApiError('INVALID_CONTENT_TYPE', 415);
  }
  if (Number(req.headers['content-length']) > maxBody) throw new ApiError('INPUT_TOO_LARGE', 413);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new ApiError('REQUEST_TIMEOUT', 408)), 5000);
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) reject(new ApiError('INPUT_TOO_LARGE', 413));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError('INVALID_INPUT', 400)); }
    });
    req.on('error', reject);
    req.on('close', () => reject(new ApiError('INVALID_INPUT', 400)));
    req.once('end', () => clearTimeout(timer));
    req.once('close', () => clearTimeout(timer));
  });
}

export function validToken(header: string | undefined, token: string) {
  const match = header?.match(/^Bearer ([a-f0-9]{64})$/);
  return !!match && /^[a-f0-9]{64}$/.test(token) && timingSafeEqual(Buffer.from(match[1], 'hex'), Buffer.from(token, 'hex'));
}

export function localServer(options: { credentials: Credentials; ai: Gemini; token: string; origin: string; host?: string }) {
  const { credentials, ai, origin, token, host = '127.0.0.1:8787' } = options;
  let windowStart = Date.now();
  let attempts = 0;
  let busy = false;
  async function key() {
    const value = await credentials.read('gemini');
    if (!value) throw new ApiError('MISSING_GEMINI_KEY', 409);
    return value;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      if (req.headers.host !== host || (req.headers.origin !== undefined && req.headers.origin !== origin)) {
        throw new ApiError('UNAUTHORIZED', 401);
      }
      if (req.headers.origin === origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      const route = req.method + ' ' + req.url;
      if (route === 'GET /health') return send(res, 200, { ok: true });
      if (req.method === 'OPTIONS' && req.headers.origin === origin) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        return send(res, 204);
      }
      if (!validToken(req.headers.authorization, token)) throw new ApiError('UNAUTHORIZED', 401);
      if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); attempts = 0; }
      if (++attempts > 40) throw new ApiError('LOCAL_RATE_LIMIT', 429);
      if (!['POST /analyze', 'PUT /settings/ai/key'].includes(route)
        && (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'])) {
        throw new ApiError('INVALID_INPUT', 400);
      }
      if (busy) throw new ApiError('LOCAL_BUSY', 409);
      busy = true;
      try {
        switch (route) {
          case 'GET /settings/ai/status':
            return send(res, 200, { configured: Boolean(await credentials.read('gemini')) });
          case 'PUT /settings/ai/key': {
            const input = keyInput.safeParse(await json(req));
            if (!input.success) throw new ApiError('INVALID_INPUT', 400);
            await credentials.save('gemini', input.data.key);
            return send(res, 204);
          }
          case 'DELETE /settings/ai/key':
            await credentials.remove('gemini');
            return send(res, 204);
          case 'POST /settings/ai/test':
            await ai.test(await key());
            return send(res, 200, { connected: true });
          case 'POST /analyze': {
            const input = analyzeInput.safeParse(await json(req));
            if (!input.success) throw new ApiError('INVALID_INPUT', 400);
            const { profile, job } = input.data;
            const interpretation = await ai.analyze(await key(), profile, job);
            const report = reportSchema.safeParse(matchJob(profile, job, interpretation));
            if (!report.success) throw new ApiError('AI_RESPONSE_INVALID', 502);
            return send(res, 200, report.data);
          }
          default: throw new ApiError('NOT_FOUND', 404);
        }
      } finally { busy = false; }
    } catch (error) {
      if (!res.destroyed) {
        res.setHeader('Connection', 'close');
        if (error instanceof ApiError) send(res, error.status, { error: error.code });
        else send(res, 500, { error: 'CREDENTIAL_STORE_FAILURE' });
      }
    }
  }
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5000, keepAliveTimeout: 3000, maxHeaderSize: 8192 },
    (req, res) => { void handle(req, res); });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 50;
  server.setTimeout(37_000, socket => socket.destroy());
  return server;
}
