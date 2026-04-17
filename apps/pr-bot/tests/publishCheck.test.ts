import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishCheck } from '../src/checks/publishCheck.js';
import type { ReviewPayload } from '../src/review/types.js';
import { DEFAULT_CONFIG } from '../src/config.js';

function makePayload(riskScore: number, threshold = 0.7): ReviewPayload {
  return {
    pr: {
      owner: 'acme',
      repo: 'api',
      number: 42,
      headSha: 'abc123',
      baseSha: 'base000',
    },
    riskScore,
    riskLabel: riskScore >= 0.7 ? 'high' : riskScore >= 0.4 ? 'medium' : 'low',
    changedFiles: [
      {
        file: 'src/auth.ts',
        riskLevel: riskScore >= 0.7 ? 'high' : 'low',
        importerCount: 5,
        isHub: false,
        hasTestCoverage: false,
        risk: null,
      },
      {
        file: 'src/utils.ts',
        riskLevel: 'low',
        importerCount: 2,
        isHub: false,
        hasTestCoverage: true,
        risk: null,
      },
      {
        file: 'src/models.ts',
        riskLevel: 'medium',
        importerCount: 3,
        isHub: false,
        hasTestCoverage: false,
        risk: null,
      },
    ],
    impact: {
      seedFiles: ['src/auth.ts'],
      directImporters: [],
      transitiveImporters: [],
      historicalCoupling: [],
      totalImpacted: 0,
    },
    suggestedReviewers: [],
    config: { ...DEFAULT_CONFIG, risk_threshold: threshold },
  };
}

function makeOctokit(createCheckRunMock: ReturnType<typeof vi.fn>) {
  return {
    checks: {
      create: createCheckRunMock,
    },
  } as unknown as Parameters<typeof publishCheck>[0];
}

describe('publishCheck', () => {
  let createCheckRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createCheckRun = vi.fn().mockResolvedValue({ data: { id: 1 } });
  });

  it('conclusion is "success" when riskScore < risk_threshold', async () => {
    const payload = makePayload(0.3, 0.7);
    const octokit = makeOctokit(createCheckRun);

    await publishCheck(octokit, { owner: 'acme', name: 'api' }, payload);

    expect(createCheckRun).toHaveBeenCalledOnce();
    const call = createCheckRun.mock.calls[0][0];
    expect(call.conclusion).toBe('success');
  });

  it('conclusion is "failure" when riskScore >= risk_threshold', async () => {
    const payload = makePayload(0.9, 0.7);
    const octokit = makeOctokit(createCheckRun);

    await publishCheck(octokit, { owner: 'acme', name: 'api' }, payload);

    expect(createCheckRun).toHaveBeenCalledOnce();
    const call = createCheckRun.mock.calls[0][0];
    expect(call.conclusion).toBe('failure');
  });

  it('output title includes the risk score rounded to percent', async () => {
    const payload = makePayload(0.75, 0.7);
    const octokit = makeOctokit(createCheckRun);

    await publishCheck(octokit, { owner: 'acme', name: 'api' }, payload);

    expect(createCheckRun).toHaveBeenCalledOnce();
    const call = createCheckRun.mock.calls[0][0];
    expect(call.output.title).toContain('75');
  });

  it('check run name is "ctxloom/risk"', async () => {
    const payload = makePayload(0.3, 0.7);
    const octokit = makeOctokit(createCheckRun);

    await publishCheck(octokit, { owner: 'acme', name: 'api' }, payload);

    const call = createCheckRun.mock.calls[0][0];
    expect(call.name).toBe('ctxloom/risk');
  });

  it('head_sha matches payload.pr.headSha', async () => {
    const payload = makePayload(0.3, 0.7);
    const octokit = makeOctokit(createCheckRun);

    await publishCheck(octokit, { owner: 'acme', name: 'api' }, payload);

    const call = createCheckRun.mock.calls[0][0];
    expect(call.head_sha).toBe('abc123');
  });

  it('output summary lists top 3 highest-risk files', async () => {
    const payload = makePayload(0.8, 0.7);
    const octokit = makeOctokit(createCheckRun);

    await publishCheck(octokit, { owner: 'acme', name: 'api' }, payload);

    const call = createCheckRun.mock.calls[0][0];
    expect(typeof call.output.summary).toBe('string');
    expect(call.output.summary.length).toBeGreaterThan(0);
    // The highest-risk file in makePayload(0.8) gets riskLevel 'high'
    expect(call.output.summary).toContain('src/auth.ts');
  });

  it('output summary includes the highest-risk (critical) file name', async () => {
    const payload: ReviewPayload = {
      pr: {
        owner: 'acme',
        repo: 'api',
        number: 99,
        headSha: 'sha999',
        baseSha: 'base999',
      },
      riskScore: 0.95,
      riskLabel: 'high',
      changedFiles: [
        {
          file: 'src/billing.ts',
          riskLevel: 'critical',
          importerCount: 10,
          isHub: true,
          hasTestCoverage: false,
          risk: null,
        },
        {
          file: 'src/utils.ts',
          riskLevel: 'low',
          importerCount: 1,
          isHub: false,
          hasTestCoverage: true,
          risk: null,
        },
      ],
      impact: {
        seedFiles: ['src/billing.ts'],
        directImporters: [],
        transitiveImporters: [],
        historicalCoupling: [],
        totalImpacted: 0,
      },
      suggestedReviewers: [],
      config: { ...DEFAULT_CONFIG, risk_threshold: 0.7 },
    };
    const octokit = makeOctokit(createCheckRun);

    await publishCheck(octokit, { owner: 'acme', name: 'api' }, payload);

    const call = createCheckRun.mock.calls[0][0];
    expect(typeof call.output.summary).toBe('string');
    expect(call.output.summary).toContain('src/billing.ts');
  });
});
