import * as fs from 'fs';
import * as path from 'path';
import { findRepo } from '../utils/config';
import { generateTweets } from '../llm/index';
import { maxTweetNumber, appendTweets, Tweet } from '../utils/tweets';
import { CommitsCache } from '../utils/github';

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

  const cacheFile = path.join(process.cwd(), repoName, 'commits.json');
  if (!fs.existsSync(cacheFile)) {
    console.error(`commits.json not found for "${repoName}". Run: npm run fetch -- ${repoName}`);
    process.exit(1);
  }

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

  console.log(`Generating tweets for ${repoName} from ${cache.commits.length} commits...`);

  const generated = await generateTweets(repoName, repoConfig.owner, cache.readme, cache.commits, n);
  console.log(`  LLM returned ${generated.length} tweet${generated.length === 1 ? '' : 's'}`);

  const startNumber = maxTweetNumber(repoName) + 1;
  const newTweets: Tweet[] = generated.map((g, i) => ({
    number: startNumber + i,
    status: 'PENDING',
    source: g.source,
    text: g.text,
  }));

  appendTweets(repoName, newTweets);

  console.log(`✓ Appended ${newTweets.length} tweet${newTweets.length === 1 ? '' : 's'} to ${repoName}/${repoName}-tweets.md`);
  console.log(`  Review and edit the file, then run: npm run approve`);
}
