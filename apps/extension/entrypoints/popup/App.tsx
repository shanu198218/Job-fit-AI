import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { reportSchema } from '../../../../packages/shared-types/src/report.ts';
import type { CandidateProfile, JobDetails, JobMatchResult } from '@jobfit/shared-types';
import { matchJob } from '../../../../packages/matching-engine/src/index.ts';
import { api } from '../../lib/api';
import { parseCv } from '../../lib/cv';
import { manualJob, readJob } from '../../lib/job';
import { clearProfile, loadProfile, savePairing, saveProfile } from '../../lib/session';

interface Report { job: JobDetails; result: JobMatchResult; mode: string }

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The operation failed.';
}

export default function App() {
  const [profile, setProfile] = useState<CandidateProfile>();
  const [settings, setSettings] = useState(false);
  const [token, setToken] = useState('');
  const [key, setKey] = useState('');
  const [backend, setBackend] = useState('Checking');
  const [pairing, setPairing] = useState('Checking');
  const [ai, setAi] = useState('Checking');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [manual, setManual] = useState('');
  const [report, setReport] = useState<Report>();

  async function refresh() {
    try {
      await api('/health', { schema: z.strictObject({ ok: z.literal(true) }) });
      setBackend('Online');
    } catch {
      setBackend('Offline');
      setPairing('Unavailable');
      setAi('Backend Offline');
      return;
    }
    try {
      const status = await api('/settings/ai/status', { schema: z.strictObject({ configured: z.boolean() }) });
      setPairing('Paired');
      setAi(status?.configured ? 'Configured' : 'Not Configured');
    } catch (error) {
      setPairing(message(error).startsWith('Pair') ? 'Unpaired' : 'Unavailable');
      setAi(message(error));
    }
  }

  useEffect(() => {
    void loadProfile().then(setProfile).catch(() => setError('Unable to open the CV session.'));
    void refresh();
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    try { await action(); } catch (error) { setError(message(error)); }
    finally { setBusy(''); }
  }

  async function analyze(source: 'tab' | 'manual') {
    if (!profile) return;
    const candidate = profile;
    await run('Analyzing vacancy…', async () => {
      setReport(undefined);
      let job: JobDetails;
      if (source === 'manual') job = manualJob(manual);
      else {
        try {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.id === undefined) throw new Error();
          const [frame] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: readJob });
          if (!frame?.result || frame.result.description.length < 80) throw new Error();
          job = frame.result;
        } catch { throw new Error('Could not read this vacancy. Paste its description below.'); }
      }
      if (consent) {
        try {
          const result = await api('/analyze', { method: 'POST', body: { profile: candidate, job, consent: true }, schema: reportSchema });
          if (!result) throw new Error('Local API returned an empty report.');
          setAi('Connected');
          setReport({ job, result, mode: 'Gemini-Assisted Analysis' });
          return;
        } catch (error) {
          setAi(message(error));
          setError(message(error) + ' Showing local analysis.');
        }
      }
      setReport({ job, result: matchJob(candidate, job), mode: 'Local Basic Analysis' });
    });
  }

  function profileDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const data = new FormData(event.currentTarget);
    const years = String(data.get('years') ?? '');
    const updated = { ...profile, country: String(data.get('country') ?? '').trim(),
      authorizedCountries: String(data.get('authorization') ?? '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 10),
      experienceYears: years ? Number(years) : null };
    void run('Saving CV details…', async () => { await saveProfile(updated); setProfile(updated); setReport(undefined); });
  }

  return (
    <main>
      <header>
        <h1>JobFit AI</h1>
        <button type="button" disabled={!!busy} onClick={() => { setSettings(!settings); setError(''); setKey(''); setToken(''); }}>
          {settings ? 'Back to analysis' : 'AI Settings'}
        </button>
      </header>
      <div className="status" aria-live="polite"><span>Backend {backend}</span><span>Gemini · {ai}</span></div>
      {busy && <p role="status">{busy}</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      {settings ? (
        <>
          <section>
            <h2>Local pairing</h2>
            <button disabled={!!busy} onClick={() => void run('Checking backend…', refresh)}>Refresh status</button>
            <p>{pairing}. Run <code>pnpm.cmd pair</code> and paste the token here.</p>
            <form onSubmit={event => {
              event.preventDefault();
              void run('Pairing…', async () => { await savePairing(token.trim()); setToken(''); await refresh(); });
            }}>
              <label htmlFor="pairing">Pairing token</label>
              <input id="pairing" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} required />
              <button disabled={!!busy}>Pair extension</button>
            </form>
          </section>
          <section>
            <h2>Gemini API key</h2>
            <form onSubmit={event => {
              event.preventDefault();
              const submitted = key;
              setKey('');
              void run('Saving key…', async () => { await api('/settings/ai/key', { method: 'PUT', body: { key: submitted } }); await refresh(); });
            }}>
              <label htmlFor="gemini-key">New API key</label>
              <input id="gemini-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} required />
              <button disabled={!!busy || pairing !== 'Paired'}>Save or replace key</button>
            </form>
            <div className="actions">
              <button disabled={!!busy || pairing !== 'Paired'} onClick={() => void run('Testing connection…', async () => {
                try { await api('/settings/ai/test', { method: 'POST', schema: z.strictObject({ connected: z.literal(true) }) }); setAi('Connected'); }
                catch (error) { setAi(message(error)); throw error; }
              })}>Test connection</button>
              <button disabled={!!busy || pairing !== 'Paired'} onClick={() => void run('Removing key…', async () => {
                await api('/settings/ai/key', { method: 'DELETE' }); await refresh();
              })}>Remove key</button>
            </div>
          </section>
          <section><h2>Privacy</h2><p>The original CV stays on your device. The extracted profile and pairing token expire with the Chrome extension session. Windows protects the saved API key under your user account. Google’s retention policies apply to information sent to Gemini.</p></section>
        </>
      ) : (
        <>
          <section>
            <h2>Candidate profile</h2>
            <label htmlFor="cv">Upload CV</label>
            <input id="cv" type="file" accept=".pdf,.docx" disabled={!!busy} onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void run('Reading CV locally…', async () => {
                const extracted = await parseCv(file);
                await saveProfile(extracted); setProfile(extracted); setReport(undefined);
              });
            }} />
            <p role="status">{profile ? 'CV ready · ' + profile.skills.length + ' recognized skills' : 'PDF or DOCX · up to 8 MB'}</p>
            {profile && <>
              <details>
                <summary>Candidate details</summary>
                <p>{profile.skills.join(', ') || 'No catalog skills recognized.'}</p>
                <ReportList title="CV evidence" entries={profile.evidence} />
                <form key={JSON.stringify([profile.country, profile.authorizedCountries, profile.experienceYears])} onSubmit={profileDetails}>
                  <label htmlFor="country">Country of residence</label>
                  <input id="country" name="country" maxLength={100} defaultValue={profile.country} />
                  <label htmlFor="authorization">Countries where you can work (comma-separated)</label>
                  <input id="authorization" name="authorization" maxLength={200} defaultValue={profile.authorizedCountries.join(', ')} />
                  <label htmlFor="years">Relevant years of experience</label>
                  <input id="years" name="years" type="number" min="0" max="99" step="0.5" defaultValue={profile.experienceYears ?? ''} />
                  <button disabled={!!busy}>Save details</button>
                </form>
              </details>
              <button disabled={!!busy} onClick={() => void run('Clearing CV…', async () => {
                await clearProfile(); setProfile(undefined); setReport(undefined);
              })}>Clear CV</button>
            </>}
          </section>
          <section>
            <h2>Analyze a vacancy</h2>
            <label className="consent">
              <input type="checkbox" checked={consent} disabled={!!busy} onChange={event => setConsent(event.target.checked)} />
              <span>Allow Gemini to receive selected CV evidence and vacancy text. Google’s retention and data-use policies apply after transmission.</span>
            </label>
            <button className="primary" disabled={!profile || !!busy} onClick={() => void analyze('tab')}>Analyze Current Job</button>
            <details>
              <summary>Enter job description manually</summary>
              <label htmlFor="job">Job description</label>
              <textarea id="job" value={manual} maxLength={30_000} rows={5} onChange={event => setManual(event.target.value)} />
              <button disabled={!profile || !manual.trim() || !!busy} onClick={() => void analyze('manual')}>Analyze pasted job</button>
            </details>
          </section>
          {report && <MatchReport report={report} />}
        </>
      )}
    </main>
  );
}

function MatchReport({ report: { job, result, mode } }: { report: Report }) {
  const percent = (score: number | null) => score === null ? 'Unknown' : score + '%';
  return (
    <section aria-label="Match report">
      <h2>{job.title || 'Match report'}</h2>
      <p>{[job.company, job.location, job.workMode, job.employmentType].filter(Boolean).join(' · ')}</p>
      <p className="mode">{mode}</p>
      <dl>
        <div><dt>Overall</dt><dd>{percent(result.overallScore)}</dd></div>
        <div><dt>Skills</dt><dd>{percent(result.technicalScore)}</dd></div>
        <div><dt>Experience</dt><dd>{percent(result.experienceScore)}</dd></div>
      </dl>
      <h3>Eligibility</h3>
      <p>{result.eligibilityStatus.replaceAll('_', ' ')}</p>
      <p>{result.recommendation}</p>
      <h3>Requirements</h3>
      <p>Required matched · {result.requiredMatched.join(', ') || 'None identified'}</p>
      <p>Required gaps · {result.requiredMissing.join(', ') || 'None identified'}</p>
      <p>Preferred matched · {result.preferredMatched.join(', ') || 'None identified'}</p>
      <p>Education · {result.education}</p>
      <ReportList title="Responsibilities" entries={result.responsibilities} />
      <ReportList title="Transferable skills" entries={result.transferable.map(item => item.skill + ' · ' + item.evidence)} />
      <ReportList title="Supporting evidence" entries={result.evidence} />
      <ReportList title="Suggested CV improvements" entries={result.improvements} />
    </section>
  );
}

function ReportList({ title, entries }: { title: string; entries: string[] }) {
  return entries.length ? <><h3>{title}</h3><ul>{entries.map((entry, i) => <li key={i}>{entry}</li>)}</ul></> : null;
}
