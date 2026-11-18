import { z } from 'zod';

export const requirementCategories = ['Technical', 'Experience', 'Education', 'Responsibilities', 'Soft skills', 'Languages', 'Candidate conditions'] as const;
export const informationCategories = ['Employment type', 'Contract duration', 'Work arrangement', 'Location', 'Working hours', 'Timezone', 'Compensation', 'Currency', 'Payment period', 'Bonuses', 'Allowances', 'Benefits', 'Geography', 'Work authorization', 'Sponsorship', 'Relocation', 'Deadline', 'Documents', 'Application instructions', 'Other conditions'] as const;
export const matchStatuses = ['Matched', 'Partially Matched', 'Not Evidenced', 'Unknown'] as const;
export const vacancyItemSchema = z.strictObject({
  category: z.enum([...requirementCategories, ...informationCategories]),
  text: z.string().trim().min(1).max(30_000),
  evidence: z.string().trim().min(1).max(30_000),
  priority: z.enum(['Required', 'Preferred', 'Unspecified']),
});
export const requirementSchema = vacancyItemSchema.extend({
  category: z.enum(requirementCategories),
  id: z.string(),
  status: z.enum(matchStatuses),
  candidateEvidence: z.array(z.string()),
  explanation: z.string(),
  gap: z.string(),
  basis: z.enum(['Explicit', 'Inference', 'Self-reported', 'None']),
});
export const vacancyReportSchema = z.strictObject({
  requirements: z.array(requirementSchema),
  information: z.array(vacancyItemSchema.omit({ priority: true }).extend({ category: z.enum(informationCategories) })),
  warnings: z.array(z.string()),
  eligibility: z.strictObject({
    status: z.enum(['Eligible', 'Not Eligible', 'Needs Verification']),
    explanation: z.string(),
    questions: z.array(z.string()),
  }),
});
export type VacancyItem = z.infer<typeof vacancyItemSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type VacancyReport = z.infer<typeof vacancyReportSchema>;
