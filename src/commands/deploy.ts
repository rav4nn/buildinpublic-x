import { execSync } from 'child_process';
import { readConfig, readRepos } from '../utils/config';
import { readSchedule, writeSchedule, validateSchedule } from '../utils/schedule';

export async function deployCommand(): Promise<void> {
  try {
    // Refresh the schedule header and validate before committing
    const schedule = readSchedule();
    if (schedule.length > 0) {
      const config = readConfig();
      const knownRepos = readRepos().map(r => r.repo);
      const errors = validateSchedule(schedule, knownRepos);

      if (errors.length > 0) {
        console.error('Cannot deploy — fix these issues in schedule-twitter.txt first:\n');
        errors.forEach(e => console.error(`  ✗ ${e}`));
        process.exit(1);
      }

      writeSchedule(schedule, config);
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
