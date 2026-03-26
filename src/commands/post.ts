import { readConfig, formatLocalTime, parseLocalTime } from '../utils/config';
import { readSchedule, updateScheduleStatus } from '../utils/schedule';
import { archiveTweet } from '../utils/tweets';
import { postTweet, postReply } from '../utils/twitter';
import { statusCommand } from './status';

export async function postCommand(): Promise<void> {
  const config = readConfig();
  const { timezone, thread_followup, thread_followup_text } = config;
  const nowUtc = new Date();

  const schedule = readSchedule();
  const dueTweets = schedule.filter(e => {
    if (e.status !== 'SCHEDULED') return false;
    try {
      return parseLocalTime(e.scheduled, timezone) <= nowUtc;
    } catch {
      return false;
    }
  });

  if (dueTweets.length === 0) {
    console.log('No tweets due right now.');
    await statusCommand();
    return;
  }

  console.log(`Found ${dueTweets.length} tweet(s) due for posting.`);

  let posted = 0;
  let failed = 0;

  for (const entry of dueTweets) {
    try {
      console.log(`Posting ${entry.repo}#${entry.tweetNumber}: "${entry.text.slice(0, 60)}..."`);
      const tweetId = await postTweet(entry.text);

      // Post follow-up reply if enabled
      if (thread_followup !== false && thread_followup_text) {
        try {
          await postReply(thread_followup_text, tweetId);
        } catch (replyErr) {
          // Non-fatal — main tweet already posted
          console.warn(`  Warning: follow-up reply failed: ${(replyErr as Error).message}`);
        }
      }

      const postedAt = formatLocalTime(nowUtc, timezone);

      // Mark POSTED in schedule
      updateScheduleStatus(entry.repo, entry.tweetNumber, 'POSTED');

      // Move from tweets.md → posted.md
      archiveTweet(entry.repo, entry.tweetNumber, postedAt);

      console.log(`  ✓ Posted`);
      posted++;

      // Small delay between posts to respect rate limits
      if (dueTweets.indexOf(entry) < dueTweets.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error(`  ✗ Failed to post ${entry.repo}#${entry.tweetNumber}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${posted} posted, ${failed} failed.`);
  await statusCommand();
}
