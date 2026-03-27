import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

export interface RepoConfig {
  owner: string;
  repo: string;
}

export interface AppConfig {
  github_owner: string;
  repos: string[];
  platforms: string[];     // ["x", "bluesky"] — which platforms to post to
  timezone: string;
  thread_followup: boolean;
  thread_followup_text: string;
  llm_provider: string;
  post_times: string[];    // ["09:00", "13:00", ...] — up to 8, local timezone
  auto_generate: boolean;  // enable 4x/day cron auto-pickup of new commits
  paused: boolean;         // kill switch
}

export function readConfig(): AppConfig {
  const primary = path.join(process.cwd(), 'config.yml');
  const fallback = path.join(process.cwd(), 'config.example.yml');
  const file = fs.existsSync(primary) ? primary : fallback;
  if (!fs.existsSync(file)) {
    throw new Error('No config.yml or config.example.yml found. Run: cp config.example.yml config.yml');
  }
  const raw = yaml.load(fs.readFileSync(file, 'utf-8')) as Partial<AppConfig>;

  return {
    github_owner: raw.github_owner ?? '',
    repos: raw.repos ?? [],
    platforms: raw.platforms ?? ['x'],
    timezone: raw.timezone ?? 'GMT+0',
    thread_followup: raw.thread_followup ?? true,
    thread_followup_text: raw.thread_followup_text ?? '~ posted using github.com/rav4nn/buildinpublic-x',
    llm_provider: raw.llm_provider ?? 'anthropic',
    post_times: raw.post_times ?? ['09:00', '13:00', '17:00', '21:00'],
    auto_generate: raw.auto_generate ?? false,
    paused: raw.paused ?? false,
  };
}

export function readRepos(): RepoConfig[] {
  const config = readConfig();
  if (!config.github_owner) {
    throw new Error('github_owner not set in config.yml');
  }
  if (config.repos.length === 0) {
    throw new Error('No repos listed in config.yml');
  }
  return config.repos.map(repo => ({ owner: config.github_owner, repo }));
}

export function findRepo(repoName: string): RepoConfig {
  const config = readConfig();
  if (!config.github_owner) {
    throw new Error('github_owner not set in config.yml');
  }
  if (!config.repos.includes(repoName)) {
    throw new Error(`Repo "${repoName}" not found in config.yml repos list`);
  }
  return { owner: config.github_owner, repo: repoName };
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
  const match = str.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  if (!match) throw new Error(`Cannot parse time: ${str}`);
  const localMs = new Date(`${match[1]}T${match[2]}:00Z`).getTime();
  const offsetMin = parseTzOffset(tz);
  return new Date(localMs - offsetMin * 60 * 1000);
}
