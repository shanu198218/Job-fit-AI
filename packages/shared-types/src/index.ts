import type { VacancyItem, VacancyReport } from './vacancy.ts';

export type EligibilityStatus =
  | 'ELIGIBLE' | 'POTENTIALLY_ELIGIBLE' | 'UNCERTAIN'
  | 'NOT_ELIGIBLE' | 'INSUFFICIENT_INFORMATION';

export interface CandidateProfile {
  country: string;
  authorizedCountries: string[];
  experienceYears: number | null;
  skills: string[];
  evidence: string[];
  experienceSource?: 'CV' | 'Self-reported';
}

export interface JobDetails {
  title: string;
  company: string;
  location: string;
  workMode: string;
  employmentType: string;
  description: string;
  applicationUrl: string;
  sourceLimited?: boolean;
}

export interface Interpretation {
  required: string[];
  preferred: string[];
  years: number | null;
  education: string;
  restrictions: string;
  sponsorship: string;
  responsibilities: string[];
  transferable: { skill: string; evidence: string }[];
  improvements: string[];
  vacancyItems?: VacancyItem[];
}

export interface JobMatchResult {
  overallScore: number | null;
  technicalScore: number | null;
  experienceScore: number | null;
  education: string;
  eligibilityStatus: EligibilityStatus;
  recommendation: string;
  requiredMatched: string[];
  requiredMissing: string[];
  preferredMatched: string[];
  responsibilities: string[];
  transferable: Interpretation['transferable'];
  evidence: string[];
  improvements: string[];
  vacancy: VacancyReport;
  scoring: { required: number | null; preferred: number | null; experience: number | null };
}
