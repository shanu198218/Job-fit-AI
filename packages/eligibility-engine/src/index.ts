import type { CandidateProfile, EligibilityStatus, JobDetails } from '../../shared-types/src/index.ts';

const aliases: Record<string, string> = {
  us: 'united states', 'u.s.': 'united states', usa: 'united states',
  'united states of america': 'united states', uk: 'united kingdom',
  'u.k.': 'united kingdom', 'great britain': 'united kingdom',
};
const knownCountries = new Set([
  ...Object.values(aliases), 'canada', 'australia', 'new zealand', 'sri lanka', 'india',
  'germany', 'france', 'ireland', 'netherlands', 'singapore', 'japan', 'pakistan',
  'brazil', 'mexico', 'spain', 'italy', 'sweden', 'switzerland', 'poland',
]);

function normalize(place: string) {
  const lower = place.toLowerCase().trim().replace(/^the\s+/, '').replace(/[;,]$/, '');
  return aliases[lower] ?? lower;
}

function countries(phrase: string) {
  return phrase.split(/\s+(?:and|or)\s+|,|\//).map(normalize).filter(Boolean);
}

export function assessEligibility(profile: CandidateProfile, job: JobDetails, restrictions: string): EligibilityStatus {
  const country = normalize(profile.country);
  const authorization = profile.authorizedCountries.map(normalize);
  const lines = restrictions.split(/\n|;\s*|(?<=[!?])\s+|\.\s+(?=[A-Z])/).map(line => line.trim().replace(/\.$/, ''));
  let residenceConfirmed = false;
  let authorizationConfirmed = false;
  let unresolved = /\b(?:time\s?zone overlap|overlap with|(?:UTC|GMT|CET|EST|PST) overlap|must work .{0,40}(?:UTC|GMT|CET|EST|PST)|relocation required|must relocate|(?:remote|hiring)\s+(?:within|across)|work from anywhere (?:in|within|across)|remote worldwide.{0,30}(?:subject to|if eligible))\b/i.test(restrictions);
  const noSponsorship = /\b(?:no (?:visa )?sponsorship|(?:visa )?sponsorship (?:is )?not (?:available|provided|offered)|(?:cannot|do not|don't|will not) sponsor)\b/i.test(restrictions);

  for (const line of lines) {
    const allowed = line.match(/(?:must (?:be based|reside|live) in|remote (?:work )?(?:available )?(?:only in|only from)|only candidates (?:based )?in)\s+([^!;]+)/i)?.[1]
      ?? line.match(/^\s*(?:[-*•]\s*)?(?:remote(?: work)?\s*[-–—:(,]?\s*)?([\p{L}. ,/]+?)\s+only\s*\)?$/iu)?.[1];
    if (allowed && !country) unresolved = true;
    if (allowed && country) {
      const places = countries(allowed.replace(/\s*\)$/, ''));
      if (places.includes(country)) residenceConfirmed = true;
      else if (places.length && places.every(place => knownCountries.has(place))) return 'NOT_ELIGIBLE';
      else unresolved = true;
    }

    const excluded = line.match(/(?:excluding(?: candidates (?:in|from))?|cannot (?:hire|accept applicants) (?:in|from)|not eligible (?:in|from))\s+([^!;]+)/i)?.[1];
    if (excluded && country && countries(excluded).includes(country)) return 'NOT_ELIGIBLE';
    if (excluded && !country) unresolved = true;
    const denied = line.match(/\b(?:applicants?|candidates?) (?:based )?(?:from|in) (.+?) (?:are )?(?:not eligible|not accepted|excluded)\b/i)?.[1];
    if (denied && country && countries(denied).includes(country)) return 'NOT_ELIGIBLE';
    const welcomed = line.match(/\b(?:applicants?|candidates?) (?:based )?(?:from|in) (.+?) (?:are )?(?:welcome|accepted|eligible)\b/i)?.[1];
    if (welcomed && countries(welcomed).includes(country)) residenceConfirmed = true;

    const rightToWork = line.match(/(?:authori[sz]ed|eligible|right) to work in\s+([^!;]+)/i)?.[1];
    if (rightToWork) {
      const places = countries(rightToWork.split(/\s+(?:without|with|before|at the time of)\s+/i)[0] ?? rightToWork);
      if (places.some(place => authorization.includes(place))) authorizationConfirmed = true;
      else if (authorization.length && places.every(place => knownCountries.has(place)) && (noSponsorship || /without sponsorship/i.test(line))) return 'NOT_ELIGIBLE';
      else unresolved = true;
    } else if (/\b(?:work authori[sz]ation|work permit|right to work)\b/i.test(line)) {
      unresolved = true;
    }
  }

  const worldwide = /\b(?:remote worldwide|worldwide remote|work from anywhere)\b/i.test(job.description)
    && !/\b(?:except|excluding|limitations?|restrictions?|not (?:fully )?remote|(?:cannot|can't|not) work from anywhere)\b/i.test(job.description);
  const incomplete = job.sourceLimited || /\b(?:show|read|see) more\b|(?:…|\.{3})\s*$/i.test(job.description);
  const onsite = /\b(?:on[- ]?site|hybrid)\b/i.test(job.workMode + '\n' + job.description);
  if (country && !unresolved && !onsite && !incomplete && (worldwide || residenceConfirmed)) return 'ELIGIBLE';
  if (unresolved) return 'UNCERTAIN';
  if (residenceConfirmed || authorizationConfirmed) return 'POTENTIALLY_ELIGIBLE';
  if (!country || (!job.location && !restrictions.trim())) return 'INSUFFICIENT_INFORMATION';
  return 'UNCERTAIN';
}
