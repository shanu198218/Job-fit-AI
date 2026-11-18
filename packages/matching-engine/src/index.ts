import type { CandidateProfile, Interpretation, JobDetails, JobMatchResult } from '../../shared-types/src/index.ts';
import { assessEligibility } from '../../eligibility-engine/src/index.ts';
import { buildVacancyReport, isSkillLabel, minimumGeneralExperience } from './vacancy.ts';
import { extractSkills, normalizeSkill } from './skills.ts';

export { extractSkills, normalizeSkill } from './skills.ts';

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
    const experience = text.match(/\b(\d{1,2})(?:\s*[â€“-]\s*\d{1,2})?\s*\+?\s+years?\b/i);
    if (experience && priority !== 'preferred' && /experience|professional/i.test(text)) {
      years = Math.max(years ?? 0, Number(experience[1]));
    }
    if (!education && /\b(degree|bachelor|master|phd|diploma)\b/i.test(text)) education = text.slice(0, 350);
    if (/\b(visa|sponsor(?:ship|ed)?|work authori[sz]ation|right to work|eligible to work|authori[sz]ed to work|based in|reside in|must live in|excluding|cannot hire|not eligible|only candidates|remote.{0,30}only)\b/i.test(text)) quoted.push(text);
    if (!sponsorship && /\b(visa|sponsor(?:ship|ed)?)\b/i.test(text)) sponsorship = text.slice(0, 350);
  }
  return {
    required: [...required], preferred: [...preferred].filter(skill => !required.has(skill)),
    years, education, restrictions: quoted.join('\n').slice(0, 1000), sponsorship,
    responsibilities: duties, transferable: [], improvements: [],
  };
}

function educationMatch(requirement: string, evidence: string[]) {
  if (!requirement) return 'No explicit education requirement found.';
  if (!evidence.length) return 'Education evidence unavailable. Vacancy: ' + requirement;
  const levels = [/\b(diploma|associate)\b/i, /\b(bachelor|bsc|b\.s\.)\b/i, /\b(master|msc|m\.s\.)\b/i, /\b(phd|doctorate)\b/i];
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
  const matched = new Set(vacancy.requirements.filter(item => item.category === 'Technical' && item.status === 'Matched')
    .map(item => normalizeSkill(item.text)));
  const direct = (skill: string) => matched.has(skill) || (!profile.evidence.length && skills.has(skill));
  const comparable = vacancy.requirements.filter(item => item.category === 'Technical' && isSkillLabel(item.text));
  const required = [...new Set(comparable.filter(item => item.priority === 'Required').map(item => normalizeSkill(item.text)))];
  const preferred = [...new Set(comparable.filter(item => item.priority === 'Preferred').map(item => normalizeSkill(item.text)))]
    .filter(skill => !required.includes(skill));
  const requiredMatched = required.filter(direct);
  const requiredMissing = required.filter(skill => !direct(skill));
  const preferredMatched = preferred.filter(direct);
  const hasEvidence = skills.size > 0 || requiredMatched.length + preferredMatched.length > 0;
  const requiredRate = required.length && hasEvidence ? requiredMatched.length / required.length : null;
  const preferredRate = preferred.length && hasEvidence ? preferredMatched.length / preferred.length : null;
  const dimensions: { value: number; weight: number }[] = [];
  if (requiredRate !== null) dimensions.push({ value: requiredRate, weight: 60 });
  if (preferredRate !== null) dimensions.push({ value: preferredRate, weight: 15 });
  const average = () => dimensions.length
    ? Math.round(100 * dimensions.reduce((sum, item) => sum + item.value * item.weight, 0)
      / dimensions.reduce((sum, item) => sum + item.weight, 0)) : null;
  const technicalScore = average();
  const minimumYears = minimumGeneralExperience(vacancy.requirements);
  const experience = profile.experienceYears === null || minimumYears === null ? null
    : minimumYears === 0 ? 1 : Math.min(1, profile.experienceYears / minimumYears);
  if (experience !== null) dimensions.push({ value: experience, weight: 25 });
  const qualifications = vacancy.requirements.filter(item => item.category === 'Education'
    && item.priority === 'Required' && item.status !== 'Unknown');
  if (qualifications.length) dimensions.push({
    value: qualifications.reduce((sum, item) => sum + (item.status === 'Matched' ? 1 : item.status === 'Partially Matched' ? 0.5 : 0), 0)
      / qualifications.length,
    weight: 20,
  });
  const overallScore = average();
  const critical = vacancy.requirements.find(item => item.priority === 'Required'
    && item.category !== 'Responsibilities' && item.status !== 'Matched');
  const educationEvidence = profile.evidence.filter(line => /\b(degree|bachelor|master|phd|diploma|bsc|msc)\b/i.test(line));
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
    requiredMatched, requiredMissing: hasEvidence ? requiredMissing : [], preferredMatched,
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

