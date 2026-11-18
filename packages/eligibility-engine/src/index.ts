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
  const lines = restrictions.split(/\n|(?<=[!?])\s+|\.\s+(?=[A-Z])/).map(line => line.trim().replace(/\.$/, ''));
  let residenceConfirmed = false;
  let authorizationConfirmed = false;
  let unresolved = false;

  for (const line of lines) {
    const allowed = line.match(/(?:must (?:be based|reside|live) in|remote (?:work )?(?:available )?(?:only in|only from)|only candidates (?:based )?in)\s+([^!;]+)/i)?.[1];
    if (allowed && !country) unresolved = true;
    if (allowed && country) {
      const places = countries(allowed);
      if (places.includes(country)) residenceConfirmed = true;
      else if (places.length && places.every(place => knownCountries.has(place))) return 'NOT_ELIGIBLE';
    }

    const excluded = line.match(/(?:excluding(?: candidates in)?|cannot hire (?:in|from)|not eligible (?:in|from))\s+([^!;]+)/i)?.[1];
    if (excluded && country && countries(excluded).includes(country)) return 'NOT_ELIGIBLE';

    const rightToWork = line.match(/(?:authori[sz]ed|eligible|right) to work in\s+([^!;]+)/i)?.[1];
    if (rightToWork) {
      const places = countries(rightToWork.split(/\s+(?:without|with|before|at the time of)\s+/i)[0] ?? rightToWork);
      if (places.some(place => authorization.includes(place))) authorizationConfirmed = true;
      else unresolved = true;
    }
  }

  const worldwide = /^(?:remote worldwide|worldwide remote|work from anywhere)[.! ]*$/im.test(job.description);
  if (country && worldwide && !restrictions.trim()) return 'ELIGIBLE';
  if (unresolved) return 'UNCERTAIN';
  if (residenceConfirmed || authorizationConfirmed) return 'POTENTIALLY_ELIGIBLE';
  if (!country || (!job.location && !restrictions.trim())) return 'INSUFFICIENT_INFORMATION';
  return 'UNCERTAIN';
}
