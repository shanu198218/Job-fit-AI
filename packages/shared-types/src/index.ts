
export type EligibilityStatus =
  | "ELIGIBLE"
  | "POTENTIALLY_ELIGIBLE"
  | "UNCERTAIN"
  | "NOT_ELIGIBLE"
  | "INSUFFICIENT_INFORMATION";

export type MatchLevel =
  | "STRONG"
  | "GOOD"
  | "PARTIAL"
  | "GAP"
  | "UNKNOWN";

export interface CandidateProfile {
  id: string;
  fullName: string;
  country: string;
  experienceYears: number;
  skills: string[];
}

export interface JobDetails {
  id?: string;
  title: string;
  company: string;
  location: string;
  description: string;
  applicationUrl: string;
}

export interface JobMatchResult {
  overallScore: number;
  technicalScore: number;
  experienceScore: number;
  eligibilityStatus: EligibilityStatus;
  recommendation: string;
}
