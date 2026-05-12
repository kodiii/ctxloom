/**
 * Reusable input-schema fragment for the optional `project_root` parameter.
 * Every tool registered after #70 includes it via spread.
 */
import { z } from 'zod';

export const PROJECT_ROOT_DESCRIPTION =
  'Absolute path or registered alias of the project to operate on. ' +
  'Falls back to CTXLOOM_ROOT env, then server cwd. ' +
  'Register aliases with `ctxloom register <path> --alias <name>`.';

export const PROJECT_ROOT_JSON_SCHEMA = {
  type: 'string' as const,
  description: PROJECT_ROOT_DESCRIPTION,
};

export const ProjectRootField = z.string().optional().describe(PROJECT_ROOT_DESCRIPTION);
