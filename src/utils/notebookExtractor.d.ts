/**
 * notebookExtractor.ts — Parse Jupyter .ipynb files.
 *
 * Extracts Python source from code cells for import analysis and
 * symbol indexing. Other cell types (markdown, raw) are ignored.
 */
/**
 * Extract all code cell sources concatenated as a single string.
 * Markdown and raw cells are skipped.
 */
export declare function extractNotebookPythonSource(content: string): string;
/**
 * Detect the notebook's kernel language.
 * Returns 'python', 'r', 'julia', etc., or 'unknown' if not available.
 */
export declare function extractNotebookLanguage(content: string): string;
//# sourceMappingURL=notebookExtractor.d.ts.map