/**
 * notebookExtractor.ts — Parse Jupyter .ipynb files.
 *
 * Extracts Python source from code cells for import analysis and
 * symbol indexing. Other cell types (markdown, raw) are ignored.
 */

interface NotebookCell {
  cell_type: string;
  source: string | string[];
}

interface NotebookMetadata {
  kernelspec?: {
    language?: string;
  };
}

interface NotebookJSON {
  cells?: NotebookCell[];
  metadata?: NotebookMetadata;
}

function parseNotebook(content: string): NotebookJSON {
  try {
    return JSON.parse(content) as NotebookJSON;
  } catch {
    return { cells: [], metadata: {} };
  }
}

function cellSource(cell: NotebookCell): string {
  if (Array.isArray(cell.source)) return cell.source.join('');
  return typeof cell.source === 'string' ? cell.source : '';
}

/**
 * Extract all code cell sources concatenated as a single string.
 * Markdown and raw cells are skipped.
 */
export function extractNotebookPythonSource(content: string): string {
  const nb = parseNotebook(content);
  if (!nb.cells) return '';
  return nb.cells
    .filter(c => c.cell_type === 'code')
    .map(c => cellSource(c))
    .join('\n');
}

/**
 * Detect the notebook's kernel language.
 * Returns 'python', 'r', 'julia', etc., or 'unknown' if not available.
 */
export function extractNotebookLanguage(content: string): string {
  const nb = parseNotebook(content);
  return nb.metadata?.kernelspec?.language?.toLowerCase() ?? 'unknown';
}
