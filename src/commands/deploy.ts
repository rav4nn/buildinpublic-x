import { execSync } from 'child_process';
import { readConfig } from '../utils/config';
import { readSchedule, writeSchedule } from '../utils/schedule';

export async function deployCommand(): Promise<void> {
  try {
    // Refresh the schedule header to reflect any config changes (post_times, auto_generate, etc.)
    const schedule = readSchedule();
    if (schedule.length > 0) {
      writeSchedule(schedule, readConfig());
    }

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
