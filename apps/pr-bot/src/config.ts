import { z } from 'zod';

const MAX_INLINE_COMMENTS = 50;

export const RepoConfigSchema = z.object({
  risk_threshold: z.number().min(0).max(1).default(0.7),
  inline_comments: z.boolean().default(true),
  suggested_reviewers: z.boolean().default(true),
  check_run: z.boolean().default(false),
  excluded_paths: z.array(z.string()).default([]),
  max_inline_per_pr: z.number().int().min(0).max(MAX_INLINE_COMMENTS).default(10),
}).strict();

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export const DEFAULT_CONFIG: RepoConfig = RepoConfigSchema.parse({});

export function parseRepoConfig(raw: unknown): RepoConfig {
  return RepoConfigSchema.parse(raw ?? {});
}
