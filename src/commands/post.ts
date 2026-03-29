import { readConfig, formatLocalTime, parseLocalTime, findRepo } from '../utils/config';
import { readSchedule, removeScheduleEntry } from '../utils/schedule';
import { archiveTweet } from '../utils/tweets';
import { postTweet, postReply } from '../utils/twitter';
import { postBluesky, postBlueskyReply } from '../utils/bluesky';
import { statusCommand } from './status';

const ATTRIBUTION = 'github.com/rav4nn/buildinpublic-x';

export async function postCommand(): Promise<void> {
  const config = readConfig();

  if (config.paused) {
    console.log('Paused. Set paused: false in config.yml and push to resume.');
    return;
  }

  const { timezone, thread_followup, thread_followup_text, platforms } = config;
  const postToX = platforms.includes('x');
  const postToBsky = platforms.includes('bluesky');
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

  console.log(`Found ${dueTweets.length} tweet(s) due for posting. Platforms: ${platforms.join(', ')}`);

  let posted = 0;
  let failed = 0;

  for (const entry of dueTweets) {
    console.log(`Posting ${entry.repo}#${entry.tweetNumber}: "${entry.text.slice(0, 60)}..."`);
    let anySuccess = false;

    const isDigest = entry.repo === 'digest' || (entry.thread && entry.thread.length > 0);

    if (isDigest && entry.thread) {
      // Digest thread: chain all parts as replies
      if (postToX) {
        try {
          let parentId = await postTweet(entry.text);
          for (const part of entry.thread) {
            try {
              parentId = await postReply(part, parentId);
            } catch (replyErr) {
              console.warn(`  Warning: X thread reply failed: ${(replyErr as Error).message}`);
              break;
            }
          }
          console.log('  ✓ Posted to X (thread)');
          anySuccess = true;
        } catch (err) {
          console.error(`  ✗ X failed: ${(err as Error).message}`);
        }
      }

      if (postToBsky) {
        try {
          let rootRef = await postBluesky(entry.text);
          let parentRef = rootRef;
          for (const part of entry.thread) {
            try {
              parentRef = await postBlueskyReply(part, rootRef, parentRef);
            } catch (replyErr) {
              console.warn(`  Warning: Bluesky thread reply failed: ${(replyErr as Error).message}`);
              break;
            }
          }
          console.log('  ✓ Posted to Bluesky (thread)');
          anySuccess = true;
        } catch (err) {
          console.error(`  ✗ Bluesky failed: ${(err as Error).message}`);
        }
      }
    } else {
      // Normal single tweet with optional attribution reply
      const repoConfig = findRepo(entry.repo);
      const repoUrl = `github.com/${repoConfig.owner}/${entry.repo}`;
      const attribution = thread_followup_text ?? `~ posted using ${ATTRIBUTION}`;
      const replyText = `${attribution}\nFind my project at https://${repoUrl}`;

      if (postToX) {
        try {
          const tweetId = await postTweet(entry.text);
          if (thread_followup !== false) {
            try {
              await postReply(replyText, tweetId);
            } catch (replyErr) {
              console.warn(`  Warning: X follow-up reply failed: ${(replyErr as Error).message}`);
            }
          }
          console.log('  ✓ Posted to X');
          anySuccess = true;
        } catch (err) {
          console.error(`  ✗ X failed: ${(err as Error).message}`);
        }
      }

      if (postToBsky) {
        try {
          const ref = await postBluesky(entry.text);
          if (thread_followup !== false) {
            try {
              await postBlueskyReply(replyText, ref, ref);
            } catch (replyErr) {
              console.warn(`  Warning: Bluesky follow-up reply failed: ${(replyErr as Error).message}`);
            }
          }
          console.log('  ✓ Posted to Bluesky');
          anySuccess = true;
        } catch (err) {
          console.error(`  ✗ Bluesky failed: ${(err as Error).message}`);
        }
      }
    }

    if (anySuccess) {
      const postedAt = formatLocalTime(nowUtc, timezone);
      removeScheduleEntry(entry.repo, entry.tweetNumber);
      // Digest entries have no tweets.txt — only remove from schedule (done above)
      if (entry.repo !== 'digest') {
        archiveTweet(entry.repo, entry.tweetNumber, postedAt);
      }
      posted++;
    } else {
      failed++;
    }

    // Small delay between posts to respect rate limits
    if (dueTweets.indexOf(entry) < dueTweets.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\nDone: ${posted} posted, ${failed} failed.`);
  await statusCommand();
}
