/**
 * XML builders for structured `<error>` and `<warning>` shapes introduced
 * by issue #70.
 *
 * Scoped to project-resolution and indexing failures only — existing
 * tools' plain-text error paths are unchanged.
 */

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function noDefaultProjectError(input: {
  attemptedRoot: string;
  resolutionChain: string;
  registeredAliases: string[];
}): string {
  const aliasList = `[${input.registeredAliases.map((a) => `'${a}'`).join(', ')}]`;
  return (
    `<error code="no_default_project" ` +
    `attempted_root="${escapeAttr(input.attemptedRoot)}" ` +
    `resolution_chain="${escapeAttr(input.resolutionChain)}" ` +
    `hint="Set CTXLOOM_ROOT in your MCP server config, or pass project_root explicitly. Registered aliases: ${aliasList}." />`
  );
}

export function projectRootNotFoundError(input: { path: string; resolutionChain: string }): string {
  return (
    `<error code="project_root_not_found" ` +
    `path="${escapeAttr(input.path)}" ` +
    `resolution_chain="${escapeAttr(input.resolutionChain)}" />`
  );
}

export function projectRootUnreadableError(input: { path: string; detail: string }): string {
  return (
    `<error code="project_root_unreadable" ` +
    `path="${escapeAttr(input.path)}" ` +
    `detail="${escapeAttr(input.detail)}" />`
  );
}

export function aliasNotFoundError(input: { alias: string; didYouMean: string[] }): string {
  const suggestions = `[${input.didYouMean.map((a) => `'${a}'`).join(', ')}]`;
  return (
    `<error code="alias_not_found" ` +
    `alias="${escapeAttr(input.alias)}" ` +
    `did_you_mean="${escapeAttr(suggestions)}" />`
  );
}

export function noParseableSourcesWarning(): string {
  return (
    `<warning code="no_parseable_sources" ` +
    `reason="directory has 0 files matching supported language extensions" />`
  );
}
