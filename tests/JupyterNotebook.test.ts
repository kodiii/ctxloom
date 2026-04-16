import { describe, it, expect } from 'vitest';
import { extractNotebookPythonSource, extractNotebookLanguage } from '../src/utils/notebookExtractor.js';
import { extractImports } from '../src/utils/importExtractor.js';
import path from 'node:path';

const SAMPLE_NOTEBOOK = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { language: 'python', name: 'python3', display_name: 'Python 3' },
  },
  cells: [
    {
      cell_type: 'code',
      source: ['import os\n', 'from . import utils\n'],
      outputs: [],
    },
    {
      cell_type: 'markdown',
      source: ['# This is a heading\n'],
    },
    {
      cell_type: 'code',
      source: ['from .models import User\n', 'x = 1 + 2\n'],
      outputs: [],
    },
  ],
});

describe('JupyterNotebook', () => {
  it('extractNotebookLanguage returns "python" for Python kernel', () => {
    expect(extractNotebookLanguage(SAMPLE_NOTEBOOK)).toBe('python');
  });

  it('extractNotebookPythonSource extracts only code cells', () => {
    const src = extractNotebookPythonSource(SAMPLE_NOTEBOOK);
    expect(src).toContain('import os');
    expect(src).toContain('from . import utils');
    expect(src).toContain('from .models import User');
    expect(src).not.toContain('This is a heading');
  });

  it('extractImports on a .ipynb path returns Python relative imports', () => {
    const fakeNotebookPath = path.join('/project', 'notebooks', 'analysis.ipynb');
    const imports = extractImports(fakeNotebookPath, SAMPLE_NOTEBOOK);
    // Should find at least the relative imports: "from . import utils" and "from .models import User"
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.some(i => i.isRelative)).toBe(true);
  });

  it('extractNotebookPythonSource returns empty string for non-code notebook', () => {
    const mdOnly = JSON.stringify({
      nbformat: 4,
      metadata: {},
      cells: [{ cell_type: 'markdown', source: ['# heading'] }],
    });
    expect(extractNotebookPythonSource(mdOnly)).toBe('');
  });

  it('extractNotebookLanguage returns "unknown" when no kernelspec present', () => {
    const noKernel = JSON.stringify({ nbformat: 4, metadata: {}, cells: [] });
    expect(extractNotebookLanguage(noKernel)).toBe('unknown');
  });
});
