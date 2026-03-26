import * as fs from 'fs';
import * as path from 'path';

export type TweetStatus = 'PENDING' | 'SCHEDULED' | 'POSTED';

export interface Tweet {
  number: number;
  status: TweetStatus;
  source: string;
  scheduled?: string; // "YYYY-MM-DD HH:MM GMT±X"
  text: string;
}

function repoDir(repo: string): string {
  return path.join(process.cwd(), repo);
}

function tweetsFile(repo: string): string {
  return path.join(repoDir(repo), `${repo}-tweets.md`);
}

function postedFile(repo: string): string {
  return path.join(repoDir(repo), `${repo}-posted.md`);
}

function ensureDir(repo: string): void {
  const dir = repoDir(repo);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toDisplayStatus(status: TweetStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase(); // PENDING → Pending
}

function fromDisplayStatus(s: string): TweetStatus {
  return s.toUpperCase() as TweetStatus;
}

/** Serialize a single tweet block. */
function serializeBlock(t: Tweet): string {
  const lines = [`Tweet ${t.number}-`, `Status: ${toDisplayStatus(t.status)}`];
  if (t.scheduled) lines.push(`Scheduled: ${t.scheduled}`);
  lines.push(`Source: ${t.source}`, `Tweet Text:`, t.text);
  return lines.join('\n');
}

/** Parse {repo}-tweets.md into Tweet objects. Supports both old and new format. */
export function parseTweetsMd(content: string): Tweet[] {
  const tweets: Tweet[] = [];
  const blocks = content.split(/\n---\n/).map(b => b.trim()).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    let number = 0;
    let status: TweetStatus = 'PENDING';
    let source = '';
    let scheduled: string | undefined;
    const textLines: string[] = [];
    let inText = false;

    for (const line of lines) {
      // New format header: "Tweet N-"
      const newHeader = line.match(/^Tweet (\d+)-$/);
      if (newHeader) { number = parseInt(newHeader[1], 10); continue; }

      // Old format header: "## Tweet N"
      const oldHeader = line.match(/^## Tweet (\d+)/);
      if (oldHeader) { number = parseInt(oldHeader[1], 10); continue; }

      // "Tweet Text:" label — everything after this is tweet body
      if (line === 'Tweet Text:') { inText = true; continue; }

      if (inText) { textLines.push(line); continue; }

      // New format fields
      const statusNew = line.match(/^Status: (.+)/);
      if (statusNew) { status = fromDisplayStatus(statusNew[1].trim()); continue; }

      const sourceNew = line.match(/^Source: (.+)/);
      if (sourceNew) { source = sourceNew[1].trim(); continue; }

      const scheduledNew = line.match(/^Scheduled: (.+)/);
      if (scheduledNew) { scheduled = scheduledNew[1].trim(); continue; }

      // Old format fields (bold markdown)
      const statusOld = line.match(/^\*\*Status:\*\* (.+)/);
      if (statusOld) { status = statusOld[1].trim() as TweetStatus; continue; }

      const sourceOld = line.match(/^\*\*Source:\*\* (.+)/);
      if (sourceOld) { source = sourceOld[1].trim(); continue; }

      const scheduledOld = line.match(/^\*\*Scheduled:\*\* (.+)/);
      if (scheduledOld) { scheduled = scheduledOld[1].trim(); continue; }

      // Old format: lines after metadata were tweet body (no "Tweet Text:" label)
      if (!inText && number > 0 && source) textLines.push(line);
    }

    if (number > 0) {
      tweets.push({ number, status, source, scheduled, text: textLines.join('\n').trim() });
    }
  }

  return tweets;
}

/** Serialize Tweet objects back to the clean format. */
export function serializeTweetsMd(tweets: Tweet[]): string {
  return tweets.map(serializeBlock).join('\n---\n') + (tweets.length ? '\n---\n' : '');
}

/** Write Tweet objects to {repo}-tweets.md, overwriting the file. */
export function writeTweets(repo: string, tweets: Tweet[]): void {
  ensureDir(repo);
  fs.writeFileSync(tweetsFile(repo), serializeTweetsMd(tweets), 'utf-8');
}

/** Append new tweets to {repo}-tweets.md without touching existing content. */
export function appendTweets(repo: string, newTweets: Tweet[]): void {
  ensureDir(repo);
  const file = tweetsFile(repo);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const separator = existing.endsWith('\n---\n') || existing === '' ? '' : '\n---\n';
  const appendContent = newTweets.map(serializeBlock).join('\n---\n') + '\n---\n';
  fs.writeFileSync(file, existing + separator + appendContent, 'utf-8');
}

/** Update a single tweet's status (and optionally scheduled) in place. */
export function updateTweetStatus(
  repo: string,
  tweetNumber: number,
  status: TweetStatus,
  scheduled?: string
): void {
  const tweets = readTweets(repo);
  const tweet = tweets.find(t => t.number === tweetNumber);
  if (!tweet) throw new Error(`Tweet #${tweetNumber} not found in ${repo}-tweets.md`);
  tweet.status = status;
  if (scheduled !== undefined) tweet.scheduled = scheduled;
  writeTweets(repo, tweets);
}

/** Remove a tweet from {repo}-tweets.md and append it to {repo}-posted.md. */
export function archiveTweet(repo: string, tweetNumber: number, postedAt: string): void {
  const tweets = readTweets(repo);
  const idx = tweets.findIndex(t => t.number === tweetNumber);
  if (idx === -1) throw new Error(`Tweet #${tweetNumber} not found in ${repo}-tweets.md`);
  const [tweet] = tweets.splice(idx, 1);
  writeTweets(repo, tweets);

  ensureDir(repo);
  const file = postedFile(repo);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const entry = [
    `Tweet ${tweet.number}-`,
    `Posted: ${postedAt}`,
    `Source: ${tweet.source}`,
    `Tweet Text:`,
    tweet.text,
  ].join('\n') + '\n---\n';
  fs.writeFileSync(file, existing + entry, 'utf-8');
}

/** Count tweets in the posted archive. */
export function countPosted(repo: string): number {
  const file = postedFile(repo);
  if (!fs.existsSync(file)) return 0;
  const content = fs.readFileSync(file, 'utf-8');
  return (content.match(/^Tweet \d+-$/gm) ?? []).length;
}

/** Read {repo}-tweets.md into Tweet objects. */
export function readTweets(repo: string): Tweet[] {
  const file = tweetsFile(repo);
  if (!fs.existsSync(file)) return [];
  return parseTweetsMd(fs.readFileSync(file, 'utf-8'));
}

/** Return the highest tweet number used in tweets.md (or 0 if file is empty). */
export function maxTweetNumber(repo: string): number {
  const tweets = readTweets(repo);
  return tweets.reduce((max, t) => Math.max(max, t.number), 0);
}
