import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { readConfig, readRepos, parseTzOffset } from '../utils/config';
import { readSchedule, writeSchedule, validateSchedule, ScheduledTweet } from '../utils/schedule';

/** Convert a "HH:MM" local time + timezone string to a cron expression in UTC. */
function toCronUTC(timeStr: string, timezone: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const offsetMin = parseTzOffset(timezone);
  const utcMinutes = (((h * 60 + m) - offsetMin) % 1440 + 1440) % 1440;
  return `${utcMinutes % 60} ${Math.floor(utcMinutes / 60)} * * *`;
}

/** Add 5 minutes to a "HH:MM" string, wrapping across hour/day boundaries. */
function addMinutes(timeStr: string, mins: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const total = (h * 60 + m + mins) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Regenerate post.yml cron entries from recurring config times plus exact
 * scheduled tweet times so manually edited entries can post on time.
 */
function updateWorkflowCrons(config: ReturnType<typeof readConfig>, entries: ScheduledTweet[]): void {
  const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'post.yml');
  if (!fs.existsSync(workflowPath)) return;

  const times = new Set<string>();
  if (config.digest_time) times.add(config.digest_time);
  for (const t of (config.old_post_times ?? [])) times.add(t);
  // Only add per-entry crons for old-repo tweets (not digest — digest is always at digest_time)
  for (const entry of entries) {
    if (entry.repo === 'digest') continue;
    const match = entry.scheduled.match(/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/);
    if (match) {
      times.add(match[1]);
      times.add(addMinutes(match[1], 5));
    }
  }

  if (times.size === 0) return;

  const cronLines = [...times].sort()
    .map(t => `    - cron: "${toCronUTC(t, config.timezone)}"   # ${t} ${config.timezone}`)
    .join('\n');

  const current = fs.readFileSync(workflowPath, 'utf-8');
  const normalized = current.replace(/\r\n/g, '\n');
  const updated = normalized.replace(
    /  schedule:\n(    - cron: "[^"]*"[^\n]*\n)+/,
    `  schedule:\n${cronLines}\n`
  );

  if (updated !== normalized) {
    fs.writeFileSync(workflowPath, updated, 'utf-8');
    console.log(`  Updated workflow crons: ${[...times].sort().join(', ')} ${config.timezone}`);
  }
}

export async function deployCommand(): Promise<void> {
  try {
    // Refresh the schedule header and validate before committing
    const schedule = readSchedule();
    const config = readConfig();
    if (schedule.length > 0) {
      const knownRepos = readRepos().map(r => r.repo);
      const { errors, warnings } = validateSchedule(schedule, knownRepos);

      if (warnings.length > 0) {
        console.warn('Warnings:\n');
        warnings.forEach(w => console.warn(`  ⚠ ${w}`));
        console.warn('');
      }

      if (errors.length > 0) {
        console.error('Cannot deploy — fix these issues in schedule-twitter.txt first:\n');
        errors.forEach(e => console.error(`  ✗ ${e}`));
        process.exit(1);
      }

      writeSchedule(schedule, config);
    }

    // Only update workflow crons locally — CI can't push workflow file changes
    if (!process.env.GITHUB_ACTIONS) {
      updateWorkflowCrons(config, schedule);
    }

    // Ensure git user is configured (required when running inside GitHub Actions)
    execSync('git config user.name "github-actions[bot]"', { stdio: 'pipe' });
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { stdio: 'pipe' });

    execSync('git add -A', { stdio: 'pipe' });
    const staged = execSync('git diff --staged --name-only', { encoding: 'utf-8' }).trim();
    if (!staged) {
      console.log('Nothing to deploy (no changes staged).');
      return;
    }
    execSync('git commit -m "chore: deploy tweet schedule [skip ci]"', { stdio: 'inherit' });
    execSync('git pull --rebase --autostash origin main', { stdio: 'pipe' });
    execSync('git push origin main', { stdio: 'inherit' });
    console.log('✓ Deployed — tweets will post on schedule');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Deploy failed: ${msg}`);
    process.exit(1);
  }
}
