import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Keys that should never be pushed — Actions provides these automatically
const SKIP_KEYS = new Set(['GITHUB_TOKEN']);

/** Parse a .env file into a key→value map. */
function parseEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key) vars[key] = value;
  }
  return vars;
}

/** Try to detect owner/repo from the current git remote. */
function detectRepo(): string | null {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const match = remote.match(/github\.com[:/](.+?)(\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function setupCommand(args: string[]): Promise<void> {
  // Configure git merge driver so config.yml is never overwritten by upstream pulls
  try {
    execSync('git config merge.ours.driver true', { stdio: 'ignore' });
  } catch {
    // Not inside a git repo — skip silently
  }

  // Resolve target repo
  let repo = args[0] ?? detectRepo();
  if (!repo) {
    console.error('Could not detect GitHub repo. Pass it explicitly:');
    console.error('  npm run setup -- owner/repo');
    process.exit(1);
  }

  // Confirm gh CLI is available and authenticated
  try {
    execSync('gh auth status', { stdio: 'ignore' });
  } catch {
    console.error('GitHub CLI (gh) is not installed or not authenticated.');
    console.error('Install: https://cli.github.com');
    console.error('Then run: gh auth login');
    process.exit(1);
  }

  // Bootstrap config.yml from example if not present
  const configFile = path.join(process.cwd(), 'config.yml');
  const configExample = path.join(process.cwd(), 'config.example.yml');
  if (!fs.existsSync(configFile) && fs.existsSync(configExample)) {
    fs.copyFileSync(configExample, configFile);
    console.log('  Created config.yml from config.example.yml — edit it to set your timezone and LLM provider.\n');
  }

  // Read .env
  const envFile = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) {
    console.error('.env file not found.');
    console.error('Copy .env.example to .env and fill in your keys, then run setup again.');
    process.exit(1);
  }

  const envVars = parseEnv(fs.readFileSync(envFile, 'utf-8'));

  console.log(`Pushing secrets to github.com/${repo}...\n`);

  let set = 0;
  let skipped = 0;
  let failed = 0;

  for (const [key, value] of Object.entries(envVars)) {
    // Skip keys that Actions provides automatically
    if (SKIP_KEYS.has(key)) {
      console.log(`  — Skipped  ${key} (provided automatically by Actions)`);
      skipped++;
      continue;
    }

    // Skip placeholder or empty values
    if (!value || value.startsWith('your_')) {
      console.log(`  — Skipped  ${key} (not set in .env)`);
      skipped++;
      continue;
    }

    try {
      // Pipe value via stdin to avoid shell-escaping issues with special chars
      execFileSync('gh', ['secret', 'set', key, '--repo', repo], {
        input: value,
        encoding: 'utf-8',
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      console.log(`  ✓ Set      ${key}`);
      set++;
    } catch (err) {
      console.error(`  ✗ Failed   ${key}: ${(err as Error).message.split('\n')[0]}`);
      failed++;
    }
  }

  console.log(`\nDone: ${set} set, ${skipped} skipped, ${failed} failed.`);

  if (skipped > 0) {
    console.log(`\nTo set the skipped ones, add them to .env and run: npm run setup`);
  }
  if (set > 0) {
    console.log(`\nAll set! Go to github.com/${repo}/actions and trigger the Generate Tweets workflow.`);
  }
}
