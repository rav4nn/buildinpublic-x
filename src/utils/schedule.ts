import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, formatLocalTime, parseLocalTime } from './config';

export type ScheduleStatus = 'SCHEDULED' | 'POSTED';

export interface ScheduledTweet {
  repo: string;
  tweetNumber: number;
  status: ScheduleStatus;
  scheduled: string; // "YYYY-MM-DD HH:MM GMT±X" (internal format)
  text: string;
}

const SCHEDULE_FILE = 'schedule-twitter.txt';
const SEP = '-'.repeat(89);

function scheduleFile(): string {
  return path.join(process.cwd(), SCHEDULE_FILE);
}

/**
 * Convert internal scheduled string "YYYY-MM-DD HH:MM GMT±X"
 * to display format "DD-MM-YYYY | HH:MM (GMT±X)"
 */
function toDisplayDate(scheduled: string): string {
  const m = scheduled.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}) (.+)$/);
  if (!m) return scheduled;
  return `${m[3]}-${m[2]}-${m[1]} | ${m[4]} (${m[5]})`;
}

/**
 * Convert display format "DD-MM-YYYY | HH:MM (GMT±X)"
 * back to internal "YYYY-MM-DD HH:MM GMT±X"
 */
function fromDisplayDate(display: string): string | null {
  const m = display.match(/^(\d{2})-(\d{2})-(\d{4}) \| (\d{2}:\d{2}) \(([^)]+)\)$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]} ${m[4]} ${m[5]}`;
}

/** Parse schedule-twitter.txt into ScheduledTweet objects. */
export function readSchedule(): ScheduledTweet[] {
  const file = scheduleFile();
  if (!fs.existsSync(file)) return [];
  return parseScheduleTxt(fs.readFileSync(file, 'utf-8'));
}

/**
 * Parse the plain-text schedule format.
 * Entry header: "repo #N | DD-MM-YYYY | HH:MM (GMT±X)"
 * Comment lines (starting with #) are only skipped before the first entry.
 * Separator lines (---...) are ignored.
 * Supports legacy format too: "YYYY-MM-DD HH:MM GMT±X | repo #N"
 */
export function parseScheduleTxt(content: string): ScheduledTweet[] {
  const entries: ScheduledTweet[] = [];
  const lines = content.split('\n');

  let headerSectionDone = false;
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
    // Skip comment lines only in the file header (before any entry)
    if (!headerSectionDone && line.startsWith('#')) continue;

    // Skip separator lines (structural, not content)
    if (/^-{10,}$/.test(line)) continue;

    // New format header: "repo #N | DD-MM-YYYY | HH:MM (GMT±X)"
    const newHeader = line.match(/^(\S+) #(\d+) \| (\d{2}-\d{2}-\d{4} \| \d{2}:\d{2} \([^)]+\))\s*$/);
    if (newHeader) {
      headerSectionDone = true;
      flush();
      currentRepo = newHeader[1];
      currentNumber = parseInt(newHeader[2], 10);
      currentScheduled = fromDisplayDate(newHeader[3]) ?? newHeader[3];
      continue;
    }

    // Legacy format header: "YYYY-MM-DD HH:MM GMT±X | repo #N"
    const legacyHeader = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2} \S+) \| (\S+) #(\d+)$/);
    if (legacyHeader) {
      headerSectionDone = true;
      flush();
      currentScheduled = legacyHeader[1];
      currentRepo = legacyHeader[2];
      currentNumber = parseInt(legacyHeader[3], 10);
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

/** Serialize a single schedule entry (new visual format). */
function serializeEntry(e: ScheduledTweet): string {
  return `${e.repo} #${e.tweetNumber} | ${toDisplayDate(e.scheduled)}\n\n${e.text}`;
}

/** Write all SCHEDULED entries to schedule-twitter.txt with a summary header. */
export function writeSchedule(entries: ScheduledTweet[], config: AppConfig): void {
  const scheduled = entries.filter(e => e.status === 'SCHEDULED');
  const sorted = [...scheduled].sort((a, b) => a.scheduled.localeCompare(b.scheduled));
  const header = buildHeader(sorted, config);
  const body = sorted.length
    ? SEP + '\n\n' + sorted.map(serializeEntry).join('\n\n' + SEP + '\n\n') + '\n\n' + SEP + '\n'
    : '';
  fs.writeFileSync(scheduleFile(), header + body, 'utf-8');
}

/** Remove a posted entry from the schedule file. */
export function removeScheduleEntry(repo: string, tweetNumber: number): void {
  const entries = readSchedule();
  const filtered = entries.filter(e => !(e.repo === repo && e.tweetNumber === tweetNumber));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readConfig } = require('./config');
  writeSchedule(filtered, readConfig());
}

/** Validate schedule entries and return a list of human-readable error messages. */
export function validateSchedule(entries: ScheduledTweet[], knownRepos: string[]): string[] {
  const errors: string[] = [];
  const nowUtc = new Date();
  const seenSlots = new Map<string, string>(); // "repo::scheduled" → label

  for (const e of entries) {
    const label = `${e.repo} #${e.tweetNumber}`;

    // Unknown repo
    if (!knownRepos.includes(e.repo)) {
      errors.push(`${label}: repo "${e.repo}" not found in repos.yml — add it or remove the entry`);
    }

    // Parse and validate the datetime
    let scheduledDate: Date | null = null;
    try {
      const tzMatch = e.scheduled.match(/(\S+)$/);
      const tz = tzMatch ? tzMatch[1] : 'GMT+0';
      scheduledDate = parseLocalTime(e.scheduled, tz);
      if (isNaN(scheduledDate.getTime())) throw new Error('invalid date');
    } catch {
      errors.push(`${label}: invalid datetime "${e.scheduled}" — expected format: DD-MM-YYYY | HH:MM (GMT±X)`);
    }

    if (scheduledDate) {
      // Past datetime
      if (scheduledDate < nowUtc) {
        errors.push(`${label}: scheduled time "${e.scheduled}" is in the past — update or remove it`);
      }

      // Posting between midnight and 6am (warn, not hard error)
      const hourMatch = e.scheduled.match(/^\d{4}-\d{2}-\d{2} (\d{2}):\d{2}/);
      if (hourMatch) {
        const localHour = parseInt(hourMatch[1], 10);
        if (localHour < 6) {
          errors.push(`${label}: scheduled at ${hourMatch[1]}:xx — posting between midnight and 6am, is this intentional?`);
        }
      }
    }

    // Duplicate slot for same repo
    const slotKey = `${e.repo}::${e.scheduled}`;
    if (seenSlots.has(slotKey)) {
      errors.push(`${label}: duplicate time "${e.scheduled}" — same repo already has a tweet at this slot`);
    } else {
      seenSlots.set(slotKey, label);
    }

    // Tweet over 280 chars
    if (e.text.length > 280) {
      errors.push(`${label}: tweet is ${e.text.length} chars (max 280) — shorten it before deploying`);
    }
  }

  return errors;
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
