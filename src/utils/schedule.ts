import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, formatLocalTime, parseLocalTime } from './config';

export type ScheduleStatus = 'SCHEDULED' | 'POSTED';

export interface ScheduledTweet {
  repo: string;
  tweetNumber: number;
  status: ScheduleStatus;
  scheduled: string; // "YYYY-MM-DD HH:MM GMT±X"
  text: string;
}

const SCHEDULE_FILE = 'schedule-twitter.txt';

function scheduleFile(): string {
  return path.join(process.cwd(), SCHEDULE_FILE);
}

/** Parse schedule-twitter.txt into ScheduledTweet objects. */
export function readSchedule(): ScheduledTweet[] {
  const file = scheduleFile();
  if (!fs.existsSync(file)) return [];
  return parseScheduleTxt(fs.readFileSync(file, 'utf-8'));
}

/**
 * Parse the plain-text schedule format.
 * Each entry starts with a header line: "YYYY-MM-DD HH:MM GMT±X | repo #N"
 * Lines starting with # are comments/headers and are skipped.
 */
export function parseScheduleTxt(content: string): ScheduledTweet[] {
  const entries: ScheduledTweet[] = [];
  const lines = content.split('\n');

  let currentScheduled = '';
  let currentRepo = '';
  let currentNumber = 0;
  const currentTextLines: string[] = [];

  function flush(): void {
    if (currentScheduled && currentRepo && currentNumber > 0) {
      entries.push({
        repo: currentRepo,
        tweetNumber: currentNumber,
        status: 'SCHEDULED',
        scheduled: currentScheduled,
        text: currentTextLines.join('\n').trim(),
      });
    }
    currentTextLines.length = 0;
    currentScheduled = '';
    currentRepo = '';
    currentNumber = 0;
  }

  for (const line of lines) {
    if (line.startsWith('#')) continue;

    // Entry header: "YYYY-MM-DD HH:MM GMT±X | repo #N"
    const headerMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} \S+) \| (\S+) #(\d+)$/);
    if (headerMatch) {
      flush();
      currentScheduled = headerMatch[1];
      currentRepo = headerMatch[2];
      currentNumber = parseInt(headerMatch[3], 10);
      continue;
    }

    if (currentScheduled) {
      currentTextLines.push(line);
    }
  }
  flush();

  return entries;
}

/** Build the schedule file header with queue summary. */
function buildHeader(entries: ScheduledTweet[], config: AppConfig): string {
  const nowUtc = new Date();
  const sorted = [...entries].sort((a, b) => a.scheduled.localeCompare(b.scheduled));
  const lastScheduled = sorted[sorted.length - 1]?.scheduled ?? 'none';
  const times = config.post_times.join(', ');
  const autoStatus = config.auto_generate
    ? 'ON — picks up new commits 4x/day automatically'
    : 'OFF — run: npm run auto-generate to pick up new commits';

  return [
    '# Tweet Schedule',
    `# Generated: ${formatLocalTime(nowUtc, config.timezone)}`,
    `# Posting at: ${times} ${config.timezone} (${config.post_times.length}/day)`,
    `# Queue runs through: ${lastScheduled}`,
    `# Auto-generate: ${autoStatus}`,
    `# Kill switch: set paused: true in config.yml, then run: npm run deploy`,
    '#',
    '# Edit the scheduled times below freely, then run: npm run deploy',
    '',
    '',
    '',
  ].join('\n');
}

/** Serialize a single schedule entry. */
function serializeEntry(e: ScheduledTweet): string {
  return `${e.scheduled} | ${e.repo} #${e.tweetNumber}\n${e.text}`;
}

/** Write all SCHEDULED entries to schedule-twitter.txt with a summary header. */
export function writeSchedule(entries: ScheduledTweet[], config: AppConfig): void {
  const scheduled = entries.filter(e => e.status === 'SCHEDULED');
  const sorted = [...scheduled].sort((a, b) => a.scheduled.localeCompare(b.scheduled));
  const header = buildHeader(sorted, config);
  const body = sorted.map(serializeEntry).join('\n\n');
  fs.writeFileSync(scheduleFile(), header + body + (sorted.length ? '\n' : ''), 'utf-8');
}

/** Remove a posted entry from the schedule file. */
export function removeScheduleEntry(repo: string, tweetNumber: number): void {
  const entries = readSchedule();
  const filtered = entries.filter(e => !(e.repo === repo && e.tweetNumber === tweetNumber));
  // Re-read config for the header — lazy import to avoid circular deps
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readConfig } = require('./config');
  writeSchedule(filtered, readConfig());
}

/** Return all SCHEDULED entries whose scheduled time is <= now (UTC). */
export function getDueTweets(nowUtc: Date, tz: string): ScheduledTweet[] {
  return readSchedule().filter(e => {
    if (e.status !== 'SCHEDULED') return false;
    try {
      return parseLocalTime(e.scheduled, tz) <= nowUtc;
    } catch {
      return false;
    }
  });
}
