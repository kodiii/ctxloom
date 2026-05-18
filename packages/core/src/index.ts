/**
 * @ctxloom/core — public API for all ctxloom apps.
 *
 * Workspace-private; never published to npm.
 * Consumers: apps/dashboard, apps/pr-bot, future VS Code extension, Slack bot,
 *            and the ctxloom-pro CLI entry point (src/index.ts, src/server.ts).
 *
 * This file is the ONLY intended import path from @ctxloom/core.
 * Deep imports into packages/core/src/* are not supported.
 */

// ─── Graph ───────────────────────────────────────────────────────────────────
export type { GraphEdge } from './graph/DependencyGraph.js';
export { DependencyGraph } from './graph/DependencyGraph.js';
export type { Community, CommunityCache } from './graph/CommunityDetector.js';
export { CommunityDetector } from './graph/CommunityDetector.js';
export type { EdgeConfidence, CallEdge, CallerEntry } from './graph/CallGraphIndex.js';
export { CallGraphIndex } from './graph/CallGraphIndex.js';
export type { WikiPage, WikiResult } from './graph/WikiGenerator.js';
export { WikiGenerator } from './graph/WikiGenerator.js';
export type { ExportFormat, ExportResult } from './graph/GraphExporter.js';
export { GraphExporter } from './graph/GraphExporter.js';

// ─── Git overlay ─────────────────────────────────────────────────────────────
export type { OverlayBootstrapOptions, RefreshResult } from './git/GitOverlayStore.js';
export { GitOverlayStore } from './git/GitOverlayStore.js';
export type { CoChangeStats, CoChangeQuery, CoChangeSnapshot } from './git/CoChangeIndex.js';
export { CoChangeIndex } from './git/CoChangeIndex.js';
export type { OwnerShare, OwnershipStats, OwnershipSnapshot } from './git/OwnershipIndex.js';
export { OwnershipIndex } from './git/OwnershipIndex.js';
export type { ChurnStats, ChurnSnapshot } from './git/ChurnIndex.js';
export { ChurnIndex } from './git/ChurnIndex.js';
export type { GitCommitEvent, MinerOptions } from './git/GitHistoryMiner.js';
export { GitHistoryMiner } from './git/GitHistoryMiner.js';

// ─── Trends ──────────────────────────────────────────────────────────────────
export type {
  TrendSnapshot,
  TrendSeries,
  TrendSource,
  RecordOptions as TrendRecordOptions,
  LoadOptions as TrendLoadOptions,
  FileRiskPoint,
  FileRiskHistory,
} from './trends/types.js';
export { recordTrendSnapshot } from './trends/TrendsRecorder.js';
export { loadTrendSeries } from './trends/TrendsStore.js';
export { loadFileRiskHistory } from './trends/FileRiskStore.js';

// ─── Risk scoring ────────────────────────────────────────────────────────────
export type {
  RiskLabel,
  RawRiskMetrics,
  RiskBreakdown,
  RiskCaps,
  RiskBands,
  ScoredFile,
} from './risk/scoring.js';
export {
  RISK_WEIGHTS,
  BAND_PCT,
  SCORE_FLOOR,
  SILO_BUS_FACTOR,
  computeRiskCaps,
  computeRiskBreakdown,
  scoreFromBreakdown,
  isSiloed,
  assignLabelsByPercentile,
  scoreAll,
} from './risk/scoring.js';

// ─── AST ─────────────────────────────────────────────────────────────────────
export type { MethodRange, CallSite, ParsedNode } from './ast/ASTParser.js';
export { ASTParser } from './ast/ASTParser.js';
export { Skeletonizer } from './ast/Skeletonizer.js';

// ─── Indexer ─────────────────────────────────────────────────────────────────
export { generateEmbedding, collectFiles, indexDirectory, EMBEDDING_DIMENSION } from './indexer/embedder.js';

// ─── Database ────────────────────────────────────────────────────────────────
export type { VectorSearchResult } from './db/VectorStore.js';
export { VectorStore } from './db/VectorStore.js';

// ─── Grammars ────────────────────────────────────────────────────────────────
export type { GrammarEntry } from './grammars/grammar-manifest.js';
export { GRAMMAR_MANIFEST, findGrammar, findGrammarByExtension } from './grammars/grammar-manifest.js';
export type { GrammarStatus } from './grammars/GrammarLoader.js';
export { GrammarLoader } from './grammars/GrammarLoader.js';

// ─── Tools ───────────────────────────────────────────────────────────────────
export type { ServerContext } from './tools/context.js';
export type { RenderStatusInput } from './tools/status.js';
export { renderStatusXml } from './tools/status.js';
export type { ToolHandler, ToolDefinition } from './tools/registry.js';
export { ToolRegistry } from './tools/registry.js';
export { createToolRegistry } from './tools/index.js';
export type { RuleFile } from './tools/ruleManager.js';
export { RuleManager } from './tools/ruleManager.js';
export type { RegisteredRepo } from './tools/cross-repo-search.js';
export { RepoRegistry, validateAlias } from './tools/cross-repo-search.js';
export type { AliasValidation } from './tools/cross-repo-search.js';
export type { BlastRadiusOptions, BlastRadiusResult } from './tools/blast-radius.js';
export { buildBlastRadiusXml } from './tools/blast-radius.js';
export type { SnapshotData } from './tools/graph-snapshot.js';
export { saveNamedSnapshot, listNamedSnapshots } from './tools/graph-snapshot.js';
export type { LargeFunctionResult } from './tools/find-large-functions.js';
export { findLargeFunctions } from './tools/find-large-functions.js';

// ─── Review ──────────────────────────────────────────────────────────────────
export { AuthorResolver, resolveViaGitHubApi } from './review/AuthorResolver.js';
export type { CodeownersRule } from './review/CodeownersWriter.js';
export { buildCodeownersBlock, mergeIntoFile, generateCODEOWNERS, writeCODEOWNERS } from './review/CodeownersWriter.js';
export type {
  ReviewWeights,
  ReviewThresholds,
  ReviewDefaults,
  ReviewConfig,
  CandidateActivity,
  ScoreBreakdown,
  ReviewSuggestion,
  BusFactorWarning,
  ReviewSuggestResult,
  AuthorMapping,
} from './review/types.js';
export { DEFAULT_REVIEW_CONFIG } from './review/types.js';
export { scoreReviewers } from './review/ReviewerScorer.js';
export { loadReviewConfig } from './review/loadConfig.js';

// ─── Rules engine ────────────────────────────────────────────────────────────
export type { Rule, RulesConfig, Violation, CheckResult } from './rules/types.js';
export { RulesConfigError } from './rules/types.js';
export { loadRulesConfig } from './rules/loadConfig.js';
export { RulesChecker } from './rules/RulesChecker.js';
export { formatText, formatJson } from './rules/reporter.js';

// ─── Security ────────────────────────────────────────────────────────────────
export { PathValidator } from './security/PathValidator.js';

// ─── Utils ───────────────────────────────────────────────────────────────────
export type { LogLevel } from './utils/logger.js';
export { logger } from './utils/logger.js';
export type { RawImport } from './utils/importExtractor.js';
export { extractImports, resolveImport } from './utils/importExtractor.js';
export { extractNotebookPythonSource, extractNotebookLanguage } from './utils/notebookExtractor.js';
export { TsConfigPathsResolver } from './utils/TsConfigPathsResolver.js';
export { GoModuleResolver } from './utils/GoModuleResolver.js';

// ─── Watcher ─────────────────────────────────────────────────────────────────
export type { ChangeCallback } from './watcher/FileWatcher.js';
export { FileWatcher } from './watcher/FileWatcher.js';

// ─── Analysis (lib) ──────────────────────────────────────────────────────────
export type {
  RiskLevel,
  ChurnBucket,
  OverlayRisk,
  ChangedFile,
  DetectChangesInput,
  DetectChangesResult,
  HistoricalCouplingEntry,
  ImpactReport,
  ImpactInput,
} from './lib/analysis.js';
export { detectChanges, getImpactRadius } from './lib/analysis.js';

// ─── License ─────────────────────────────────────────────────────────────────
export {
  LicenseRequiredError,
  SeatLimitError,
  InvalidKeyError,
  LicenseRevokedError,
  NetworkError,
  FingerprintAlreadyUsedError,
  TrialUnavailableError,
  EmailAlreadyUsedError,
} from './license/errors.js';
export type { LicenseFile, Tier, LicenseStatus, ActivateResult, ValidateResult, TrialStartResult } from './license/types.js';
export { LicenseStore } from './license/LicenseStore.js';
export { ApiClient } from './license/ApiClient.js';
export { Fingerprint } from './license/Fingerprint.js';
export { maybePrintExpiryWarning } from './license/ExpiryWarning.js';
export {
  isActive,
  requireActive,
  getLicenseInfo,
  activateLicense,
  deactivateLicense,
  startTrial,
} from './license/index.js';
export type { TelemetryEvent, TelemetryLevel } from './license/telemetry.js';
export { track, captureError, getTelemetryLevel } from './license/telemetry.js';
export { shouldShowTelemetryNotice } from './license/TelemetryNotice.js';
export { shouldEmitInstallCompleted, shouldEmitFirstReviewRun } from './license/FunnelMilestones.js';
export { getOrCreateDistinctId, markAliasSent } from './license/DistinctIdStore.js';
export type { DistinctIdRecord } from './license/DistinctIdStore.js';

// ─── Multi-project server infrastructure (v1.1) ───────────────────────────
export type { ProjectState } from './server/ProjectState.js';
export { createProjectState, disposeProjectState, ensureVectorsInitialized } from './server/ProjectState.js';
export { ProjectStateManager } from './server/ProjectStateManager.js';
export type { ProjectStateManagerOptions } from './server/ProjectStateManager.js';
export type { RegistryView, ResolveInput, ResolveOutcome } from './server/resolveProjectRoot.js';
export { resolveProjectRoot, validateDefaultRoot } from './server/resolveProjectRoot.js';
export {
  noDefaultProjectError,
  projectRootNotFoundError,
  projectRootUnreadableError,
  aliasNotFoundError,
  noParseableSourcesWarning,
} from './server/structuredErrors.js';
export type { IndexingTier, EnvelopeInput } from './server/indexingEnvelope.js';
export { wrapWithIndexingEnvelope, FirstTouchTracker } from './server/indexingEnvelope.js';
export { hashProjectRoot } from './server/projectId.js';
export { EmittedOnceTracker } from './server/EmittedOnceTracker.js';

// ─── Agent-harness installer (Phase 2) ────────────────────────────────
export { installHarness } from './install/installer.js';
export type {
  FileResult,
  InstallHarnessResult,
  InstallHarnessOptions,
} from './install/installer.js';
export {
  RULES_BLOCK_NAME,
  RULES_BLOCK_CONTENT,
  SESSION_START_FULL,
  CTXLOOM_HOOK_ENTRIES,
} from './install/templates.js';
export type { HooksJsonShape } from './install/templates.js';
export {
  computeBlockHmac,
  extractBlock,
  verifyBlock,
  upsertBlock,
  wrapBlock,
  resolveHmacKey,
  DEFAULT_HMAC_KEY,
} from './install/hmacBlock.js';
export type { ExtractedBlock } from './install/hmacBlock.js';
export { CTXLOOM_SKILLS, skillFilePath } from './install/skillTemplates.js';
export type { SkillTemplate } from './install/skillTemplates.js';

// ─── Task-tool budget (Phase 4a) ──────────────────────────────────────
export {
  TaskBudgetTracker,
  getTaskBudgetTracker,
  applyOverBudgetOverrides,
  emitTaskBudgetBreached,
  OVER_BUDGET_ARG_OVERRIDES,
  __resetTaskBudgetTrackerForTests,
} from './budget/taskBudget.js';
export type { TaskBudgetDecision } from './budget/taskBudget.js';
