import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { windowsCredentials } from '../apps/local-api/src/credentials.ts';
import { ApiError, geminiClient, parseInterpretation } from '../apps/local-api/src/gemini.ts';
import { localServer, validToken } from '../apps/local-api/src/http.ts';
import { interpretLocally } from '../packages/matching-engine/src/index.ts';

const token = 'a'.repeat(64);
const origin = 'chrome-extension://' + 'a'.repeat(32);
const job = { title: 'Developer', description: 'Required: React.', location: '', workMode: '', employmentType: '', company: '', applicationUrl: '' };
const profile = { skills: ['React'], evidence: ['Built React apps.'], country: '', authorizedCountries: [], experienceYears: null };

test('validates Gemini output and bearer tokens', () => {
  const interpretation = interpretLocally(job);
  assert.deepEqual(parseInterpretation(JSON.stringify(interpretation)), interpretation);
  assert.throws(() => parseInterpretation(JSON.stringify({ ...interpretation, score: 100 })));
  assert.throws(() => parseInterpretation('x'.repeat(16_001)));
  assert.equal(validToken('Bearer ' + token, token), true);
  assert.equal(validToken('Bearer ' + 'b'.repeat(64), token), false);
  assert.equal(validToken(undefined, token), false);
});

test('Gemini analysis sends a small response schema and validates results locally', async t => {
  const key = 'synthetic-provider-key';
  const privateEvidence = 'unique-private-cv-marker';
  const item = { category: 'Technical', text: 'React', evidence: 'Required: React.', priority: 'Required' };
  let output = item;
  let calls = 0;
  const warn = t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init: RequestInit) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    assert.match(new URL(url).pathname, /\/models\/gemini-test:generateContent$/);
    const raw = String(init.body);
    const body = JSON.parse(raw);
    assert.doesNotMatch(raw, new RegExp(privateEvidence + '|' + key));
    if (++calls === 1) {
      assert.equal(body.generationConfig.responseJsonSchema, undefined);
    } else {
      const schema = body.generationConfig.responseJsonSchema;
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.deepEqual(schema.properties.items.items.required, ['category', 'text', 'evidence', 'priority']);
      assert.doesNotMatch(JSON.stringify(schema), /maxItems|maxLength|minLength|"enum"|\$schema/);
      assert.match(body.systemInstruction.parts[0].text, /Category must be one of:/);
      assert.ok(raw.includes(job.description));
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [output] }) }] } }] });
  });
  const ai = geminiClient('gemini-test');
  await ai.test(key);
  assert.deepEqual((await ai.analyze(key, { ...profile, evidence: [privateEvidence] }, job)).vacancyItems, [item]);
  output = { ...item, category: 'Invalid category' };
  await assert.rejects(ai.analyze(key, profile, job), { code: 'AI_RESPONSE_INVALID' });
  assert.equal(warn.mock.callCount(), 1);
});

test('Gemini diagnostics separate HTTP failures from nested transport errors without leaking exception text', async t => {
  const secretMarker = 'unique-secret-marker';
  const warn = t.mock.method(console, 'warn', () => {});
  let rejectWith: Error | undefined;
  let httpStatus = 400;
  let detail = '';
  t.mock.method(globalThis, 'fetch', async () => {
    if (rejectWith) throw rejectWith;
    return Response.json({ error: { code: httpStatus, message: secretMarker + detail } }, { status: httpStatus });
  });
  const ai = geminiClient('gemini-test');
  const analyze = () => ai.analyze(secretMarker, profile, job);
  for (const [status, message, code] of [
    [400, '', 'GEMINI_REQUEST_REJECTED'],
    [400, ' API_KEY_INVALID', 'INVALID_GEMINI_KEY'],
    [403, '', 'GEMINI_ACCESS_DENIED'],
    [404, '', 'GEMINI_MODEL_UNAVAILABLE'],
    [413, '', 'GEMINI_INPUT_TOO_LARGE'],
    [429, '', 'GEMINI_QUOTA_EXHAUSTED'],
  ] as const) {
    httpStatus = status;
    detail = message;
    await assert.rejects(analyze, { code });
    assert.equal(warn.mock.calls.at(-1)?.arguments[1].status, status);
  }
  for (const [cause, code] of [
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'GEMINI_TLS_FAILURE'],
    ['ENOTFOUND', 'GEMINI_DNS_FAILURE'],
    ['ECONNRESET', 'GEMINI_NETWORK_FAILURE'],
    ['UND_ERR_CONNECT_TIMEOUT', 'GEMINI_TIMEOUT'],
  ]) {
    const inner = Object.assign(new Error(secretMarker), { code: cause });
    rejectWith = new TypeError('fetch failed', { cause: new AggregateError([inner], secretMarker) });
    await assert.rejects(analyze, { code });
    assert.deepEqual(warn.mock.calls.at(-1)?.arguments[1].causes, [cause]);
  }
  rejectWith = new DOMException(secretMarker, 'AbortError');
  await assert.rejects(analyze, { code: 'GEMINI_TIMEOUT' });
  assert.doesNotMatch(JSON.stringify(warn.mock.calls.map(call => call.arguments)), /unique-secret-marker|Required: React/);
});

test('loopback routes validate requests, pairing, and mocked Gemini errors', async t => {
  let saved: string | undefined;
  const server = localServer({ host: '127.0.0.1', origin, token, credentials: {
    async read() { return saved; },
    async save(_name, key) { saved = key; },
    async remove() { saved = undefined; },
  }, ai: {
    async coverLetter(_key, input) { return 'I am interested in the ' + input.title + ' role.'; },
    async test(key) {
      if (key.startsWith('invalid')) throw new ApiError('INVALID_GEMINI_KEY', 422);
      if (key.startsWith('quota')) throw new ApiError('GEMINI_QUOTA_EXHAUSTED', 429);
    },
    async analyze(_key, _profile, vacancy) {
      return { ...interpretLocally(vacancy), required: ['Invented skill'], vacancyItems: [
        { category: 'Technical', text: 'React', evidence: 'Required: React.', priority: 'Required' },
        { category: 'Sponsorship', text: 'Visa sponsorship available', evidence: 'Visa sponsorship available', priority: 'Unspecified' },
      ] };
    },
  } });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { server.close(); server.closeAllConnections(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: address.port, path, method, headers: {
        Host: '127.0.0.1', Origin: origin, Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
      } }, response => {
        let text = '';
        response.setEncoding('utf8').on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, data: text ? JSON.parse(text) : undefined }));
      });
      request.on('error', reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  };
  assert.deepEqual(await call('/health', 'GET', undefined, { Authorization: '' }), { status: 200, data: { ok: true } });
  assert.equal((await call('/settings/ai/status', 'GET', undefined, { Authorization: '' })).status, 401);
  assert.equal((await call('/settings/ai/status', 'GET', undefined, { Origin: 'https://example.test' })).status, 401);
  assert.deepEqual((await call('/settings/ai/test', 'POST')).data, { error: 'MISSING_GEMINI_KEY' });
  assert.equal((await call('/settings/ai/key', 'PUT', { key: 'x'.repeat(25) }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call('/settings/ai/key', 'PUT', { key: 'short' })).status, 400);
  assert.equal((await call('/settings/ai/key', 'PUT', { key: 'invalid'.repeat(4) })).status, 204);
  assert.deepEqual((await call('/settings/ai/test', 'POST')).data, { error: 'INVALID_GEMINI_KEY' });
  assert.equal((await call('/settings/ai/key', 'PUT', { key: 'quota'.repeat(5) })).status, 204);
  assert.deepEqual((await call('/settings/ai/test', 'POST')).data, { error: 'GEMINI_QUOTA_EXHAUSTED' });
  const authKey = 'AQ.' + 'x'.repeat(50);
  assert.deepEqual(await call('/settings/ai/key', 'PUT', { key: ' ' + authKey + ' ' }), { status: 204, data: undefined });
  assert.equal(saved === authKey, true);
  assert.equal((await call('/settings/ai/key', 'PUT', { apiKey: authKey })).status, 400);
  assert.equal((await call('/settings/ai/key', 'PUT', { key: authKey, extra: true })).status, 400);
  assert.equal((await call('/settings/ai/key', 'PUT', { key: authKey + '\nextra' })).status, 400);
  assert.equal((await call('/settings/ai/key', 'PUT', { key: 'AQ.' + 'x'.repeat(198) })).status, 400);
  assert.deepEqual((await call('/settings/ai/status')).data, { configured: true });
  assert.deepEqual((await call('/settings/ai/test', 'POST')).data, { connected: true });
  assert.equal((await call('/analyze', 'POST', { profile, job, consent: false })).status, 400);
  const report = await call('/analyze', 'POST', { profile, job, consent: true });
  assert.equal(report.status, 200);
  assert.equal((report.data as { overallScore: number }).overallScore, 100);
  assert.doesNotMatch(JSON.stringify(report.data), /Invented skill|Visa sponsorship available/);
  const draft = { title: job.title, company: '', requirements: ['React'], evidence: profile.evidence, consent: true };
  assert.equal((await call('/cover-letter', 'POST', draft, { Authorization: '' })).status, 401);
  assert.equal((await call('/cover-letter', 'POST', { ...draft, consent: false })).status, 400);
  assert.deepEqual(await call('/cover-letter', 'POST', draft), { status: 200, data: { letter: 'I am interested in the Developer role.' } });
  assert.equal((await call('/settings/ai/key', 'DELETE')).status, 204);
  assert.deepEqual((await call('/cover-letter', 'POST', draft)).data, { error: 'MISSING_GEMINI_KEY' });
  assert.deepEqual((await call('/settings/ai/status')).data, { configured: false });
});

test('Windows DPAPI reloads encrypted credentials in a separate process', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jobfit-dpapi-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const store = windowsCredentials(directory);
  const secret = 'synthetic-test-key-first';
  assert.equal(await store.read('gemini'), undefined);
  await store.save('gemini', secret);
  assert.ok(!(await readFile(join(directory, 'gemini.dpapi'), 'utf8')).includes(secret));
  const readFromNewProcess = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    "import { windowsCredentials } from './apps/local-api/src/credentials.ts'; "
      + "if (await windowsCredentials(process.argv[1]).read('gemini') !== 'synthetic-test-key-first') process.exit(1);",
    directory], { stdio: 'ignore', windowsHide: true, timeout: 8000 });
  assert.equal(readFromNewProcess.status, 0);
  await store.save('gemini', 'synthetic-test-key-replacement');
  assert.equal(await windowsCredentials(directory).read('gemini'), 'synthetic-test-key-replacement');
  await store.remove('gemini');
  assert.equal(await windowsCredentials(directory).read('gemini'), undefined);
});
