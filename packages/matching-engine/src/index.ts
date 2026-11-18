import type { CandidateProfile, Interpretation, JobDetails, JobMatchResult } from '../../shared-types/src/index.ts';
import { assessEligibility } from '../../eligibility-engine/src/index.ts';
import { buildVacancyReport, isSkillLabel, minimumGeneralExperience } from './vacancy.ts';
import { extractSkills, normalizeSkill } from './skills.ts';

export { extractSkills, normalizeSkill } from './skills.ts';

const scoreWeights = { required: 60, preferred: 15, experience: 25, education: 20 };

export function interpretLocally(job: JobDetails): Interpretation {
  const required = new Set<string>();
  const preferred = new Set<string>();
  const quoted: string[] = [];
  const duties: string[] = [];
  let section = '';
  let years: number | null = null;
  let education = '';
  let sponsorship = '';
  for (const line of job.description.split(/\n|(?<=[.!?])\s+/)) {
    const text = line.trim();
    if (/^(?:preferred|nice.to.have|desirable)/i.test(text)) section = 'preferred';
    else if (/^(?:requirements|required|minimum qualifications|qualifications|must.have)/i.test(text)) section = 'required';
    else if (/^(?:responsibilities|what you.ll do|duties)/i.test(text)) section = 'duties';
    else if (/^(?:benefits|about us|how to apply)/i.test(text)) section = '';
    const priority = /\b(preferred|nice.to.have|desirable|bonus)\b/i.test(text) ? 'preferred'
      : /\b(required|must have|minimum)\b/i.test(text) ? 'required' : section;
    if (priority === 'preferred' || priority === 'required') {
      for (const skill of extractSkills(text)) (priority === 'preferred' ? preferred : required).add(skill);
    }
    if (section === 'duties' && text && duties.length < 12) duties.push(text.slice(0, 350));
    const experience = text.match(/\b(\d{1,2})(?:\s*[-\u2013\u2014]\s*\d{1,2})?\s*\+?\s+years?\b/i);
    if (experience && priority !== 'preferred' && /experience|professional/i.test(text)) {
      years = Math.max(years ?? 0, Number(experience[1]));
    }
    if (!education && /\b(degree|bachelor|bsc|b\.s\.|beng|btech|master|msc|phd|diploma)\b/i.test(text)) education = text.slice(0, 350);
    if (/\b(visa|sponsor(?:ship|ed)?|work authori[sz]ation|right to work|eligible to work|authori[sz]ed to work|based in|reside in|must live in|excluding|cannot hire|not eligible|only candidates|remote.{0,30}only)\b/i.test(text)) quoted.push(text);
    if (!sponsorship && /\b(visa|sponsor(?:ship|ed)?)\b/i.test(text)) sponsorship = text.slice(0, 350);
  }
  return {
    required: [...required], preferred: [...preferred].filter(skill => !required.has(skill)),
    years, education, restrictions: quoted.join('\n').slice(0, 1000), sponsorship,
    responsibilities: duties, transferable: [], improvements: [],
  };
}

function statusValue(status: string): number | null {
  return status === 'Matched' ? 1 : status === 'Partially Matched' ? 0.5 : status === 'Not Evidenced' ? 0 : null;
}

function coverageRate(items: { status: string }[]) {
  const values = items.map(item => statusValue(item.status)).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function weightedScore(dimensions: { value: number | null; weight: number }[]) {
  const known = dimensions.filter((item): item is { value: number; weight: number } => item.value !== null);
  const weight = known.reduce((sum, item) => sum + item.weight, 0);
  return weight ? Math.round(100 * known.reduce((sum, item) => sum + item.value * item.weight, 0) / weight) : null;
}

function scoreableRequirements<T extends { text: string }>(items: T[]) {
  const labels = new Set(items.map(item => normalizeSkill(item.text)));
  const related: Record<string, string[]> = {
    'SQL databases': ['MySQL', 'PostgreSQL', 'SQL Server', 'SQL'],
    'NoSQL databases': ['MongoDB'],
    SQL: ['SQL Server'],
    '.NET': ['.NET Core'],
  };
  return items.filter(item => {
    const label = normalizeSkill(item.text);
    return !Object.entries(related).some(([parent, children]) => label === parent && children.some(child => labels.has(child)));
  });
}

function educationMatch(requirement: string, evidence: string[]) {
  if (!requirement) return 'No explicit education requirement found.';
  if (!evidence.length) return 'Education evidence unavailable. Vacancy: ' + requirement;
  const levels = [/\b(diploma|associate)\b/i, /\b(bachelor|bsc|b\.s\.|beng|btech)\b/i,
    /\b(master|msc|m\.s\.|meng|mtech)\b/i, /\b(phd|doctorate)\b/i];
  const requiredLevel = levels.findIndex(pattern => pattern.test(requirement));
  const hasLevel = requiredLevel >= 0 && levels.slice(requiredLevel).some(pattern => evidence.some(line => pattern.test(line)));
  return (hasLevel ? 'Degree level supported. Check any field or equivalency requirements. ' : 'Review education requirement against the CV evidence. ')
    + 'Vacancy: ' + requirement + ' CV: ' + evidence.join(' · ');
}

export function matchJob(profile: CandidateProfile, job: JobDetails, interpretation = interpretLocally(job)): JobMatchResult {
  const local = interpretLocally(job);
  const eligibilityStatus = assessEligibility(profile, job, job.description);
  const vacancy = buildVacancyReport(profile, job, eligibilityStatus, interpretation.vacancyItems);
  const skills = new Set(profile.skills.map(normalizeSkill));
  const comparable = vacancy.requirements.filter(item => item.category === 'Technical' && isSkillLabel(item.text));
  const required = comparable.filter(item => item.priority === 'Required');
  const preferred = comparable.filter(item => item.priority === 'Preferred')
    .filter(item => !required.some(requiredItem => requiredItem.id === item.id));
  const hasEvidence = profile.skills.length > 0
    || comparable.some(item => item.status === 'Matched' || item.status === 'Partially Matched');
  const requiredRate = hasEvidence ? coverageRate(scoreableRequirements(required)) : null;
  const preferredRate = hasEvidence ? coverageRate(scoreableRequirements(preferred)) : null;
  const technicalScore = weightedScore([
    { value: requiredRate, weight: scoreWeights.required },
    { value: preferredRate, weight: scoreWeights.preferred },
  ]);
  const requiredMatched = required.filter(item => item.status === 'Matched').map(item => normalizeSkill(item.text));
  const requiredMissing = hasEvidence
    ? required.filter(item => item.status !== 'Matched').map(item => normalizeSkill(item.text)) : [];
  const preferredMatched = preferred.filter(item => item.status === 'Matched').map(item => normalizeSkill(item.text));
  const minimumYears = minimumGeneralExperience(vacancy.requirements);
  const experienceRequirements = vacancy.requirements.filter(item => item.category === 'Experience' && item.priority !== 'Preferred');
  const experience = profile.experienceYears !== null && minimumYears !== null
    ? Math.min(1, profile.experienceYears / minimumYears) : coverageRate(experienceRequirements);
  const qualifications = vacancy.requirements.filter(item => item.category === 'Education'
    && item.priority === 'Required');
  const educationRate = coverageRate(qualifications);
  const overallScore = weightedScore([
    { value: requiredRate, weight: scoreWeights.required },
    { value: preferredRate, weight: scoreWeights.preferred },
    { value: experience, weight: scoreWeights.experience },
    { value: educationRate, weight: scoreWeights.education },
  ]);
  const critical = vacancy.requirements.find(item => item.priority === 'Required'
    && item.category !== 'Responsibilities' && item.status !== 'Matched');
  const educationEvidence = profile.evidence.filter(line => /\b(degree|bachelor|master|phd|diploma|bsc|msc|beng|btech)\b/i.test(line));
  return {
    overallScore, technicalScore, experienceScore: experience === null ? null : Math.round(100 * experience),
    vacancy,
    scoring: {
      required: requiredRate === null ? null : Math.round(100 * requiredRate),
      preferred: preferredRate === null ? null : Math.round(100 * preferredRate),
      experience: experience === null ? null : Math.round(100 * experience),
    },
    eligibilityStatus,
    recommendation: eligibilityStatus === 'NOT_ELIGIBLE' ? 'A stated hiring condition conflicts with your residence or recorded work authorization. The match scores do not affect this restriction.'
      : (eligibilityStatus !== 'ELIGIBLE' ? 'Confirm the hiring conditions above before applying.'
        : overallScore !== null && overallScore >= 70 && (technicalScore === null || technicalScore >= 60) && !critical
          ? 'This vacancy looks worth considering based on the evidence available.'
          : 'Review the qualifications before deciding whether to apply.')
        + (critical ? ' Check your evidence for the outstanding required qualifications.' : overallScore === null ? ' There is too little CV evidence to judge the match.' : ''),
    requiredMatched, requiredMissing, preferredMatched,
    education: educationMatch(interpretation.education, educationEvidence),
    responsibilities: interpretation.responsibilities,
    transferable: interpretation.transferable.filter(item => profile.evidence.some(line => line.includes(item.evidence))),
    evidence: [local.restrictions, interpretation.restrictions === local.restrictions ? '' : interpretation.restrictions,
      interpretation.sponsorship, interpretation.years === null ? '' : 'Job experience requirement: ' + interpretation.years + ' years.',
      profile.experienceYears === null ? '' : 'CV or candidate-reported experience: ' + profile.experienceYears + ' years.',
      ...profile.evidence.filter(line => extractSkills(line).some(skill => requiredMatched.includes(skill))).slice(0, 8),
      !skills.size ? 'CV skill evidence is insufficient.' : '',
    ].filter(Boolean),
    improvements: interpretation.improvements.length ? interpretation.improvements
      : ['Where accurate, make relevant skills easier to verify by describing where and how you used them.'],
  };
}

