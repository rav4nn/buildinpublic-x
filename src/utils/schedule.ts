import * as fs from 'fs';
import * as path from 'path';

export type ScheduleStatus = 'SCHEDULED' | 'POSTED';

export interface ScheduledTweet {
  repo: string;
  tweetNumber: number;
  status: ScheduleStatus;
  scheduled: string; // "YYYY-MM-DD HH:MM GMT±X"
  text: string;
}

const SCHEDULE_FILE = 'schedule-twitter.md';

function scheduleFile(): string {
  return path.join(process.cwd(), SCHEDULE_FILE);
}

/** Parse schedule-twitter.md into ScheduledTweet objects. */
export function readSchedule(): ScheduledTweet[] {
  const file = scheduleFile();
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf-8');
  return parseScheduleMd(content);
}

export function parseScheduleMd(content: string): ScheduledTweet[] {
  const entries: ScheduledTweet[] = [];
  const blocks = content.split(/\n---\n/).map(b => b.trim()).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    let repo = '';
    let tweetNumber = 0;
    let status: ScheduleStatus = 'SCHEDULED';
    let scheduled = '';
    const textLines: string[] = [];
    let inHeader = true;

    for (const line of lines) {
      // Section header: ## YYYY-MM-DD HH:MM GMT±X — repo — Tweet #N
      if (line.startsWith('## ')) {
        const m = line.match(/## .+ — (.+) — Tweet #(\d+)/);
        if (m) { repo = m[1]; tweetNumber = parseInt(m[2], 10); }
        continue;
      }

      const statusMatch = line.match(/^\*\*Status:\*\* (.+)/);
      if (statusMatch) { status = statusMatch[1].trim() as ScheduleStatus; inHeader = false; continue; }

      const repoMatch = line.match(/^\*\*Repo:\*\* (.+)/);
      if (repoMatch) { repo = repoMatch[1].trim(); continue; }

      const numMatch = line.match(/^\*\*Tweet #:\*\* (\d+)/);
      if (numMatch) { tweetNumber = parseInt(numMatch[1], 10); continue; }

      const scheduledMatch = line.match(/^\*\*Scheduled:\*\* (.+)/);
      if (scheduledMatch) { scheduled = scheduledMatch[1].trim(); continue; }

      if (!inHeader || (!line.startsWith('**'))) textLines.push(line);
    }

    if (repo && tweetNumber && scheduled) {
      entries.push({ repo, tweetNumber, status, scheduled, text: textLines.join('\n').trim() });
    }
  }

  return entries;
}

/** Serialize schedule entries to markdown. */
export function serializeScheduleMd(entries: ScheduledTweet[]): string {
  const header = '# Tweet Schedule\n\n';
  if (entries.length === 0) return header;

  const sorted = [...entries].sort((a, b) => a.scheduled.localeCompare(b.scheduled));
  const blocks = sorted.map(e => {
    return [
      `## ${e.scheduled} — ${e.repo} — Tweet #${e.tweetNumber}`,
      `**Status:** ${e.status}`,
      `**Repo:** ${e.repo}`,
      `**Tweet #:** ${e.tweetNumber}`,
      `**Scheduled:** ${e.scheduled}`,
      e.text,
    ].join('\n');
  });

  return header + blocks.join('\n---\n') + '\n---\n';
}

/** Write all schedule entries to schedule-twitter.md. */
export function writeSchedule(entries: ScheduledTweet[]): void {
  fs.writeFileSync(scheduleFile(), serializeScheduleMd(entries), 'utf-8');
}

/** Update a single entry's status in the schedule. */
export function updateScheduleStatus(
  repo: string,
  tweetNumber: number,
  status: ScheduleStatus
): void {
  const entries = readSchedule();
  const entry = entries.find(e => e.repo === repo && e.tweetNumber === tweetNumber);
  if (!entry) throw new Error(`Schedule entry ${repo}#${tweetNumber} not found`);
  entry.status = status;
  writeSchedule(entries);
}

/** Return all SCHEDULED entries whose scheduled time is <= now (UTC). */
export function getDueTweets(nowUtc: Date, tz: string): ScheduledTweet[] {
  const { parseLocalTime } = require('./config');
  return readSchedule().filter(e => {
    if (e.status !== 'SCHEDULED') return false;
    try {
      return parseLocalTime(e.scheduled, tz) <= nowUtc;
    } catch {
      return false;
    }
  });
}
