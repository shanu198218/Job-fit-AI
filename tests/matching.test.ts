import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { extractProfile, parseCv } from '../apps/extension/lib/cv.ts';
import { manualJob, readJob } from '../apps/extension/lib/job.ts';
import { clearProfile, loadProfile, savePairing, saveProfile, pairingToken } from '../apps/extension/lib/session.ts';
import { interpretLocally, matchJob, normalizeSkill } from '../packages/matching-engine/src/index.ts';
import { countCoverage } from '../packages/matching-engine/src/vacancy.ts';

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

test('overall CV match includes required qualifications without changing the technical score', () => {
  const vacancy = manualJob('Requirements\nReact\nBachelor of Physics');
  const supported = matchJob({ ...candidate, evidence: ['Built React apps', 'Bachelor of Physics'] }, vacancy);
  const unsupported = matchJob({ ...candidate, evidence: ['Built React apps'] }, vacancy);
  assert.equal(supported.overallScore, 100);
  assert.equal(unsupported.overallScore, 75);
  assert.equal(unsupported.technicalScore, 100);
  assert.equal(unsupported.vacancy.requirements.find(item => item.category === 'Education')?.status, 'Not Evidenced');
  const empty = matchJob({ ...candidate, skills: [], evidence: [] }, vacancy);
  assert.equal(empty.overallScore, null);
  assert.equal(empty.technicalScore, null);
});

test('local extraction preserves work mode, exact hours, and distinct employment conditions', () => {
  for (const mode of ['Remote', 'Hybrid', 'Onsite']) {
    const vacancy = manualJob(`Work mode: ${mode}\n09:00–17:00 UTC+05:30\nFull-time contract\nVisa sponsorship is available.`);
    const facts = matchJob(candidate, vacancy).vacancy.information;
    assert.ok(facts.some(item => item.category === 'Work arrangement' && item.text === `Work mode: ${mode}`));
    for (const category of ['Working hours', 'Timezone']) {
      assert.ok(facts.some(item => item.category === category && item.text === '09:00–17:00 UTC+05:30'));
    }
    assert.ok(facts.some(item => item.category === 'Employment type' && item.text === 'Full-time contract'));
    assert.ok(facts.some(item => item.category === 'Sponsorship' && item.text === 'Visa sponsorship is available.'));
  }
  const permanent = matchJob(candidate, manualJob('Permanent role. Relocation assistance offered.')).vacancy.information;
  assert.ok(permanent.some(item => item.category === 'Employment type' && item.text === 'Permanent role.'));
  assert.ok(!permanent.some(item => item.category === 'Sponsorship'));
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
    manualJob('Remote only in the United States.')).eligibilityStatus, 'ELIGIBLE');
});

test('extracts and compares requirements and keeps vacancy conditions outside coverage', () => {
  const job = manualJob([
    'Job title: Data Engineer', 'Requirements', 'Apache Flink, React and Docker', 'React',
    '5+ years of professional experience', 'Bachelor of Science', 'English fluency',
    'Preferred skills', 'Terraform', 'Responsibilities', 'Maintain streaming pipelines',
    'Background check required', 'Salary: USD 100,000–120,000 per year', 'Benefits: dental insurance',
    '6-month contract', 'Working hours: 40 hours per week', 'UTC overlap required',
    'Apply by 2027-03-31', 'Submit your CV and cover letter', 'Remote only in Sri Lanka',
  ].join('\n'));
  const profile = { ...candidate, evidence: [...candidate.evidence, 'Built Apache Flink pipelines', 'English fluency'] };
  const { vacancy } = matchJob(profile, job);
  assert.equal(vacancy.requirements.length, 9);
  assert.equal(vacancy.requirements.filter(item => item.text === 'React').length, 1);
  assert.equal(vacancy.requirements.find(item => item.text === 'Terraform')?.priority, 'Preferred');
  assert.equal(vacancy.requirements.find(item => item.text === 'Apache Flink')?.status, 'Matched');
  assert.deepEqual(vacancy.requirements.find(item => item.text === 'Apache Flink')?.candidateEvidence, ['Built Apache Flink pipelines']);
  assert.equal(vacancy.requirements.find(item => item.text === '5+ years of professional experience')?.status, 'Partially Matched');
  assert.deepEqual(countCoverage(vacancy.requirements), { Matched: 4, 'Partially Matched': 1, 'Not Evidenced': 3, Unknown: 1 });
  assert.ok(vacancy.information.some(item => item.category === 'Compensation' && item.evidence.includes('100,000–120,000')));
  assert.ok(vacancy.information.some(item => item.category === 'Deadline'));
});

test('handles ambiguity, negation and ungrounded Gemini items', () => {
  const job = manualJob('Requirements\nReact or Vue\nKubernetes\nDocker\nRead more…');
  const profile = { ...candidate, evidence: ['Built React apps', 'No Docker experience', 'Built container images'] };
  const result = matchJob(profile, job, { ...interpretLocally(job), vacancyItems: [
    { category: 'Technical', text: 'Scala', evidence: 'Scala required', priority: 'Required' },
    { category: 'Technical', text: 'Vue', evidence: 'React or Vue', priority: 'Required' },
  ] });
  assert.equal(result.vacancy.requirements.find(item => item.text === 'React or Vue')?.status, 'Partially Matched');
  assert.equal(result.vacancy.requirements.find(item => item.text === 'Docker')?.status, 'Partially Matched');
  assert.deepEqual(result.vacancy.requirements.find(item => item.text === 'Docker')?.candidateEvidence, ['Built container images']);
  assert.ok(!result.vacancy.requirements.some(item => ['Scala', 'Vue'].includes(item.text)));
  assert.ok(result.vacancy.warnings.some(warning => /incomplete/.test(warning)));
});

test('Sri Lanka eligibility distinguishes explicit restrictions from unresolved overseas hiring', () => {
  const profile = { ...candidate, country: 'Sri Lanka' };
  const status = (description: string) => matchJob(profile, manualJob(description)).vacancy.eligibility.status;
  assert.equal(status('Remote only in Sri Lanka. Applicants from Sri Lanka are welcome.'), 'Eligible');
  assert.equal(status('Remote worldwide, excluding candidates from Sri Lanka.'), 'Not Eligible');
  assert.equal(status('Remote only in Canada.'), 'Not Eligible');
  assert.equal(status('Remote (US only).'), 'Not Eligible');
  assert.equal(status('Remote role. Join our engineering team.'), 'Needs Verification');
  assert.equal(status('Location: London, United Kingdom. Onsite. Visa sponsorship is available.'), 'Needs Verification');
  assert.equal(status('Location: London, United Kingdom. Onsite. Contact us about visas.'), 'Needs Verification');
  assert.equal(status('Remote worldwide. Must work hours with UTC overlap.'), 'Needs Verification');
  assert.equal(status('Work from anywhere in Europe.'), 'Needs Verification');
  assert.equal(status('Remote worldwide. Read more…'), 'Needs Verification');
  assert.equal(matchJob({ ...profile, authorizedCountries: ['Sri Lanka'] },
    manualJob('Must be authorized to work in Canada without sponsorship.')).vacancy.eligibility.status, 'Not Eligible');
});


