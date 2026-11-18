import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { reportSchema } from '../../../../packages/shared-types/src/report.ts';
import type { CandidateProfile, JobDetails } from '@jobfit/shared-types';
import { matchJob } from '../../../../packages/matching-engine/src/index.ts';
import { api } from '../../lib/api';
import { parseCv } from '../../lib/cv';
import { manualJob, readJob } from '../../lib/job';
import { clearProfile, loadProfile, savePairing, saveProfile } from '../../lib/session';
import { MatchReport, type Report } from './MatchReport';

const pages = ['Job Analysis', 'CV Profile', 'Results', 'AI Settings'] as const;

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The operation failed.';
}

export default function App() {
  const [profile, setProfile] = useState<CandidateProfile>();
  const [page, setPage] = useState<(typeof pages)[number]>('Job Analysis');
  const [token, setToken] = useState('');
  const [key, setKey] = useState('');
  const [backend, setBackend] = useState('Checking');
  const [pairing, setPairing] = useState('Checking');
  const [ai, setAi] = useState('Checking');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [consent, setConsent] = useState(false);
  const [manual, setManual] = useState('');
  const [report, setReport] = useState<Report>();
  const [letter, setLetter] = useState('');
  const content = useRef<HTMLElement>(null);

  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [page]);

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
    void loadProfile().then(saved => {
      setProfile(saved);
      if (!saved) setPage(current => current === 'Job Analysis' ? 'CV Profile' : current);
    }).catch(() => setError('Unable to open the CV session.'));
    void refresh();
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    setFeedback('');
    try { await action(); } catch (error) { setError(message(error)); }
    finally { setBusy(''); }
  }

  async function analyze(source: 'tab' | 'manual') {
    if (!profile) return;
    const candidate = profile;
    await run('Analyzing vacancy…', async () => {
      setReport(undefined);
      setLetter('');
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
          setReport({ job, result, mode: 'Gemini-Assisted Analysis', candidate });
          setPage('Results');
          return;
        } catch (error) {
          setAi(message(error));
          setError(message(error) + ' Showing local analysis.');
        }
      }
      setReport({ job, result: matchJob(candidate, job), mode: 'Local Basic Analysis', candidate });
      setPage('Results');
    });
  }

  function profileDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const data = new FormData(event.currentTarget);
    const years = String(data.get('years') ?? '');
    const updated = { ...profile, country: String(data.get('country') ?? '').trim(),
      authorizedCountries: String(data.get('authorization') ?? '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 10),
      experienceYears: years ? Number(years) : null,
      experienceSource: years ? Number(years) !== profile.experienceYears ? 'Self-reported' as const : profile.experienceSource : undefined };
    void run('Saving CV details…', async () => {
      await saveProfile(updated); setProfile(updated); setReport(undefined); setLetter(''); setFeedback('Candidate details saved.');
    });
  }

  return (
    <div className="popup">
      <header><h1><span className="brand" aria-hidden="true">J</span> JobFit AI</h1></header>
      <nav aria-label="JobFit sections">
        {pages.map(item => <button key={item} type="button" aria-current={item === page ? 'page' : undefined} disabled={!!busy}
          onClick={() => { setPage(item); setError(''); setFeedback(''); setKey(''); setToken(''); }}>{item}</button>)}
      </nav>
      <main ref={content} className="popup-content" aria-label={page} tabIndex={0}>
      {busy && <p role="status">{busy}</p>}
      {feedback && <p className="feedback" role="status">{feedback}</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      {page === 'AI Settings' && (
        <>
          <div className="status" aria-live="polite"><span>Backend {backend}</span><span>Gemini · {ai}</span></div>
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
              void run('Saving key…', async () => {
                await api('/settings/ai/key', { method: 'PUT', body: { key: submitted } }); await refresh(); setFeedback('Gemini key saved.');
              });
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
                await api('/settings/ai/key', { method: 'DELETE' }); await refresh(); setFeedback('Gemini key removed.');
              })}>Remove key</button>
            </div>
          </section>
          <section><h2>Privacy</h2><p>The original CV stays on your device. The extracted profile and pairing token expire with the Chrome extension session. Windows protects the saved API key under your user account. Google’s retention policies apply to information sent to Gemini.</p></section>
        </>
      )}
      {page === 'CV Profile' && (
          <section>
            <h2>Candidate profile</h2>
            <label htmlFor="cv">Upload CV</label>
            <input id="cv" type="file" accept=".pdf,.docx" disabled={!!busy} onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void run('Reading CV locally…', async () => {
                const extracted = await parseCv(file);
                await saveProfile(extracted); setProfile(extracted); setReport(undefined); setLetter('');
              });
            }} />
            <p role="status">{profile ? 'CV ready · ' + profile.skills.length + ' recognized skills' : 'PDF or DOCX · up to 8 MB'}</p>
            {profile && <>
              <details open>
                <summary>Candidate details</summary>
                <p>{profile.skills.join(', ') || 'No catalog skills recognized.'}</p>
                {profile.evidence.length > 0 && <details><summary>CV evidence</summary><ul>{profile.evidence.map((entry, i) => <li key={i}>{entry}</li>)}</ul></details>}
                <form key={JSON.stringify([profile.country, profile.authorizedCountries, profile.experienceYears])} onSubmit={profileDetails}>
                  <label htmlFor="country">Country of residence</label>
                    <input id="country" name="country" placeholder="e.g. Sri Lanka" maxLength={100} defaultValue={profile.country} />
                  <label htmlFor="authorization">Countries where you can work (comma-separated)</label>
                  <input id="authorization" name="authorization" maxLength={200} defaultValue={profile.authorizedCountries.join(', ')} />
                  <label htmlFor="years">Relevant years of experience</label>
                  <input id="years" name="years" type="number" min="0" max="99" step="0.5" defaultValue={profile.experienceYears ?? ''} />
                  <button disabled={!!busy}>Save details</button>
                </form>
              </details>
              <button className="primary" disabled={!!busy} onClick={() => setPage('Job Analysis')}>Continue to Job Analysis</button>
              <button disabled={!!busy} onClick={() => void run('Clearing CV…', async () => {
                await clearProfile(); setProfile(undefined); setReport(undefined); setLetter(''); setFeedback('CV cleared from this session.');
              })}>Clear CV</button>
            </>}
          </section>
      )}
      {page === 'Job Analysis' && (
          <section>
            <h2>Analyze a vacancy</h2>
            {!profile && <p>Upload a CV in <button onClick={() => setPage('CV Profile')}>CV Profile</button> to start.</p>}
            <label className="consent">
              <input type="checkbox" checked={consent} disabled={!!busy} onChange={event => setConsent(event.target.checked)} />
              <span>Allow Gemini to receive vacancy text for extraction. CV comparison runs on this device. Google’s retention and data-use policies apply to the vacancy text.</span>
            </label>
            <button className="primary" disabled={!profile || !!busy} onClick={() => void analyze('tab')}>Analyze Current Job</button>
            <details>
              <summary>Enter job description manually</summary>
              <label htmlFor="job">Job description</label>
              <textarea id="job" value={manual} maxLength={30_000} rows={5} disabled={!!busy} onChange={event => setManual(event.target.value)} />
              <button disabled={!profile || !manual.trim() || !!busy} onClick={() => void analyze('manual')}>Analyze pasted job</button>
            </details>
          </section>
      )}
      {page === 'Results' && (report ? <MatchReport report={report} letter={letter} setLetter={setLetter} />
        : <section><h2>Results</h2><p>Analyze a vacancy to see your score, requirement coverage, and eligibility.</p>
          <button className="primary" onClick={() => setPage('Job Analysis')}>Go to Job Analysis</button></section>)}
      </main>
    </div>
  );
}
