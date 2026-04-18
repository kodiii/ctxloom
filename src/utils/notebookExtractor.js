/**
 * notebookExtractor.ts — Parse Jupyter .ipynb files.
 *
 * Extracts Python source from code cells for import analysis and
 * symbol indexing. Other cell types (markdown, raw) are ignored.
 */
function parseNotebook(content) {
    try {
        return JSON.parse(content);
    }
    catch {
        return { cells: [], metadata: {} };
    }
}
function cellSource(cell) {
    if (Array.isArray(cell.source))
        return cell.source.join('');
    return typeof cell.source === 'string' ? cell.source : '';
}
/**
 * Extract all code cell sources concatenated as a single string.
 * Markdown and raw cells are skipped.
 */
export function extractNotebookPythonSource(content) {
    const nb = parseNotebook(content);
    if (!nb.cells)
        return '';
    return nb.cells
        .filter(c => c.cell_type === 'code')
        .map(c => cellSource(c))
        .join('\n');
}
/**
 * Detect the notebook's kernel language.
 * Returns 'python', 'r', 'julia', etc., or 'unknown' if not available.
 */
export function extractNotebookLanguage(content) {
    const nb = parseNotebook(content);
    return nb.metadata?.kernelspec?.language?.toLowerCase() ?? 'unknown';
}
//# sourceMappingURL=notebookExtractor.js.map