import { useEffect, useRef, useState } from 'react';
import type { CandidateProfile, JobDetails, JobMatchResult } from '@jobfit/shared-types';
import { z } from 'zod';
import { api } from '../../lib/api';

export interface Report { job: JobDetails; result: JobMatchResult; mode: string; candidate: CandidateProfile }

const missing = 'Not Specified';
const percent = (value: number | null) => value === null ? 'Unknown' : value + '%';
const priority = { Required: 0, Unspecified: 1, Preferred: 2 };
const letterSchema = z.strictObject({ letter: z.string().trim().min(1).max(4500) });

export function MatchReport({ report: { job, result, mode, candidate }, letter, setLetter }: {
  report: Report;
  letter: string;
  setLetter: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { eligibility, requirements, information } = result.vacancy;
  const qualifications = requirements.filter(item => item.category !== 'Responsibilities')
    .sort((a, b) => priority[a.priority] - priority[b.priority]
      || Number(a.status === 'Matched') - Number(b.status === 'Matched'));
  const read = (...categories: typeof information[number]['category'][]) => [...new Set(information
    .filter(item => categories.includes(item.category)).map(item => item.text))].join(' · ');
  const restriction = read('Geography', 'Work authorization', 'Relocation', 'Timezone', 'Sponsorship');
  const incomplete = result.vacancy.warnings.find(warning => warning.includes('incomplete or truncated'));
  const arrangement = read('Work arrangement') || job.workMode;
  const modes = ['Remote', 'Hybrid', 'Onsite'].filter((label, index) =>
    [/\b(?:remote|work from anywhere)\b/i, /\bhybrid\b/i, /\bon[- ]?site\b/i][index]?.test(arrangement));
  const employment = read('Employment type') || job.employmentType;
  const sponsorship = read('Sponsorship');
  const denial = /\b(?:no (?:visa )?sponsorship|sponsorship (?:is )?not (?:available|offered|provided)|(?:cannot|do not|don't|will not) sponsor|without (?:visa )?sponsorship)\b/i;
  const denied = denial.test(sponsorship);
  const offered = information.some(item => item.category === 'Sponsorship' && !denial.test(item.text)
    && /\b(?:sponsorship (?:is )?(?:available|offered|provided)|(?:we|employer) (?:can|will) sponsor|(?:offers?|provides?) visa sponsorship)\b/i.test(item.text));
  const uncertainVisa = /\b(?:may|might|could|subject to|case.by.case|depends)\b/i.test(sponsorship);
  const visa = denied && offered || uncertainVisa ? 'Unknown' : denied ? 'Not Available' : offered ? 'Available' : missing;
  const residence = candidate.country || 'Sri Lanka';
  return (
    <div className="report">
      <section className="job-header">
        <h2>{job.title || 'Vacancy results'}</h2>
        <p>{[job.company, job.location || read('Location')].filter(Boolean).join(' · ') || 'Company and location not specified'}</p>
      </section>
      <section className="eligibility" data-status={eligibility.status}>
        <h2>Can I Apply from {residence}?</h2>
        <p className="eligibility-status"><span aria-hidden="true">{eligibility.status === 'Eligible' ? '✓' : eligibility.status === 'Not Eligible' ? '×' : '?'}</span> {eligibility.status}</p>
        <p>{eligibility.explanation}</p>
        {restriction && <p className="muted">{restriction.slice(0, 350)}</p>}
        {eligibility.questions[0] && <p>{eligibility.questions[0]}</p>}
        {incomplete && <p className="warning">{incomplete}</p>}
      </section>
      <section aria-label="Match scores">
        <dl className="facts scores">
          <div><dt>Overall CV Match</dt><dd className="score">{percent(result.overallScore)}</dd></div>
          <div><dt>Technical Skills Match</dt><dd className="score">{percent(result.technicalScore)}</dd></div>
        </dl>
        <p className="mode">{mode}</p>
      </section>
      <section>
        <h2>Job conditions</h2>
        <dl className="facts">
          <div><dt>Work Mode</dt><dd>{modes.length === 1 && !/\b(?:not|no)\s+(?:fully\s+)?remote\b/i.test(arrangement) ? modes[0] : arrangement ? 'Unknown' : missing}</dd></div>
          <div><dt>Working Hours</dt><dd>{read('Working hours', 'Timezone') || missing}</dd></div>
          <div><dt>Employment Type</dt><dd>{employment.replace(/\bFULL_TIME\b/g, 'Full-time').replace(/\bPART_TIME\b/g, 'Part-time').replace(/\bCONTRACTOR\b/g, 'Contract').replace(/\bTEMPORARY\b/g, 'Temporary').replace(/\bINTERN\b/g, 'Internship') || missing}</dd></div>
          <div><dt>Visa Sponsorship</dt><dd>{visa}{sponsorship && <p className="muted">{sponsorship}</p>}</dd></div>
        </dl>
      </section>
      <section>
        <h2>Key qualifications</h2>
        {!qualifications.length && <p>No comparable qualifications extracted.</p>}
        <ul className="qualification-list">
          {qualifications.slice(0, expanded ? undefined : 5).map(item => <li key={item.id}>
            <div><strong>{item.text}</strong> <span className="pill" data-status={item.status}>{item.status === 'Partially Matched' ? 'Partial' : item.status}</span></div>
            <p className="muted">{item.candidateEvidence[0] || item.explanation}</p>
          </li>)}
        </ul>
        {qualifications.length > 5 && <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show Less' : 'Show More'}</button>}
      </section>
      <section><h2>Quick recommendation</h2><p>{result.recommendation}</p></section>
      <CoverLetter report={{ job, result, mode, candidate }} letter={letter} setLetter={setLetter} />
    </div>
  );
}

function CoverLetter({ report: { job, result, candidate }, letter, setLetter }: {
  report: Report;
  letter: string;
  setLetter: (value: string) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function generate() {
    if (!consent || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    const pending = new AbortController();
    request.current = pending;
    try {
      const requirements = result.vacancy.requirements.filter(item => item.category !== 'Responsibilities');
      const relevant = new Set(requirements.filter(item => item.basis === 'Explicit' && item.status === 'Matched')
        .flatMap(item => item.candidateEvidence));
      const response = await api('/cover-letter', { method: 'POST', schema: letterSchema, signal: pending.signal, body: {
        consent: true, title: job.title, company: job.company,
        requirements: requirements.slice(0, 24).map(item => item.text.slice(0, 500)),
        evidence: candidate.evidence.filter(line => relevant.has(line)).slice(0, 16),
      } });
      if (pending.signal.aborted) return;
      if (!response) throw new Error('Empty response.');
      setLetter(response.letter);
      setStatus('Draft ready. Review it before copying.');
    } catch (error) {
      if (!pending.signal.aborted) setError('Cover-letter generation requires a working Gemini connection. ' + (error instanceof Error ? error.message : 'Try again.'));
    } finally { setBusy(false); }
  }
  async function copy() {
    setError('');
    setStatus('');
    try { await navigator.clipboard.writeText(letter); setStatus('Cover letter copied.'); }
    catch { setError('Clipboard unavailable. Select and copy the preview.'); }
  }
  return <section>
    <h2>Cover letter</h2>
    <label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
      <span>Allow Gemini to receive the job requirements and matching CV excerpts for this draft.</span></label>
    <div className="actions">
      <button className="primary" disabled={!consent || busy} onClick={() => void generate()}>{busy ? 'Generating…' : letter ? 'Regenerate' : 'Generate Cover Letter'}</button>
      {letter && <button onClick={() => void copy()}>Copy to clipboard</button>}
    </div>
    {busy && <p role="status">Generating cover letter…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="notice">{error}</p>}
    {letter && <label>Editable preview<textarea rows={9} maxLength={4500} value={letter} onChange={event => setLetter(event.target.value)} /></label>}
  </section>;
}
