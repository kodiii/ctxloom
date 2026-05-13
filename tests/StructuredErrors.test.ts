import { describe, it, expect } from 'vitest';
import {
  noDefaultProjectError,
  projectRootNotFoundError,
  aliasNotFoundError,
  noParseableSourcesWarning,
} from '../packages/core/src/server/structuredErrors.js';

describe('structured errors', () => {
  it('emits no_default_project with attempted root + resolution chain', () => {
    const out = noDefaultProjectError({
      attemptedRoot: '/',
      resolutionChain: 'env:CTXLOOM_ROOT→unset, fallback_cwd→/',
      registeredAliases: ['foo', 'bar'],
    });
    expect(out).toMatch(/<error code="no_default_project"/);
    expect(out).toMatch(/attempted_root="\/"/);
    expect(out).toMatch(/Registered aliases: \['foo', 'bar'\]/);
  });

  it('emits project_root_not_found', () => {
    expect(projectRootNotFoundError({ path: '/nope', resolutionChain: 'arg:nope' })).toMatch(
      /code="project_root_not_found"/,
    );
  });

  it('emits alias_not_found with did_you_mean', () => {
    expect(
      aliasNotFoundError({ alias: 'fooo', didYouMean: ['foo', 'foobar'] }),
    ).toMatch(/did_you_mean="\['foo', 'foobar'\]"/);
  });

  it('emits no_parseable_sources warning', () => {
    expect(noParseableSourcesWarning()).toMatch(/<warning code="no_parseable_sources"/);
  });
});
