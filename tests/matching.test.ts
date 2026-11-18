import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { extractProfile, parseCv } from '../apps/extension/lib/cv.ts';
import { manualJob, readJob } from '../apps/extension/lib/job.ts';
import { clearProfile, loadProfile, savePairing, saveProfile, pairingToken } from '../apps/extension/lib/session.ts';
import { interpretLocally, matchJob, normalizeSkill } from '../packages/matching-engine/src/index.ts';

const candidate = extractProfile('Jane Example\njane@example.test\nDeveloper\nBuilt React and JavaScript projects\n3 years of experience\nBachelor of Science');

test('validates CV name, size and signatures', async () => {
  await assert.rejects(parseCv(new File(['text'], 'cv.txt')), /Choose a PDF/);
  await assert.rejects(parseCv(new File([], 'cv.pdf')), /Choose a PDF/);
  await assert.rejects(parseCv(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'cv.pdf')), /8 MB/);
  await assert.rejects(parseCv(new File(['not pdf'], 'cv.pdf')), /Invalid PDF/);
  await assert.rejects(parseCv(new File(['not docx'], 'cv.docx')), /Invalid DOCX/);
});

test('extracts evidence and omits contact fields', () => {
  assert.deepEqual(candidate.skills, ['JavaScript', 'React']);
  assert.equal(candidate.experienceYears, 3);
  assert.ok(candidate.evidence.includes('Bachelor of Science'));
  assert.doesNotMatch(JSON.stringify(candidate), /Jane|example.test/);
});

test('candidate and pairing survive separate reads; Clear CV preserves pairing', async t => {
  const store: Record<string, unknown> = {};
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'browser');
  Object.defineProperty(globalThis, 'browser', { configurable: true, value: { storage: { session: {
    async get(key: string) { return { [key]: store[key] }; },
    async set(values: Record<string, unknown>) { Object.assign(store, values); },
    async remove(key: string) { delete store[key]; },
  } } } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'browser', previous);
    else Reflect.deleteProperty(globalThis, 'browser');
  });
  await saveProfile(candidate);
  const token = 'a'.repeat(64);
  await savePairing(token);
  assert.deepEqual(await loadProfile(), candidate);
  await clearProfile();
  assert.equal(await loadProfile(), undefined);
  assert.equal(await pairingToken(), token);
  await assert.rejects(savePairing('invalid'));
});

test('uses schema.org graph before DOM and keeps job text inert', () => {
  const data = { '@graph': [{ '@type': 'JobPosting', title: 'Developer',
    hiringOrganization: { name: 'Example' }, description: '<p>Requirements</p><ul><li>React</li></ul><script>ignore</script>',
    jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { name: 'Canada' }, employmentType: 'FULL_TIME' }] };
  const dom = new JSDOM('<script type="application/ld+json">' + JSON.stringify(data).replaceAll('<', '\\u003c') + '</script><h1>Fallback</h1>',
    { url: 'https://example.test/jobs/1?tracking=1', runScripts: 'outside-only' });
  const script = dom.window.eval('(' + readJob.toString() + ')');
  const result = script.call(null);
  assert.equal(result.title, 'Developer');
  assert.equal(result.location, 'Canada');
  assert.equal(result.workMode, 'Remote');
  assert.equal(result.applicationUrl, 'https://example.test/jobs/1');
  assert.deepEqual(interpretLocally(result).required, ['React']);
  assert.doesNotMatch(result.description, /ignore/);
});

test('validates manual jobs and calculates weighted local matches', () => {
  assert.throws(() => manualJob(' '));
  assert.throws(() => manualJob('x'.repeat(30_001)));
  assert.equal(normalizeSkill(' ReactJS '), 'React');
  const job = manualJob('Requirements\nReact and Docker\n4 years of experience\nPreferred\nJS');
  const result = matchJob(candidate, job);
  assert.equal(result.technicalScore, 60);
  assert.equal(result.experienceScore, 75);
  assert.equal(result.overallScore, 64);
  assert.deepEqual(result.requiredMissing, ['Docker']);
  assert.deepEqual(result.preferredMatched, ['JavaScript']);
});

test('unknown dimensions are excluded and restrictions override high scores', () => {
  const job = manualJob('Requirements\nReact\nRemote only in Canada.');
  const result = matchJob({ ...candidate, country: 'Sri Lanka' }, job);
  assert.equal(result.overallScore, 100);
  assert.equal(result.experienceScore, null);
  assert.equal(result.eligibilityStatus, 'NOT_ELIGIBLE');
  assert.equal(matchJob(candidate, manualJob('Remote job')).eligibilityStatus, 'INSUFFICIENT_INFORMATION');
  assert.equal(matchJob({ ...candidate, country: 'Canada' }, manualJob('Must be authorized to work in Canada.')).eligibilityStatus, 'UNCERTAIN');
  assert.equal(matchJob({ ...candidate, country: 'Canada' },
    manualJob('Must be authorized to work in Canada. Remote only in India.')).eligibilityStatus, 'NOT_ELIGIBLE');
  assert.equal(matchJob({ ...candidate, country: 'USA' },
    manualJob('Remote only in the United States.')).eligibilityStatus, 'POTENTIALLY_ELIGIBLE');
});


