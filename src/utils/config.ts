import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

export interface RepoConfig {
  owner: string;
  repo: string;
  tweets_per_day: number;
}

export interface AppConfig {
  timezone: string;
  thread_followup: boolean;
  thread_followup_text: string;
  max_tweets_per_day: number;
  llm_provider: string;
}

export function readRepos(): RepoConfig[] {
  const file = path.join(process.cwd(), 'repos.yml');
  const content = fs.readFileSync(file, 'utf-8');
  const parsed = yaml.load(content) as { repos: RepoConfig[] };
  return parsed.repos;
}

export function readConfig(): AppConfig {
  const primary = path.join(process.cwd(), 'config.yml');
  const fallback = path.join(process.cwd(), 'config.example.yml');
  const file = fs.existsSync(primary) ? primary : fallback;
  if (!fs.existsSync(file)) {
    throw new Error('No config.yml or config.example.yml found. Run: cp config.example.yml config.yml');
  }
  const content = fs.readFileSync(file, 'utf-8');
  return yaml.load(content) as AppConfig;
}

export function findRepo(repoName: string): RepoConfig {
  const repos = readRepos();
  const found = repos.find(r => r.repo === repoName);
  if (!found) throw new Error(`Repo "${repoName}" not found in repos.yml`);
  return found;
}

/**
 * Parse a timezone string like "GMT+5:30" or "GMT-8" into minutes offset.
 * Returns a positive number for east (e.g. +330 for GMT+5:30).
 */
export function parseTzOffset(tz: string): number {
  const match = tz.match(/^GMT([+-])(\d+)(?::(\d+))?$/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3] ?? '0', 10);
  return sign * (hours * 60 + minutes);
}

/**
 * Format a UTC Date as a local time string in the given timezone.
 * Returns "YYYY-MM-DD HH:MM GMT+X:XX"
 */
export function formatLocalTime(utcDate: Date, tz: string): string {
  const offsetMin = parseTzOffset(tz);
  const local = new Date(utcDate.getTime() + offsetMin * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  return `${date} ${time} ${tz}`;
}

/**
 * Parse a formatted local time string back to a UTC Date.
 * Accepts "YYYY-MM-DD HH:MM GMT+X:XX"
 */
export function parseLocalTime(str: string, tz: string): Date {
  // e.g. "2024-01-15 09:00 GMT+5:30"
  const match = str.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  if (!match) throw new Error(`Cannot parse time: ${str}`);
  const localMs = new Date(`${match[1]}T${match[2]}:00Z`).getTime();
  const offsetMin = parseTzOffset(tz);
  return new Date(localMs - offsetMin * 60 * 1000);
}
