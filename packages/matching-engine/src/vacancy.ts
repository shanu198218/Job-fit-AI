import type { CandidateProfile, EligibilityStatus, JobDetails } from '../../shared-types/src/index.ts';
import { informationCategories, matchStatuses, type Requirement, type VacancyItem, type VacancyReport } from '../../shared-types/src/vacancy.ts';
import { extractSkills, normalizeSkill } from './skills.ts';

type Category = VacancyItem['category'];
const classified: [Category, RegExp][] = [
  ['Sponsorship', /\b(?:visa|sponsorship|sponsor(?:ed|ing)?)\b/i],
  ['Work authorization', /\b(?:work authori[sz]ation|(?:authori[sz]ed|right|eligible|permit) to work|work permit)\b/i],
  ['Relocation', /\brelocat\w*\b/i],
  ['Geography', /^remote(?: work)?\s*[-–—:(,]?\s*[\p{L}. ,/]+?\s+only\s*\)?\.?$/iu],
  ['Geography', /\b(?:worldwide|work from anywhere|excluding|cannot hire|not eligible|only (?:in|from|candidates)|(?:applicants?|candidates?) (?:based )?(?:from|in)|(?:must |currently )(?:be based|reside|live)|(?:remote|hiring) (?:within|across))\b/i],
  ['Deadline', /\b(?:deadline|apply by|valid through|closing date|applications? close)\b/i],
  ['Documents', /\b(?:cover letter|resume|résumé|CV|references|portfolio)\b/i],
  ['Application instructions', /\b(?:apply (?:at|via|online|through|using)|submit your|send your)\b/i],
  ['Compensation', /\b(?:salary|compensation|pay range)\b|[$€£]\s*\d/i],
  ['Currency', /\b(?:USD|GBP|EUR|LKR|CAD|AUD|SGD|INR|JPY|CHF)\b|[€£]\s*\d/i],
  ['Payment period', /\b(?:per (?:year|month|week|hour)|annually|paid (?:monthly|weekly|hourly)|yearly salary|monthly salary|hourly rate|salary.{0,50}\b(?:YEAR|MONTH|HOUR)$)\b/i],
  ['Bonuses', /\b(?:signing bonus|performance bonus|annual bonus|bonuses|bonus (?:pay|scheme|of))\b/i],
  ['Allowances', /\ballowances?\b/i],
  ['Benefits', /\b(?:benefits?|insurance|paid leave|paid time off|pension|equity)\b/i],
  ['Contract duration', /\b(?:contract duration|\d+[- ](?:month|year)s? (?:fixed.term )?contract)\b/i],
  ['Employment type', /^(?:(?:employment type|job type)\s*:|(?:contract|temporary)\s*[.!]?$)|\b(?:full[- ]time|part[- ]time|permanent|fixed[- ]term|freelance|internship|temporary (?:role|position)|contract (?:role|position)|\d+[- ](?:month|year)s? contract)\b/i],
  ['Timezone', /\b(?:time\s?zones?|UTC|GMT|CEST?|[EP]DT|[EP]ST|IST|EMEA hours)\b|\b(?:Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+\b/i],
  ['Working hours', /\b(?:working hours|office hours|hours per week|(?:day|night|rotating) shifts?|weekends?)\b|\b\d{1,2}(?::\d\d)?\s*(?:am|pm)?\s*(?:[-–—]|to)\s*\d{1,2}(?::\d\d|\s*(?:am|pm))\b/i],
  ['Candidate conditions', /\b(?:travel|background check|security clearance|driving licen[sc]e)\b/i],
  ['Work arrangement', /^(?:work arrangement|work mode|remote|hybrid|on[- ]?site)\b|\b(?:fully remote|(?:remote|hybrid|on[- ]?site) (?:position|role|schedule|attendance|work(?:ing)?)|work from anywhere)\b/i],
  ['Location', /^(?:job )?location\s*:/i],
  ['Education', /\b(?:degree|bachelor|master[’']?s|phd|doctorate|diploma|certifi\w+|professional qualification)\b/i],
  ['Languages', /\b(?:english|fluency in|fluent in|language requirement)\b/i],
  ['Soft skills', /\b(?:communication|teamwork|problem.solving|leadership|interpersonal|attention to detail)\b/i],
  ['Experience', /\b(?:seniority|years? (?:of )?(?:\w+ ){0,5}experience|professional experience|industry experience|leadership experience)\b/i],
  ['Responsibilities', /^(?:build|design|develop|deliver|own|maintain|collaborate|support|lead|implement|manage|monitor|review|mentor|ensure)\b/i],
];
const headings: [RegExp, Category, VacancyItem['priority']][] = [
  [/^(?:preferred(?: qualifications| skills| requirements)?|nice.to.have|desirable(?: skills)?)$/i, 'Technical', 'Preferred'],
  [/^(?:requirements|required(?: skills| qualifications)?|minimum qualifications|qualifications|must.have|technical skills|what you bring)$/i, 'Technical', 'Required'],
  [/^(?:responsibilities|what you.ll do|duties)$/i, 'Responsibilities', 'Unspecified'],
  [/^(?:benefits|what we offer)$/i, 'Benefits', 'Unspecified'],
  [/^(?:salary|compensation)$/i, 'Compensation', 'Unspecified'],
  [/^(?:how to apply|application details)$/i, 'Application instructions', 'Unspecified'],
  [/^(?:education|certifications)$/i, 'Education', 'Unspecified'],
  [/^(?:experience|seniority)$/i, 'Experience', 'Unspecified'],
  [/^(?:soft skills|competencies)$/i, 'Soft skills', 'Unspecified'],
  [/^(?:languages|language requirements)$/i, 'Languages', 'Unspecified'],
  [/^(?:about us|about the company|company overview)$/i, 'Other conditions', 'Unspecified'],
];
const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
const key = (value: string) => normalized(value).toLowerCase().replace(/[.!]+$/, '');
const mandatory = /\b(?:required|must|minimum|essential|mandatory)\b/i;
const preferred = /\b(?:preferred|nice.to.have|desirable|a plus|advantageous|bonus points)\b/i;
const years = /\b(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s*\+?\s*years?\b/i;
const genericExperience = /^(?:(?:minimum(?: of)?|at least|required|preferred)[: ]+)?\d{1,2}(?:\s*[-–—]\s*\d{1,2})?\s*\+?\s*years?\s+(?:of\s+)?(?:(?:relevant|professional|commercial|work)\s+){0,2}experience(?:\s+required)?[.!]?$/i;
export const isSkillLabel = (text: string) => text.length <= 80 && /^[\p{L}\p{N}.+#/-]+(?: [\p{L}\p{N}.+#/-]+){0,2}$/u.test(text)
  && !/\b(?:or|with|without|either|and|no|not|of|required|preferred|experience|familiarity|minimum|knowledge)\b/i.test(text);

function containsTerm(source: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\p{L}\\p{N}_])' + escaped + '(?![\\p{L}\\p{N}_+#])', 'iu').test(source);
}

export function extractVacancy(job: JobDetails) {
  const items: VacancyItem[] = [];
  let section: Category | undefined;
  let sectionPriority: VacancyItem['priority'] = 'Unspecified';
  for (const line of job.description.split(/\r?\n/)) {
    const source = line.trim().replace(/^(?:[-*•▪]\s*|\d+[.)]\s+)/u, '');
    if (!source || /^(?:show|read|see) more[.…\s]*$/i.test(source)) continue;
    const colon = source.indexOf(':');
    const heading = headings.find(([pattern]) => pattern.test((colon < 0 ? source : source.slice(0, colon)).trim()));
    if (heading) [, section, sectionPriority] = heading;
    if (heading && (colon < 0 || !source.slice(colon + 1).trim())) continue;
    const body = heading ? source.slice(colon + 1).trim() : source;
    for (const text of body.split(/;\s+|(?<=[!?])\s+|(?<=\w{2,}\.)\s+(?=[A-Z])/).map(value => value.trim()).filter(Boolean)) {
      const categories = [...new Set(classified.filter(([, pattern]) => pattern.test(text)).map(([category]) => category))];
      const conditions = [...new Set([...(heading && section ? [section] : []), ...categories])]
        .filter(category => (informationCategories as readonly string[]).includes(category));
      if (section === 'Other conditions' && !conditions.some(category => category !== 'Other conditions')) continue;
      const priority = preferred.test(text) ? 'Preferred' : mandatory.test(text) ? 'Required' : sectionPriority;
      if (conditions.length) {
        for (const category of conditions) items.push({ category, text, evidence: source, priority });
        if (!categories.includes('Candidate conditions')) continue;
      }
      if (/^(?:job title|title|company)\s*:/i.test(text)) continue;
      const category = categories.includes('Candidate conditions') ? 'Candidate conditions'
        : section === 'Responsibilities' ? section
          : categories[0] ?? section ?? (extractSkills(text).length || priority !== 'Unspecified' ? 'Technical' : undefined);
      if (!category) continue;
      const technical = category === 'Technical'
        && !/\b(?:or|either|equivalent|without|no|not)\b/i.test(text)
        && text.replace(/[.!]$/, '').replace(/^(?:experience (?:with|in)|proficiency in|knowledge of|required:)\s+/i, '').replace(/\s+(?:required|preferred)$/i, '');
      const parts = technical ? technical.split(/\s*,\s*|\s+and\s+/i) : [];
      const labels = parts.length && parts.every(isSkillLabel) ? parts : [text];
      for (const label of labels) items.push({ category, text: label, evidence: source, priority });
    }
  }
  return items;
}

function compare(item: VacancyItem, profile: CandidateProfile): Omit<Requirement, keyof VacancyItem | 'id'> {
  const minimum = item.category === 'Experience' && genericExperience.test(item.text) ? item.text.match(years) : null;
  if (minimum && profile.experienceYears !== null) {
    const enough = profile.experienceYears >= Number(minimum[1]);
    const recorded = profile.evidence.filter(line => genericExperience.test(line) && Number(line.match(years)?.[1]) === profile.experienceYears);
    const basis = profile.experienceSource === 'Self-reported' || !recorded.length ? 'Self-reported' : 'Explicit';
    return { status: enough ? 'Matched' : 'Partially Matched', basis,
      candidateEvidence: basis === 'Explicit' ? recorded : [profile.experienceYears + ' years of experience'],
      explanation: enough ? 'The recorded years meet the stated threshold.' : 'The recorded years are below the stated threshold.',
      gap: enough ? '' : 'Confirm additional relevant experience, if applicable.' };
  }
  const negative = /\b(?:no|not|never|lack(?:ing)?|learning|interested in|unfamiliar|aspiring)\b/i;
  const eligibleEvidence = profile.evidence.filter(line => !negative.test(line));
  const exact = eligibleEvidence.filter(line => containsTerm(line, item.text.replace(/[.!]$/, '')));
  const skills = item.category === 'Technical' ? extractSkills(item.text) : [];
  const alias = skills.length === 1 && normalizeSkill(item.text) === skills[0] ? skills[0] : undefined;
  const direct = alias ? eligibleEvidence.filter(line => extractSkills(line).includes(alias)) : exact;
  if (direct.length && !negative.test(item.text)) {
    return { status: 'Matched', candidateEvidence: direct, basis: 'Explicit',
      explanation: 'The CV explicitly mentions this requirement.', gap: '' };
  }
  const related = eligibleEvidence.filter(line => skills.some(skill => extractSkills(line).includes(skill))
    || (item.category === 'Education' && /\b(?:degree|bachelor|master|diploma|certified|phd)\b/i.test(line))
    || (item.category === 'Technical' && /^(?:docker|podman)$/i.test(item.text)
      && /\b(?:docker|podman|(?:built|published) container images)\b/i.test(line)));
  if (related.length && !negative.test(item.text)) {
    return { status: 'Partially Matched', candidateEvidence: related, basis: 'Inference',
      explanation: 'The CV contains related evidence. It does not establish the full requirement.',
      gap: 'Verify the scope, level, or specific qualification in the vacancy.' };
  }
  const unknown = !profile.evidence.length || item.category === 'Candidate conditions'
    || item.category === 'Experience' || /\b(?:or|equivalent|as applicable|if needed)\b/i.test(item.text);
  return { basis: 'None', candidateEvidence: [], status: unknown ? 'Unknown' : 'Not Evidenced',
    explanation: unknown ? 'The available details do not establish this condition.' : 'No direct supporting evidence was found in the extracted CV.',
    gap: 'Confirm this requirement and add evidence where accurate.' };
}

export function buildVacancyReport(profile: CandidateProfile, job: JobDetails, eligibility: EligibilityStatus, aiItems?: VacancyItem[]): VacancyReport {
  const source = normalized(job.description);
  const grounded = (aiItems ?? []).filter(item => source.includes(normalized(item.evidence))
    && containsTerm(normalized(item.evidence), normalized(item.text))
    && (!/\b(?:or|without|not|except|unless)\b/i.test(item.evidence) || normalized(item.text) === normalized(item.evidence)));
  const items = new Map<string, VacancyItem>();
  for (const item of [...extractVacancy(job), ...grounded]) {
    const label = item.category === 'Technical' ? normalizeSkill(item.text) : item.text;
    const id = item.category + ':' + key(label);
    const previous = items.get(id);
    if (!previous || previous.priority === 'Unspecified' && item.priority !== 'Unspecified'
      || previous.priority === 'Preferred' && item.priority === 'Required') items.set(id, item);
  }
  const requirements: Requirement[] = [];
  const information: VacancyReport['information'] = [];
  for (const [id, item] of items) {
    if ((informationCategories as readonly string[]).includes(item.category)) {
      information.push({ category: item.category, text: item.text, evidence: item.evidence } as VacancyReport['information'][number]);
    } else {
      requirements.push({ ...item, category: item.category as Requirement['category'], id, ...compare(item, profile) });
    }
  }
  const status = eligibility === 'ELIGIBLE' ? 'Eligible' : eligibility === 'NOT_ELIGIBLE' ? 'Not Eligible' : 'Needs Verification';
  const questions: string[] = [];
  if (status === 'Needs Verification') {
    questions.push('Can the employer hire someone residing in ' + (profile.country || 'Sri Lanka') + ' for this role?');
    if (!profile.authorizedCountries.length || information.some(item => item.category === 'Work authorization' || item.category === 'Sponsorship')) {
      questions.push('What work authorization or visa sponsorship applies at the start date?');
    }
    if (information.some(item => item.category === 'Timezone' || item.category === 'Relocation' || item.category === 'Work arrangement')) {
      questions.push('Which working hours, onsite attendance or relocation conditions apply?');
    }
  }
  return {
    requirements, information,
    warnings: [
      job.sourceLimited || job.description.length >= 30_000 || job.description.length < 80 || /\b(?:show more|read more|see more)\b|(?:…|\.{3})\s*$/i.test(job.description)
        ? 'The supplied vacancy may be incomplete or truncated. Review the full posting.' : '',
      aiItems === undefined ? 'Local extraction uses wording and section patterns. Review the posting for missed or ambiguous requirements.'
        : 'Gemini suggestions are checked against vacancy quotes. Category, priority and extraction coverage may still need review.',
      grounded.length !== (aiItems?.length ?? 0) ? 'Some Gemini items were omitted because their wording could not be verified.' : '',
    ].filter(Boolean),
    eligibility: { status, questions, explanation: status === 'Eligible'
      ? 'The vacancy explicitly supports your recorded location and the applicable conditions identified.'
      : status === 'Not Eligible' ? 'An explicit hiring restriction conflicts with your recorded circumstances.'
        : 'The vacancy or CV profile leaves one or more hiring conditions unresolved.' },
  };
}

export function countCoverage(requirements: Requirement[]) {
  const counts = Object.fromEntries(matchStatuses.map(status => [status, 0])) as Record<Requirement['status'], number>;
  for (const requirement of requirements) counts[requirement.status]++;
  return counts;
}

export function minimumGeneralExperience(items: Requirement[]) {
  const values = items.filter(item => item.category === 'Experience' && item.priority !== 'Preferred' && genericExperience.test(item.text))
    .map(item => Number(item.text.match(years)?.[1]));
  return values.length ? Math.max(...values) : null;
}
