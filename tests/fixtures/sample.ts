/**
 * Sample TypeScript file for testing ASTParser, Skeletonizer, and DependencyGraph.
 */
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import type { Config } from './config.js';

export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private db: string;

  constructor(db: string) {
    this.db = db;
  }

  async getUser(id: string): Promise<User | null> {
    const raw = readFileSync(this.db, 'utf-8');
    return JSON.parse(raw);
  }

  async createUser(name: string, email: string): Promise<User> {
    const user: User = { id: crypto.randomUUID(), name, email };
    return user;
  }
}

export function formatUser(user: User): string {
  return `${user.name} <${user.email}>`;
}

export default function createService(config: Config): UserService {
  return new UserService(config.dbPath);
}

const helper = (x: number) => x * 2;
