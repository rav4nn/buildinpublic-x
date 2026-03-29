import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { readConfig, readRepos, parseTzOffset } from '../utils/config';
import { readSchedule, writeSchedule, validateSchedule } from '../utils/schedule';

/** Convert a "HH:MM" local time + timezone string to a cron expression in UTC. */
function toCronUTC(timeStr: string, timezone: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const offsetMin = parseTzOffset(timezone);
  const utcMinutes = (((h * 60 + m) - offsetMin) % 1440 + 1440) % 1440;
  return `${utcMinutes % 60} ${Math.floor(utcMinutes / 60)} * * *`;
}

/** Regenerate post.yml with cron entries matching the user's configured post times. */
function updateWorkflowCrons(config: ReturnType<typeof readConfig>): void {
  const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'post.yml');
  if (!fs.existsSync(workflowPath)) return;

  const times = new Set<string>();
  if (config.digest_time) times.add(config.digest_time);
  for (const t of (config.old_post_times ?? [])) times.add(t);

  if (times.size === 0) return;

  const cronLines = [...times]
    .map(t => `    - cron: "${toCronUTC(t, config.timezone)}"   # ${t} ${config.timezone}`)
    .join('\n');

  const current = fs.readFileSync(workflowPath, 'utf-8');
  const updated = current.replace(
    /  schedule:\n(    - cron: "[^"]*"[^\n]*\n)+/,
    `  schedule:\n${cronLines}\n`
  );

  if (updated !== current) {
    fs.writeFileSync(workflowPath, updated, 'utf-8');
    console.log(`  Updated workflow crons: ${[...times].join(', ')} ${config.timezone}`);
  }
}

export async function deployCommand(): Promise<void> {
  try {
    // Refresh the schedule header and validate before committing
    const schedule = readSchedule();
    const config = readConfig();
    if (schedule.length > 0) {
      const knownRepos = readRepos().map(r => r.repo);
      const errors = validateSchedule(schedule, knownRepos);

      if (errors.length > 0) {
        console.error('Cannot deploy — fix these issues in schedule-twitter.txt first:\n');
        errors.forEach(e => console.error(`  ✗ ${e}`));
        process.exit(1);
      }

      writeSchedule(schedule, config);
    }

    // Sync workflow cron times with user's configured post times
    updateWorkflowCrons(config);

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
