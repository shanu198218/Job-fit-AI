import { z } from 'zod';

const short = z.string().max(300);
const skills = z.array(z.string().trim().min(1).max(80)).max(60);
export const keyInput = z.strictObject({
  key: z.string().trim().min(15).max(200).regex(/^(?:AQ\.)?[A-Za-z0-9_-]+$/),
});
export const coverLetterInput = z.strictObject({
  consent: z.literal(true),
  title: short,
  company: short,
  requirements: z.array(z.string().trim().min(1).max(500)).max(24),
  evidence: z.array(short.trim().min(1)).max(16),
});
export const analyzeInput = z.strictObject({
  consent: z.literal(true),
  profile: z.strictObject({
    country: short, authorizedCountries: z.array(short).max(10),
    experienceYears: z.number().min(0).max(99).nullable(), skills,
    evidence: z.array(short).max(32),
    experienceSource: z.enum(['CV', 'Self-reported']).optional(),
  }),
  job: z.strictObject({
    title: short, company: short, location: short, workMode: short, employmentType: short,
    description: z.string().trim().min(1).max(30_000), applicationUrl: z.string().max(2200),
    sourceLimited: z.boolean().optional(),
  }),
});

export const interpretationSchema = z.strictObject({
  required: skills, preferred: skills, years: z.number().min(0).max(99).nullable(),
  education: z.string().max(350), restrictions: z.string().max(1000), sponsorship: z.string().max(350),
  responsibilities: z.array(z.string().max(350)).max(12),
  transferable: z.array(z.strictObject({ skill: z.string().min(1).max(80), evidence: short })).max(12),
  improvements: z.array(short).max(8),
});
