import type { JobDetails } from '@jobfit/shared-types';

export function manualJob(description: string): JobDetails {
  const trimmed = description.trim();
  if (!trimmed || trimmed.length > 30_000) throw new Error('Enter a job description of up to 30,000 characters.');
  const field = (label: string) => trimmed.match(new RegExp('^(?:' + label + ')\\s*:\\s*([^\\r\\n]+)', 'im'))?.[1]?.trim().slice(0, 300) ?? '';
  return { description: trimmed, title: field('job title|title'), company: field('company'), location: field('job location|location'),
    workMode: field('work arrangement|work mode'), employmentType: field('employment type'),
    applicationUrl: (trimmed.match(/^(?:source|job posting|posting url|job url|application url)\s*:\s*(https?:\/\/[^\s<>]+)/im)?.[1] ?? '').slice(0, 2200) };
}

// Chrome serializes this function and runs it in the active tab.
export function readJob(): JobDetails {
  const asRecord = (input: unknown): Record<string, unknown> => input && typeof input === 'object'
    ? input as Record<string, unknown> : {};
  const str = (input: unknown, limit = 300) => typeof input === 'string' ? input.trim().slice(0, limit) : '';
  function find(input: unknown, depth = 0): Record<string, unknown> | undefined {
    if (depth > 8) return undefined;
    if (Array.isArray(input)) {
      for (const item of input.slice(0, 100)) {
        const match = find(item, depth + 1);
        if (match) return match;
      }
      return undefined;
    }
    const object = asRecord(input);
    if ([object['@type']].flat().some(type => typeof type === 'string' && /(?:^|\/)JobPosting$/.test(type))) return object;
    return findGraph(object, depth);
  }
  function findGraph(object: Record<string, unknown>, depth: number) {
    return object['@graph'] ? find(object['@graph'], depth + 1) : undefined;
  }
  let structured: Record<string, unknown> = {};
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 30)) {
    const source = script.textContent ?? '';
    if (source.length > 300_000) continue;
    try {
      const match = find(JSON.parse(source));
      if (match) { structured = match; break; }
    } catch { /* Other metadata can still be read. */ }
  }
  const root = document.querySelector('[itemprop="description"], #job-description, .job-description, [data-testid="job-description"]')
    ?? document.querySelector('main article, article, main');
  const html = str(structured.description, 60_000);
  const plain = (value: string) => {
    const inert = document.createElement('template');
    inert.innerHTML = value;
    inert.content.querySelectorAll('script, style').forEach(element => element.remove());
    inert.content.querySelectorAll('p, li, br, div, h1, h2, h3, h4').forEach(element => element.append('\n'));
    return inert.content.textContent?.trim() ?? '';
  };
  const description = plain(html) || (root instanceof HTMLElement ? root.innerText : document.body?.innerText) || '';
  const locations = [structured.jobLocation].flat().slice(0, 12).map(item => {
    const address = asRecord(asRecord(item).address);
    return [address.addressLocality, address.addressRegion, address.addressCountry].map(value => str(value) || str(asRecord(value).name)).filter(Boolean).join(', ');
  }).filter(Boolean);
  const area = [structured.applicantLocationRequirements].flat().map(item => str(asRecord(item).name)).filter(Boolean);
  const remote = structured.jobLocationType === 'TELECOMMUTE';
  const salary = asRecord(structured.baseSalary);
  const salaryValue = asRecord(salary.value);
  const numeric = (value: unknown) => typeof value === 'number' ? String(value) : str(value);
  const amount = numeric(salaryValue.value) || [numeric(salaryValue.minValue), numeric(salaryValue.maxValue)].filter(Boolean).join(' – ')
    || numeric(salary.value);
  const details = [
    description,
    str(structured.qualifications, 3000) && 'Requirements\n' + plain(str(structured.qualifications, 3000)),
    str(structured.responsibilities, 3000) && 'Responsibilities\n' + plain(str(structured.responsibilities, 3000)),
    str(structured.educationRequirements, 500) && 'Education: ' + plain(str(structured.educationRequirements, 500)),
    area.length && (remote ? 'Remote only in ' : 'Only candidates in ') + area.join(', ') + '.',
    amount && 'Salary: ' + [str(salary.currency), amount, str(salaryValue.unitText)].filter(Boolean).join(' '),
    str(structured.validThrough) && 'Application deadline: ' + str(structured.validThrough),
    str(structured.jobBenefits, 3000) && 'Benefits\n' + plain(str(structured.jobBenefits, 3000)),
    str(structured.workHours) && 'Working hours: ' + str(structured.workHours),
  ].filter(Boolean);
  const combined = details.join('\n\n');
  return {
    title: str(structured.title) || str(document.querySelector('h1')?.textContent) || str(document.title),
    company: str(asRecord(structured.hiringOrganization).name) || str(document.querySelector('[itemprop="hiringOrganization"], .company-name')?.textContent),
    location: (locations.join(' / ') || area.join(', ') || str(document.querySelector('[itemprop="jobLocation"], .job-location')?.textContent)).slice(0, 300),
    workMode: remote ? 'Remote' : '',
    employmentType: str([structured.employmentType].flat().filter(item => typeof item === 'string').join(', ')),
    description: combined.slice(0, 30_000),
    sourceLimited: combined.length > 30_000 || (!html && !root)
      || [structured.qualifications, structured.responsibilities, structured.jobBenefits].some(value => typeof value === 'string' && value.length > 3000)
      || typeof structured.educationRequirements === 'string' && structured.educationRequirements.length > 500,
    applicationUrl: location.origin + location.pathname.slice(0, 1800),
  };
}
