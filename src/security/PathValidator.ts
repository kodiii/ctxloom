/**
 * PathValidator — Centralized path boundary validation module.
 *
 * Prevents path traversal attacks (CWE-22) by ensuring all file path
 * inputs resolve within the project root. Applied uniformly across
 * all MCP tool handlers.
 */
import path from 'node:path';
import fs from 'node:fs';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export class PathValidator {
  private canonicalRoot: string;

  constructor(projectRoot: string) {
    // Resolve to canonical absolute path
    this.canonicalRoot = fs.realpathSync(path.resolve(projectRoot));
  }

  /**
   * Validates that the given input path resolves within the project root.
   * Follows symlinks but checks they don't escape the root.
   *
   * @returns The canonical absolute path if valid
   * @throws Error if the path escapes the project root
   */
  validate(inputPath: string): string {
    const resolved = path.resolve(this.canonicalRoot, inputPath);

    // Use realpathSync to follow symlinks and get canonical path
    let canonical: string;
    try {
      canonical = fs.realpathSync(resolved);
    } catch {
      // File doesn't exist yet — validate the resolved path itself
      canonical = resolved;
    }

    // Ensure canonical path starts with the project root
    if (!canonical.startsWith(this.canonicalRoot + path.sep) && canonical !== this.canonicalRoot) {
      // M-6: Do not leak canonical absolute paths in error messages
      throw new Error(
        `Path traversal blocked: "${inputPath}" resolves outside of the project root`
      );
    }

    return canonical;
  }

  /**
   * Returns the canonical project root path.
   */
  getProjectRoot(): string {
    return this.canonicalRoot;
  }

  /**
   * Converts an absolute path to a relative path from the project root.
   */
  toRelative(absolutePath: string): string {
    return path.relative(this.canonicalRoot, absolutePath);
  }

  /**
   * Validates and reads a file, returning its content.
   * Throws if path escapes root or file doesn't exist.
   */
  readFile(inputPath: string): string {
    const absPath = this.validate(inputPath);

    // Check file size before reading
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${inputPath} (${Math.round(stat.size / 1024)}KB, max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    return fs.readFileSync(absPath, 'utf-8');
  }

  /**
   * Checks if a path exists and is within the project root.
   */
  isWithinRoot(inputPath: string): boolean {
    try {
      this.validate(inputPath);
      return true;
    } catch {
      return false;
    }
  }
}
