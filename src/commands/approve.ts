import { readRepos, readConfig, formatLocalTime, parseTzOffset } from '../utils/config';
import { readTweets, updateTweetStatus } from '../utils/tweets';
import { readSchedule, writeSchedule, ScheduledTweet } from '../utils/schedule';

export async function approveCommand(): Promise<void> {
  const repos = readRepos();
  const config = readConfig();
  const { timezone, post_times } = config;
  const tzOffsetMin = parseTzOffset(timezone);

  if (post_times.length === 0) {
    console.error('No post_times configured. Add at least one time to config.yml');
    process.exit(1);
  }

  // Collect PENDING tweets, plus SCHEDULED tweets orphaned from a deleted schedule file
  const existingSchedule = readSchedule();
  const scheduledKeys = new Set(existingSchedule.map(e => `${e.repo}#${e.tweetNumber}`));

  const pendingByRepo: Record<string, Array<{ tweetNumber: number; text: string }>> = {};
  let totalPending = 0;

  for (const r of repos) {
    const tweets = readTweets(r.repo).filter(t =>
      t.status === 'PENDING' ||
      (t.status === 'SCHEDULED' && !scheduledKeys.has(`${r.repo}#${t.number}`))
    );
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

  // Interleave tweets round-robin across repos
  const allPending: Array<{ repo: string; tweetNumber: number; text: string }> = [];
  const repoKeys = Object.keys(pendingByRepo);
  const maxLen = Math.max(...repoKeys.map(r => pendingByRepo[r].length));
  for (let i = 0; i < maxLen; i++) {
    for (const repo of repoKeys) {
      if (i < pendingByRepo[repo].length) {
        allPending.push({ repo, tweetNumber: pendingByRepo[repo][i].tweetNumber, text: pendingByRepo[repo][i].text });
      }
    }
  }

  // Start of tomorrow in local timezone
  const nowUtc = new Date();
  const tomorrowLocalMidnightMs =
    new Date(nowUtc.getTime() + tzOffsetMin * 60 * 1000).setUTCHours(0, 0, 0, 0) +
    24 * 60 * 60 * 1000;

  // Assign each tweet to a post_times slot, spilling to the next day when all slots are filled
  const newEntries: ScheduledTweet[] = [];
  for (let i = 0; i < allPending.length; i++) {
    const dayIndex = Math.floor(i / post_times.length);
    const slotIndex = i % post_times.length;
    const [hours, minutes] = post_times[slotIndex].split(':').map(Number);
    const slotUtcMs = tomorrowLocalMidnightMs + dayIndex * 86400000 - tzOffsetMin * 60 * 1000 + hours * 3600000 + minutes * 60000;
    const scheduled = formatLocalTime(new Date(slotUtcMs), timezone);

    const item = allPending[i];
    newEntries.push({ repo: item.repo, tweetNumber: item.tweetNumber, status: 'SCHEDULED', scheduled, text: item.text });
  }

  // Merge with existing SCHEDULED entries
  const existing = existingSchedule.filter(e => e.status === 'SCHEDULED');
  const existingKeys = new Set(existing.map(e => `${e.repo}#${e.tweetNumber}`));
  const merged = [
    ...existing,
    ...newEntries.filter(e => !existingKeys.has(`${e.repo}#${e.tweetNumber}`)),
  ];
  writeSchedule(merged, config);

  // Update status in each tweets.txt to SCHEDULED
  for (const entry of newEntries) {
    updateTweetStatus(entry.repo, entry.tweetNumber, 'SCHEDULED', entry.scheduled);
  }

  const lastSlot = newEntries[newEntries.length - 1]?.scheduled ?? '';
  console.log(`✓ Scheduled ${newEntries.length} tweet(s) — queue runs through ${lastSlot}`);
  console.log(`  Review schedule-twitter.txt, edit times if needed, then run: npm run deploy`);
}
