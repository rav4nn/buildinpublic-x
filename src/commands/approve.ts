import { execSync } from 'child_process';
import { readRepos, readConfig, formatLocalTime, parseTzOffset } from '../utils/config';
import { readTweets, updateTweetStatus } from '../utils/tweets';
import { readSchedule, writeSchedule, ScheduledTweet } from '../utils/schedule';

/** Evenly distribute N slots across an 8am–10pm window, returning hour offsets. */
function dailySlotHours(tweetsPerDay: number): number[] {
  if (tweetsPerDay <= 0) return [];
  const START = 8;   // 8am
  const END = 22;    // 10pm
  const window = END - START;
  if (tweetsPerDay === 1) return [START + window / 2]; // noon-ish
  return Array.from({ length: tweetsPerDay }, (_, i) =>
    START + (i * window) / (tweetsPerDay - 1)
  );
}

export async function approveCommand(): Promise<void> {
  const repos = readRepos();
  const config = readConfig();
  const { timezone, max_tweets_per_day } = config;
  const tzOffsetMin = parseTzOffset(timezone);

  // Collect all PENDING tweets per repo
  const pendingByRepo: Record<string, Array<{ tweetNumber: number; text: string }>> = {};
  let totalPending = 0;

  for (const r of repos) {
    const tweets = readTweets(r.repo).filter(t => t.status === 'PENDING');
    if (tweets.length > 0) {
      pendingByRepo[r.repo] = tweets.map(t => ({ tweetNumber: t.number, text: t.text }));
      totalPending += tweets.length;
    }
  }

  if (totalPending === 0) {
    console.log('No PENDING tweets found. Run: npm run generate -- <repo>');
    return;
  }

  console.log(`Found ${totalPending} pending tweet(s) across ${Object.keys(pendingByRepo).length} repo(s).`);

  // Build a day-by-day schedule starting from tomorrow 00:00 UTC
  const nowUtc = new Date();
  // Start of tomorrow in local timezone = midnight local + 1 day
  const tomorrowLocalMidnightMs =
    new Date(nowUtc.getTime() + tzOffsetMin * 60 * 1000).setUTCHours(0, 0, 0, 0) +
    24 * 60 * 60 * 1000;

  const newEntries: ScheduledTweet[] = [];

  // Pointer per repo into their pending list
  const pointers: Record<string, number> = {};
  for (const repo of Object.keys(pendingByRepo)) pointers[repo] = 0;

  const repoConfigs = Object.fromEntries(repos.map(r => [r.repo, r]));
  let day = 0;

  while (true) {
    // Check if all repos exhausted
    const allDone = Object.keys(pendingByRepo).every(
      repo => pointers[repo] >= pendingByRepo[repo].length
    );
    if (allDone) break;

    // For this day, allocate slots per repo up to max_tweets_per_day total
    const dayTweets: Array<{ repo: string; tweetNumber: number; text: string; slotHour: number }> = [];

    for (const repo of Object.keys(pendingByRepo)) {
      const rc = repoConfigs[repo];
      const slots = dailySlotHours(rc.tweets_per_day);
      for (const hour of slots) {
        const idx = pointers[repo];
        if (idx >= pendingByRepo[repo].length) break;
        if (dayTweets.length >= max_tweets_per_day) break;
        dayTweets.push({ repo, tweetNumber: pendingByRepo[repo][idx].tweetNumber, text: pendingByRepo[repo][idx].text, slotHour: hour });
        pointers[repo]++;
      }
      if (dayTweets.length >= max_tweets_per_day) break;
    }

    for (const slot of dayTweets) {
      const hourInt = Math.floor(slot.slotHour);
      const minuteInt = Math.round((slot.slotHour - hourInt) * 60);
      const slotUtcMs = tomorrowLocalMidnightMs + day * 86400000 - tzOffsetMin * 60 * 1000 + hourInt * 3600000 + minuteInt * 60000;
      const slotUtcDate = new Date(slotUtcMs);
      const scheduled = formatLocalTime(slotUtcDate, timezone);

      newEntries.push({
        repo: slot.repo,
        tweetNumber: slot.tweetNumber,
        status: 'SCHEDULED',
        scheduled,
        text: slot.text,
      });
    }

    day++;
    if (day > 365) break; // safety cap
  }

  // Merge with existing SCHEDULED entries (keep them, append new)
  const existing = readSchedule().filter(e => e.status === 'SCHEDULED');
  const existingKeys = new Set(existing.map(e => `${e.repo}#${e.tweetNumber}`));
  const merged = [
    ...existing,
    ...newEntries.filter(e => !existingKeys.has(`${e.repo}#${e.tweetNumber}`)),
  ];
  writeSchedule(merged);

  // Update status in each {repo}-tweets.md to SCHEDULED
  for (const entry of newEntries) {
    updateTweetStatus(entry.repo, entry.tweetNumber, 'SCHEDULED', entry.scheduled);
  }

  console.log(`✓ Scheduled ${newEntries.length} tweet(s) — see schedule-twitter.md`);

  try {
    execSync('git add -A', { stdio: 'pipe' });
    const staged = execSync('git diff --staged --name-only', { encoding: 'utf-8' }).trim();
    if (staged) {
      execSync('git commit -m "chore: schedule tweets [skip ci]"', { stdio: 'inherit' });
      execSync('git pull --rebase --autostash origin main', { stdio: 'pipe' });
      execSync('git push origin main', { stdio: 'inherit' });
      console.log('✓ Pushed — tweets are live and will post on schedule');
    } else {
      console.log('  Nothing new to push (schedule unchanged).');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: git push failed — push manually to deploy the schedule.\n  ${msg}`);
  }
}
