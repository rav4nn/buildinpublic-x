import * as fs from 'fs';
import * as path from 'path';
import { readConfig, parseTzOffset, formatLocalTime } from '../utils/config';
import { readSchedule, writeSchedule, ScheduledTweet } from '../utils/schedule';
import { fetchCommand } from './fetch';
import { generateDigestTweet } from '../llm/index';
import { CommitsCache } from '../utils/github';

const ATTRIBUTION_TOOL = 'buildinpublic-x';
export const DIGEST_STATE_FILE = '.digest-state.json';

export function getLastDigestAt(cwd: string): Date | null {
  const stateFile = path.join(cwd, DIGEST_STATE_FILE);
  if (!fs.existsSync(stateFile)) return null;
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  return state.lastDigestAt ? new Date(state.lastDigestAt) : null;
}

export async function digestCommand(args: string[]): Promise<void> {
  const config = readConfig();

  if (config.paused) {
    console.log('Paused. Set paused: false in config.yml to resume.');
    return;
  }

  if (!config.tracked_repos || config.tracked_repos.length === 0) {
    console.log('No tracked_repos set in config.yml. Add repos to monitor:\n\ntracked_repos:\n  - your-repo-name');
    return;
  }

  const preview = args.includes('preview');
  const force = args.includes('force');
  const daysArg = args.find(a => /^\d+$/.test(a));
  const days = daysArg ? parseInt(daysArg, 10) : (config.digest_days ?? 1);

  if (isNaN(days) || days < 1) {
    console.error('Usage: npm run digest [days] [preview|force]');
    process.exit(1);
  }

  const { github_owner, timezone, digest_time, thread_followup_text } = config;
  if (!github_owner) throw new Error('github_owner not set in config.yml');

  // Cutoff = when the last digest was POSTED (written by post.ts, not here).
  // This means you can delete a scheduled digest and regenerate it without losing commits.
  // Falls back to days * 24h ago on first run.
  const cwd = process.cwd();
  const lastDigestAt = getLastDigestAt(cwd);
  const cutoff = lastDigestAt ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Warn if there's already a digest in the schedule (unless --force)
  const existingSchedule = readSchedule();
  const existingDigest = existingSchedule.find(e => e.repo === 'digest' && e.status === 'SCHEDULED');
  if (existingDigest && !preview && !force) {
    console.log(`Digest already scheduled for ${existingDigest.scheduled}.`);
    console.log('  Run: npm run digest preview   — to preview the current digest');
    console.log('  Run: npm run digest force     — to replace it with a fresh one');
    return;
  }

  console.log(`\nDigest: scanning commits since ${cutoff.toISOString()} across ${config.tracked_repos.length} repo(s)...\n`);

  const repoTweets: Array<{ repo: string; tweet: string }> = [];

  for (const repoName of config.tracked_repos.filter(Boolean)) {
    process.stdout.write(`  ${repoName}: fetching commits... `);
    await fetchCommand([repoName]);

    const cacheFile = path.join(cwd, repoName, 'commits.json');
    if (!fs.existsSync(cacheFile)) {
      console.log('no cache found, skipping');
      continue;
    }

    const cache: CommitsCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const recentCommits = cache.commits.filter(c => new Date(c.date) >= cutoff);

    if (recentCommits.length === 0) {
      console.log(`no commits since last digest, skipping`);
      continue;
    }

    console.log(`${recentCommits.length} commit(s) found`);
    const tweet = await generateDigestTweet(repoName, cache.readme, recentCommits);
    repoTweets.push({ repo: repoName, tweet });
  }

  if (repoTweets.length === 0) {
    console.log(`\nNo commits since last digest. Nothing to post.`);
    return;
  }

  // Attribution tweet — always the final reply
  const attribution = thread_followup_text ?? `~ posted using ${ATTRIBUTION_TOOL}`;
  const projectLinks = repoTweets
    .map(r => `https://github.com/${github_owner}/${r.repo}`)
    .join('\n');
  const attributionTweet = `${attribution}\nFind my projects at:\n${projectLinks}`;

  const mainText = repoTweets[0].tweet;
  const threadReplies = [
    ...repoTweets.slice(1).map(r => r.tweet),
    attributionTweet,
  ];

  // Schedule at digest_time — today if still in the future, otherwise tomorrow
  const time = digest_time ?? '21:00';
  const tzOffsetMin = parseTzOffset(timezone);
  const nowUtc = new Date();
  const nowLocalMs = nowUtc.getTime() + tzOffsetMin * 60 * 1000;
  const todayLocalMidnightMs = new Date(nowLocalMs).setUTCHours(0, 0, 0, 0);
  const nowLocalMinutes = new Date(nowLocalMs).getUTCHours() * 60 + new Date(nowLocalMs).getUTCMinutes();
  const [hours, minutes] = time.split(':').map(Number);
  const targetMinutes = hours * 60 + minutes;
  const dayMs = targetMinutes > nowLocalMinutes + 5
    ? todayLocalMidnightMs
    : todayLocalMidnightMs + 24 * 60 * 60 * 1000;
  const slotUtcMs = dayMs - tzOffsetMin * 60 * 1000 + hours * 3600000 + minutes * 60000;
  const scheduled = formatLocalTime(new Date(slotUtcMs), timezone);

  // Print preview (always shown)
  console.log(`\n  Scheduled for: ${scheduled}`);
  console.log('\n--- Thread preview ---\n');
  console.log(`Tweet:\n${mainText}`);
  for (let i = 0; i < threadReplies.length; i++) {
    const label = i === threadReplies.length - 1 ? 'Reply (attribution)' : `Reply ${i + 1}`;
    console.log(`\n${label}:\n${threadReplies[i]}`);
  }
  console.log('\n----------------------');

  if (preview) {
    console.log('\n  Preview only — nothing scheduled. Run npm run digest to schedule.');
    return;
  }

  // Replace existing digest entry if force, otherwise append
  const withoutExisting = existingSchedule.filter(e => !(e.repo === 'digest' && e.status === 'SCHEDULED'));
  const maxDigestNum = existingSchedule
    .filter(e => e.repo === 'digest')
    .reduce((max, e) => Math.max(max, e.tweetNumber), 0);

  const newEntry: ScheduledTweet = {
    repo: 'digest',
    tweetNumber: force && existingDigest ? existingDigest.tweetNumber : maxDigestNum + 1,
    status: 'SCHEDULED',
    scheduled,
    text: mainText,
    thread: threadReplies,
  };

  writeSchedule([...withoutExisting.filter(e => e.status === 'SCHEDULED'), newEntry], config);

  console.log(`\n✓ Digest #${newEntry.tweetNumber} scheduled for ${scheduled}`);
  console.log('  Review/edit schedule-twitter.txt, then run: npm run deploy');
}
