export interface Rule {
  name: string;
  type: 'no-import';
  from: string;
  to: string;
  severity?: 'error' | 'warn';
}

export interface RulesConfig {
  version: 1;
  rules: Rule[];
}

export interface Violation {
  rule: string;
  severity: 'error' | 'warn';
  fromFile: string;
  toFile: string;
  message: string;
}

export interface CheckResult {
  violations: Violation[];
  warnings: string[];
  rulesChecked: number;
  filesChecked: number;
  durationMs: number;
}

export class RulesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesConfigError';
  }
}
