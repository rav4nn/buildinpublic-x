import * as fs from 'fs';
import * as path from 'path';
import { readRepos, readConfig, formatLocalTime, parseLocalTime } from '../utils/config';
import { readTweets, countPosted } from '../utils/tweets';
import { readSchedule } from '../utils/schedule';

const STATUS_FILE = 'STATUS.md';

export async function statusCommand(): Promise<void> {
  const repos = readRepos();
  const config = readConfig();
  const { timezone } = config;
  const nowUtc = new Date();
  const generatedAt = formatLocalTime(nowUtc, timezone);

  const lines: string[] = [
    '# BuildInPublic-X — Status',
    '',
    `> Generated: ${generatedAt}`,
    '',
    '## Per Repo',
    '',
  ];

  let totalPending = 0;
  let totalScheduled = 0;
  let totalPosted = 0;

  for (const r of repos) {
    const tweets = readTweets(r.repo);
    const pending = tweets.filter(t => t.status === 'PENDING').length;
    const scheduled = tweets.filter(t => t.status === 'SCHEDULED').length;
    const posted = countPosted(r.repo);

    totalPending += pending;
    totalScheduled += scheduled;
    totalPosted += posted;

    lines.push(`### ${r.repo}`);
    lines.push(`- Pending: **${pending}**`);
    lines.push(`- Scheduled: **${scheduled}**`);
    lines.push(`- Posted: **${posted}**`);
    lines.push('');
  }

  lines.push('## Totals', '');
  lines.push(`| State     | Count |`);
  lines.push(`|-----------|-------|`);
  lines.push(`| Pending   | ${totalPending} |`);
  lines.push(`| Scheduled | ${totalScheduled} |`);
  lines.push(`| Posted    | ${totalPosted} |`);
  lines.push('');

  // Next scheduled tweet
  const schedule = readSchedule();
  const upcoming = schedule
    .filter(e => e.status === 'SCHEDULED')
    .sort((a, b) => a.scheduled.localeCompare(b.scheduled));

  lines.push('## Next Scheduled Tweet', '');
  if (upcoming.length > 0) {
    const next = upcoming[0];
    lines.push(`**${next.scheduled}** — ${next.repo}`);
    lines.push('');
    lines.push(`> ${next.text.slice(0, 120)}${next.text.length > 120 ? '...' : ''}`);
  } else {
    lines.push('_(none scheduled)_');
    if (totalPending > 0) {
      lines.push('');
      lines.push(`You have ${totalPending} pending tweet(s). Run \`npm run approve\` to schedule them.`);
    }
  }

  lines.push('');
  lines.push('## Twitter API Usage', '');
  lines.push(`Tweets posted this month: **${totalPosted}** _(manual count — check your Twitter Developer Portal for API quota)_`);
  lines.push('');

  const content = lines.join('\n');
  fs.writeFileSync(path.join(process.cwd(), STATUS_FILE), content, 'utf-8');
  console.log(`✓ STATUS.md updated.`);

  // Also print a summary to console
  console.log(`\n  Pending: ${totalPending} | Scheduled: ${totalScheduled} | Posted: ${totalPosted}`);
  if (upcoming.length > 0) {
    console.log(`  Next tweet: ${upcoming[0].scheduled} (${upcoming[0].repo})`);
  }
}
