import * as fs from 'fs';
import * as path from 'path';
import { findRepo } from '../utils/config';
import { generateTweets } from '../llm/index';
import { readTweets, writeTweets, Tweet } from '../utils/tweets';
import { CommitsCache } from '../utils/github';
import { fetchCommand } from './fetch';

export async function generateCommand(args: string[]): Promise<void> {
  const filteredArgs = args.filter(a => a !== '--');
  const repoName = filteredArgs[0];
  if (!repoName) {
    console.error('Usage: npm run generate -- <repo-name> [--n=10]');
    process.exit(1);
  }

  const nArg = filteredArgs.find(a => a.startsWith('--n='));
  const n = nArg ? parseInt(nArg.split('=')[1], 10) : 10;

  if (isNaN(n) || n < 1) {
    console.error('--n must be a positive integer');
    process.exit(1);
  }

  const repoConfig = findRepo(repoName);

  // Always fetch latest commits before generating
  await fetchCommand([repoName]);

  const cacheFile = path.join(process.cwd(), repoName, 'commits.json');
  const cache: CommitsCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));

  if (cache.commits.length === 0) {
    console.error(`No commits found in ${repoName}/commits.json.`);
    console.error(`Push some commits to ${cache.owner}/${cache.repo} first, then re-run: npm run fetch -- ${repoName}`);
    process.exit(1);
  }

  const MIN_USEFUL_COMMITS = 3;
  if (cache.commits.length < MIN_USEFUL_COMMITS) {
    console.warn(`  Warning: only ${cache.commits.length} commit(s) found. Tweets may be sparse — push more commits for better results.`);
  }

  // Build context summary — shown to user and written as file header
  const uniqueDays = new Set(cache.commits.map((c: { date: string }) => c.date.slice(0, 10))).size;
  const ratio = n > cache.commits.length
    ? ` (${n - cache.commits.length} will be paraphrased from README + commit context)`
    : n < cache.commits.length
      ? ` (${cache.commits.length - n} commits will be grouped together)`
      : '';
  const contextLine = `${n} tweets requested | ${cache.commits.length} commit${cache.commits.length === 1 ? '' : 's'} across ${uniqueDays} day${uniqueDays === 1 ? '' : 's'}${ratio}`;

  console.log(`\n  ${contextLine}\n`);

  const generated = await generateTweets(repoName, repoConfig.owner, cache.readme, cache.commits, n);
  console.log(`  LLM returned ${generated.length} tweet${generated.length === 1 ? '' : 's'}`);

  // Keep SCHEDULED and POSTED tweets; replace all PENDING ones with fresh generated tweets
  const existing = readTweets(repoName);
  const preserved = existing.filter(t => t.status !== 'PENDING');
  const droppedCount = existing.length - preserved.length;

  // Number new tweets after the highest existing number
  const maxExisting = preserved.reduce((max, t) => Math.max(max, t.number), 0);
  const startNumber = maxExisting + 1;
  const newTweets: Tweet[] = generated.map((g, i) => ({
    number: startNumber + i,
    status: 'PENDING',
    source: g.source,
    text: g.text,
  }));

  writeTweets(repoName, [...preserved, ...newTweets], contextLine);

  // Record which commit was latest at generation time (used by auto-generate to detect new commits)
  cache.lastGeneratedSHA = cache.commits[cache.commits.length - 1]?.sha ?? '';
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf-8');

  if (droppedCount > 0) {
    console.log(`  Replaced ${droppedCount} existing PENDING tweet${droppedCount === 1 ? '' : 's'}`);
  }
  console.log(`✓ Wrote ${newTweets.length} tweet${newTweets.length === 1 ? '' : 's'} to ${repoName}/${repoName}-tweets.txt`);
  console.log(`  Review and edit the file, then run: npm run approve`);
}
