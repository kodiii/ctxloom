import * as assert from 'node:assert';
import { renderStatusBar } from '../../src/license/statusBar.js';

suite('StatusBar', () => {
  test('renderStatusBar produces expected text for licensed + risk', () => {
    const r = renderStatusBar({ licenseState: { kind: 'LICENSED', tier: 'pro', expiresAt: '' }, riskScore: 0.30 });
    assert.strictEqual(r.text, '⚠ 0.30 · ctxloom');
  });
});
