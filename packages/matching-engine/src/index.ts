import type { CandidateProfile, Interpretation, JobDetails, JobMatchResult } from '../../shared-types/src/index.ts';
import { assessEligibility } from '../../eligibility-engine/src/index.ts';

const aliases: Record<string, string[]> = {
  JavaScript: ['javascript', 'js', 'ecmascript'],
  TypeScript: ['typescript', 'ts'],
  React: ['react', 'react.js', 'reactjs'],
  'Node.js': ['node.js', 'nodejs', 'node js'],
  'Next.js': ['next.js', 'nextjs'],
  PostgreSQL: ['postgresql', 'postgres'],
  Python: ['python'], Java: ['java'], SQL: ['sql'], 'C++': ['c++'], 'C#': ['c#'],
  '.NET': ['.net', 'dotnet'], AWS: ['aws', 'amazon web services'],
  Azure: ['azure'], Git: ['git'], Docker: ['docker'], Kubernetes: ['kubernetes', 'k8s'],
  HTML: ['html'], CSS: ['css'], Tailwind: ['tailwind', 'tailwind css'],
  Go: ['golang', 'go language'], Rust: ['rust'], Vue: ['vue', 'vue.js'],
  Angular: ['angular'], PHP: ['php'], Ruby: ['ruby'], MongoDB: ['mongodb'],
  Linux: ['linux'], Terraform: ['terraform'], Figma: ['figma'], GraphQL: ['graphql'],
};

export function normalizeSkill(skill: string) {
  const lower = skill.trim().toLowerCase();
  return Object.entries(aliases).find(([, names]) => names.includes(lower))?.[0] ?? lower;
}

export function extractSkills(text: string) {
  return Object.entries(aliases).filter(([, names]) => names.some(name => {
    const escaped = name.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^\\w])' + escaped + '(?![\\w])', 'i').test(text);
  })).map(([skill]) => skill);
}

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
  const skills = new Set(profile.skills.map(normalizeSkill));
  const required = [...new Set(interpretation.required.map(normalizeSkill))];
  const preferred = [...new Set(interpretation.preferred.map(normalizeSkill))].filter(skill => !required.includes(skill));
  const requiredMatched = required.filter(skill => skills.has(skill));
  const requiredMissing = required.filter(skill => !skills.has(skill));
  const preferredMatched = preferred.filter(skill => skills.has(skill));
  const dimensions: { value: number; weight: number }[] = [];
  if (required.length && skills.size) dimensions.push({ value: requiredMatched.length / required.length, weight: 60 });
  if (preferred.length && skills.size) dimensions.push({ value: preferredMatched.length / preferred.length, weight: 15 });
  const average = () => dimensions.length
    ? Math.round(100 * dimensions.reduce((sum, item) => sum + item.value * item.weight, 0)
      / dimensions.reduce((sum, item) => sum + item.weight, 0)) : null;
  const technicalScore = average();
  const experience = profile.experienceYears === null || interpretation.years === null ? null
    : interpretation.years === 0 ? 1 : Math.min(1, profile.experienceYears / interpretation.years);
  if (experience !== null) dimensions.push({ value: experience, weight: 25 });
  const eligibilityStatus = assessEligibility(profile, job, local.restrictions);
  const educationEvidence = profile.evidence.filter(line => /\b(degree|bachelor|master|phd|diploma|bsc|msc)\b/i.test(line));
  return {
    overallScore: average(), technicalScore, experienceScore: experience === null ? null : Math.round(100 * experience),
    eligibilityStatus,
    recommendation: eligibilityStatus === 'NOT_ELIGIBLE' ? 'The vacancy explicitly restricts your location.'
      : 'Review the cited requirements and confirm any unresolved work authorization or location conditions.',
    requiredMatched, requiredMissing: skills.size ? requiredMissing : [], preferredMatched,
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

