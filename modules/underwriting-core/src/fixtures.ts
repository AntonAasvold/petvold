/** Example data for tests and the dev server. Made up (ADR 0009). */
import type { UnderwritingContent } from './index.ts';

/** Made-up Swedish underwriting rules for dogs. Only English labels, since code is in English; an installation writes its own languages. */
export const UNDERWRITING: UnderwritingContent = {
  market: 'SE',
  ageLimits: [{ species: 'dog', minAgeDays: 42, maxAgeYears: 9 }],
  questions: [
    {
      id: 'previous-illness',
      type: 'diagnoses',
      labels: {
        en: 'Has the animal been ill, injured or treated by a vet in the last two years?',
      },
    },
    {
      id: 'ongoing-symptoms',
      type: 'boolean',
      labels: {
        en: 'Does the animal have symptoms right now that a vet has not examined?',
      },
    },
    {
      id: 'lameness',
      type: 'boolean',
      species: ['dog'],
      labels: { en: 'Has the dog ever been lame?' },
    },
  ],
  answerRules: [
    // A heart disease is declined; any other declared illness becomes a rider.
    { question: 'previous-illness', outcome: 'decline', reason: 'heart-disease', onlyFor: ['CAR-MITRAL', 'CAR-DCM'] },
    { question: 'previous-illness', outcome: 'rider', reason: 'previous-illness', riderDescription: 'Declared at application' },
    { question: 'ongoing-symptoms', outcome: 'refer', reason: 'ongoing-symptoms' },
    { question: 'lameness', outcome: 'rider', reason: 'previous-lameness', diagnosisCodes: ['ORT-HALTA-HB-H', 'ORT-HALTA-HB-V'], riderDescription: 'Lameness, hind legs' },
  ],
  breedRules: [{ breed: 'dog-wolfhybrid', outcome: 'decline', reason: 'breed-not-covered' }],
};
