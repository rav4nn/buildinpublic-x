import { readRepos, readConfig, formatLocalTime, parseTzOffset } from '../utils/config';
import { readTweets, updateTweetStatus } from '../utils/tweets';
import { readSchedule, writeSchedule, ScheduledTweet } from '../utils/schedule';

export async function approveCommand(): Promise<void> {
  const repos = readRepos();
  const config = readConfig();
  const { timezone, old_post_times } = config;
  const tzOffsetMin = parseTzOffset(timezone);

  if (old_post_times.length === 0) {
    console.error('No old_post_times configured. Add at least one time to config.yml');
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

  // Find the next available slot: today's remaining slots first, then tomorrow onwards.
  // Add a 30-minute buffer so there's time to review and deploy before the first tweet posts.
  const nowUtc = new Date();
  const nowLocalMs = nowUtc.getTime() + tzOffsetMin * 60 * 1000;
  const todayLocalMidnightMs = new Date(nowLocalMs).setUTCHours(0, 0, 0, 0);
  const nowLocalMinutes = new Date(nowLocalMs).getUTCHours() * 60 + new Date(nowLocalMs).getUTCMinutes();
  const bufferMinutes = 30;

  // Find the first slot today that's still at least 30 min away
  let startDayMs = todayLocalMidnightMs;
  let startSlotIndex = old_post_times.findIndex(t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m > nowLocalMinutes + bufferMinutes;
  });

  if (startSlotIndex === -1) {
    // No slots left today — start from tomorrow
    startDayMs = todayLocalMidnightMs + 24 * 60 * 60 * 1000;
    startSlotIndex = 0;
  }

  // Assign each tweet to a slot, spilling to the next day when all slots are filled
  const newEntries: ScheduledTweet[] = [];
  for (let i = 0; i < allPending.length; i++) {
    const absoluteSlot = startSlotIndex + i;
    const dayIndex = Math.floor(absoluteSlot / old_post_times.length);
    const slotIndex = absoluteSlot % old_post_times.length;
    const [hours, minutes] = old_post_times[slotIndex].split(':').map(Number);
    const slotUtcMs = startDayMs + dayIndex * 86400000 - tzOffsetMin * 60 * 1000 + hours * 3600000 + minutes * 60000;
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
