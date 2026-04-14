/**
 * VectorStore — LanceDB-backed vector storage for code embeddings.
 *
 * Uses @lancedb/lancedb (corrected package per flaw analysis).
 * Schema: id (string), filePath (string), embedding (Float32[]), content (string)
 */
import lancedb from '@lancedb/lancedb';
import type { Connection, Table } from '@lancedb/lancedb';
import { makeArrowTable } from '@lancedb/lancedb';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../utils/logger.js';

export interface VectorSearchResult {
  filePath: string;
  content: string;
  score: number;
}

/**
 * Sanitize a file path for use in LanceDB filter strings.
 * Allows only characters that appear in normal file paths.
 */
function sanitizeFilterPath(filePath: string): string {
  // Replace any character that isn't alphanumeric, slash, dot, underscore, hyphen, or space
  // with an underscore to prevent filter injection
  return filePath.replace(/[^a-zA-Z0-9/._\- ]/g, '_');
}

export class VectorStore {
  private dbPath: string;
  private db: Connection | null = null;
  private table: Table | null = null;
  private initialized = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(process.cwd(), '.contextmesh', 'vectors.lancedb');
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = await lancedb.connect(this.dbPath);

    // Create or open table
    const existingTables = await this.db.tableNames();
    if (existingTables.includes('code_embeddings')) {
      this.table = await this.db.openTable('code_embeddings');
    } else {
      // Create with a seed record using arrow table format
      const seedTable = makeArrowTable([
        {
          id: '__seed__',
          filePath: '__seed__',
          vector: new Array(384).fill(0),
          content: '',
        },
      ]);
      this.table = await this.db.createTable('code_embeddings', seedTable);
      // Remove seed record
      await this.table.delete("id = '__seed__'");
    }

    this.initialized = true;
  }

  /**
   * Insert or update a code record.
   */
  async upsert(filePath: string, embedding: number[], content: string): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized. Call init() first.');

    // Delete existing record for this file
    const safe = sanitizeFilterPath(filePath);
    try {
      await this.table.delete(`filePath = '${safe}'`);
    } catch (err) {
      logger.warn('Delete before upsert failed, continuing', { detail: err instanceof Error ? err.message : String(err) });
    }

    // Insert new record
    const record = {
      id: filePath,
      filePath,
      vector: embedding,
      content: content.slice(0, 512),
    };

    await this.table.add([record]);
  }

  /**
   * Search for the top-K most similar code records using vector search.
   */
  async search(queryEmbedding: number[], limit: number = 10): Promise<VectorSearchResult[]> {
    if (!this.table) throw new Error('VectorStore not initialized. Call init() first.');

    try {
      const results = await this.table
        .vectorSearch(queryEmbedding)
        .limit(limit)
        .toArray();

      return results
        .filter((r: Record<string, unknown>) => r.id !== '__seed__')
        .map((r: Record<string, unknown>) => ({
          filePath: String(r.filePath ?? r.id),
          content: String(r.content ?? ''),
          score: Number(r._distance ?? 0),
        }));
    } catch (err) {
      // If vector index doesn't exist yet, try creating it
      logger.warn('Search failed, attempting to create index', { detail: String(err) });
      try {
        await this.table.createIndex('vector');
        const results = await this.table
          .vectorSearch(queryEmbedding)
          .limit(limit)
          .toArray();

        return results
          .filter((r: Record<string, unknown>) => r.id !== '__seed__')
          .map((r: Record<string, unknown>) => ({
            filePath: String(r.filePath ?? r.id),
            content: String(r.content ?? ''),
            score: Number(r._distance ?? 0),
          }));
      } catch {
        return [];
      }
    }
  }

  /**
   * Remove a file's embedding from the store.
   */
  async remove(filePath: string): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized. Call init() first.');

    const safe = sanitizeFilterPath(filePath);
    try {
      await this.table.delete(`filePath = '${safe}'`);
    } catch (err) {
      logger.error('Remove failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Get the total number of records.
   */
  async count(): Promise<number> {
    if (!this.table) return 0;
    try {
      return await this.table.countRows();
    } catch (err) {
      logger.error('countRows failed', { detail: err instanceof Error ? err.message : String(err) });
      return 0;
    }
  }
}
