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

/** Parse {repo}-tweets.md into Tweet objects. */
export function readTweets(repo: string): Tweet[] {
  const file = tweetsFile(repo);
  if (!fs.existsSync(file)) return [];
  return parseTweetsMd(fs.readFileSync(file, 'utf-8'));
}

/** Parse a tweets markdown string into Tweet objects. */
export function parseTweetsMd(content: string): Tweet[] {
  const tweets: Tweet[] = [];
  // Split on separator lines; each block is one tweet
  const blocks = content.split(/\n---\n/).map(b => b.trim()).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    let number = 0;
    let status: TweetStatus = 'PENDING';
    let source = '';
    let scheduled: string | undefined;
    const textLines: string[] = [];

    for (const line of lines) {
      const headerMatch = line.match(/^## Tweet (\d+)/);
      if (headerMatch) { number = parseInt(headerMatch[1], 10); continue; }

      const statusMatch = line.match(/^\*\*Status:\*\* (.+)/);
      if (statusMatch) { status = statusMatch[1].trim() as TweetStatus; continue; }

      const sourceMatch = line.match(/^\*\*Source:\*\* (.+)/);
      if (sourceMatch) { source = sourceMatch[1].trim(); continue; }

      const scheduledMatch = line.match(/^\*\*Scheduled:\*\* (.+)/);
      if (scheduledMatch) { scheduled = scheduledMatch[1].trim(); continue; }

      textLines.push(line);
    }

    if (number > 0) {
      tweets.push({ number, status, source, scheduled, text: textLines.join('\n').trim() });
    }
  }

  return tweets;
}

/** Serialize Tweet objects back to markdown. */
export function serializeTweetsMd(tweets: Tweet[]): string {
  return tweets.map(t => {
    const lines = [`## Tweet ${t.number}`, `**Status:** ${t.status}`];
    if (t.scheduled) lines.push(`**Scheduled:** ${t.scheduled}`);
    lines.push(`**Source:** ${t.source}`, t.text);
    return lines.join('\n');
  }).join('\n---\n') + (tweets.length ? '\n---\n' : '');
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
  const appendContent = newTweets.map(t => {
    const lines = [`## Tweet ${t.number}`, `**Status:** ${t.status}`];
    if (t.scheduled) lines.push(`**Scheduled:** ${t.scheduled}`);
    lines.push(`**Source:** ${t.source}`, t.text);
    return lines.join('\n');
  }).join('\n---\n') + '\n---\n';
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

  // Append to posted.md
  ensureDir(repo);
  const file = postedFile(repo);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const entry = [
    `## Tweet ${tweet.number}`,
    `**Posted:** ${postedAt}`,
    `**Source:** ${tweet.source}`,
    tweet.text,
  ].join('\n') + '\n---\n';
  fs.writeFileSync(file, existing + entry, 'utf-8');
}

/** Count tweets by status across the posted archive (all count as POSTED). */
export function countPosted(repo: string): number {
  const file = postedFile(repo);
  if (!fs.existsSync(file)) return 0;
  const content = fs.readFileSync(file, 'utf-8');
  return (content.match(/^## Tweet /gm) ?? []).length;
}

/** Return the highest tweet number used in tweets.md (or 0 if file is empty). */
export function maxTweetNumber(repo: string): number {
  const tweets = readTweets(repo);
  return tweets.reduce((max, t) => Math.max(max, t.number), 0);
}
