import { z } from 'zod';

const percent = z.number().int().min(0).max(100).nullable();
const skill = z.string().min(1).max(80);
export const reportSchema = z.strictObject({
  overallScore: percent,
  technicalScore: percent,
  experienceScore: percent,
  education: z.string().max(12_000),
  eligibilityStatus: z.enum(['ELIGIBLE', 'POTENTIALLY_ELIGIBLE', 'UNCERTAIN', 'NOT_ELIGIBLE', 'INSUFFICIENT_INFORMATION']),
  recommendation: z.string().max(500),
  requiredMatched: z.array(skill).max(60),
  requiredMissing: z.array(skill).max(60),
  preferredMatched: z.array(skill).max(60),
  responsibilities: z.array(z.string().max(350)).max(12),
  transferable: z.array(z.strictObject({ skill, evidence: z.string().max(300) })).max(12),
  evidence: z.array(z.string().max(1000)).max(16),
  improvements: z.array(z.string().max(300)).max(8),
});
