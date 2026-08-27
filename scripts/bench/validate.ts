#!/usr/bin/env tsx
import { FULL_CORPUS, SPIKE_CORPUS } from './corpus.js';
import { preflightCorpus } from './preflight.js';

const stage = process.argv[2] ?? 'full';
if (stage !== 'spike' && stage !== 'full') {
  throw new Error(`Usage: tsx validate.ts <spike|full>. Got: ${stage}`);
}

preflightCorpus(stage === 'spike' ? SPIKE_CORPUS : FULL_CORPUS);
