import * as fs from 'fs';
import * as path from 'path';
import { readRepos, readConfig } from '../utils/config';
import { CommitsCache } from '../utils/github';
import { fetchCommand } from './fetch';
import { generateCommand } from './generate';
import { approveCommand } from './approve';
import { deployCommand } from './deploy';
import { digestCommand } from './digest';

export async function autoGenerateCommand(): Promise<void> {
  const config = readConfig();

  if (config.paused) {
    console.log('Paused. Set paused: false in config.yml to resume.');
    return;
  }

  // If tracked_repos is configured, run digest instead of per-repo generation
  if (config.tracked_repos && config.tracked_repos.length > 0) {
    const days = config.digest_days ?? 1;
    console.log(`tracked_repos set — running digest (last ${days} day(s)) across ${config.tracked_repos.length} repo(s)`);
    await digestCommand([`--days=${days}`]);
    await deployCommand();
    return;
  }

  const repos = readRepos();
  const postTimesCount = config.post_times.length;
  let anyGenerated = false;

  for (const repoConfig of repos) {
    const cacheFile = path.join(process.cwd(), repoConfig.repo, 'commits.json');

    // Read SHA before fetch to detect how many commits are new
    let lastGeneratedSHA = '';
    if (fs.existsSync(cacheFile)) {
      const before: CommitsCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      lastGeneratedSHA = before.lastGeneratedSHA ?? '';
    }

    // Fetch latest commits (incremental)
    await fetchCommand([repoConfig.repo]);

    if (!fs.existsSync(cacheFile)) {
      console.log(`${repoConfig.repo}: no commits found, skipping`);
      continue;
    }

    const cache: CommitsCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const latestSHA = cache.commits[cache.commits.length - 1]?.sha ?? '';

    if (latestSHA === lastGeneratedSHA) {
      console.log(`${repoConfig.repo}: no new commits since last generation`);
      continue;
    }

    // Count commits since last generation
    const lastGenIdx = lastGeneratedSHA
      ? cache.commits.findIndex(c => c.sha === lastGeneratedSHA)
      : -1;
    const newCommitCount = lastGenIdx === -1
      ? cache.commits.length
      : cache.commits.length - lastGenIdx - 1;

    const n = Math.min(newCommitCount, postTimesCount);
    console.log(`${repoConfig.repo}: ${newCommitCount} new commit(s) → generating ${n} tweet(s)`);

    // generate also fetches internally — harmless double-fetch
    await generateCommand([repoConfig.repo, `--n=${n}`]);
    anyGenerated = true;
  }

  if (!anyGenerated) {
    console.log('No new commits found across all repos. Nothing to do.');
    return;
  }

  await approveCommand();
  await deployCommand();
}
