import * as fs from 'fs';
import * as path from 'path';
import { readConfig, parseTzOffset, formatLocalTime } from '../utils/config';
import { readSchedule, writeSchedule, ScheduledTweet } from '../utils/schedule';
import { fetchCommand } from './fetch';
import { generateDigestTweet } from '../llm/index';
import { CommitsCache } from '../utils/github';

const ATTRIBUTION_TOOL = 'buildinpublic-x';

export async function digestCommand(args: string[]): Promise<void> {
  const config = readConfig();

  if (config.paused) {
    console.log('Paused. Set paused: false in config.yml to resume.');
    return;
  }

  if (!config.tracked_repos || config.tracked_repos.length === 0) {
    console.error('No tracked_repos set in config.yml. Add the repos you want to monitor:');
    console.error('\ntracked_repos:\n  - your-repo-name\n  - another-repo');
    process.exit(1);
  }

  const preview = args.includes('preview');
  const daysArg = args.find(a => /^\d+$/.test(a));
  const days = daysArg ? parseInt(daysArg, 10) : (config.digest_days ?? 1);

  if (isNaN(days) || days < 1) {
    console.error('Usage: npm run digest [days] [preview]');
    process.exit(1);
  }

  const { github_owner, timezone, digest_time, thread_followup_text } = config;
  if (!github_owner) throw new Error('github_owner not set in config.yml');

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  cutoff.setUTCHours(0, 0, 0, 0);

  console.log(`\nDigest: scanning last ${days} day(s) across ${config.tracked_repos.length} repo(s)...\n`);

  const repoTweets: Array<{ repo: string; tweet: string }> = [];

  for (const repoName of config.tracked_repos) {
    process.stdout.write(`  ${repoName}: fetching commits... `);
    await fetchCommand([repoName]);

    const cacheFile = path.join(process.cwd(), repoName, 'commits.json');
    if (!fs.existsSync(cacheFile)) {
      console.log('no cache found, skipping');
      continue;
    }

    const cache: CommitsCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const recentCommits = cache.commits.filter(c => new Date(c.date) >= cutoff);

    if (recentCommits.length === 0) {
      console.log(`no commits in the last ${days} day(s), skipping`);
      continue;
    }

    console.log(`${recentCommits.length} commit(s) found`);
    const tweet = await generateDigestTweet(repoName, cache.readme, recentCommits);
    repoTweets.push({ repo: repoName, tweet });
  }

  if (repoTweets.length === 0) {
    console.log(`\nNo commits found in the last ${days} day(s). Nothing to digest.`);
    return;
  }

  // Attribution tweet — always the final reply in the thread
  const attribution = thread_followup_text ?? `~ posted using ${ATTRIBUTION_TOOL}`;
  const projectLinks = repoTweets
    .map(r => `https://github.com/${github_owner}/${r.repo}`)
    .join('\n');
  const attributionTweet = `${attribution}\nFind my projects at:\n${projectLinks}`;

  // Thread: first repo tweet is the main post, rest are replies, attribution is last
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

  // Assign digest number (increment from last)
  const existingSchedule = readSchedule();
  const maxDigestNum = existingSchedule
    .filter(e => e.repo === 'digest')
    .reduce((max, e) => Math.max(max, e.tweetNumber), 0);

  const newEntry: ScheduledTweet = {
    repo: 'digest',
    tweetNumber: maxDigestNum + 1,
    status: 'SCHEDULED',
    scheduled,
    text: mainText,
    thread: threadReplies,
  };

  // Print thread preview
  console.log('\n--- Thread preview ---\n');
  console.log(`Tweet:\n${mainText}`);
  for (let i = 0; i < threadReplies.length; i++) {
    const label = i === threadReplies.length - 1 ? 'Reply (attribution)' : `Reply ${i + 1}`;
    console.log(`\n${label}:\n${threadReplies[i]}`);
  }
  console.log('\n----------------------');

  if (preview) {
    console.log('\n  Preview only — nothing was scheduled. Run without --preview to schedule.');
    return;
  }

  const existing = existingSchedule.filter(e => e.status === 'SCHEDULED');
  writeSchedule([...existing, newEntry], config);

  // Record when this digest was generated so auto-generate can enforce digest_days interval
  const stateFile = path.join(process.cwd(), '.digest-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ lastDigestAt: new Date().toISOString() }, null, 2), 'utf-8');

  console.log(`\n✓ Digest #${newEntry.tweetNumber} scheduled for ${scheduled}`);
  console.log('  Review/edit schedule-twitter.txt, then run: npm run deploy');
}
