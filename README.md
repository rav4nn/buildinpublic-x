# buildinpublic-x

> Turn your GitHub commit history into a stream of authentic developer tweets — automatically, on a schedule, with zero server.

Fork this repo, point it at your projects, add five secrets, and your build journey tweets itself.

---

## What it does

`buildinpublic-x` reads your commit history and README, sends them to an LLM of your choice, and generates technically specific, first-person tweets like:

> *"Replaced my polling loop with webhooks — cut server load by 60% and response time from 2s to 80ms. Turns out I was just making things harder. #buildinpublic #nodejs"*

Tweets sit in a Markdown file you can edit before they go live. A cron-based GitHub Actions workflow posts them on your schedule. Everything lives in the repo — no database, no server, no monthly bill.

---

## Setup (5 steps)

**1. Fork this repo**

Click **Fork** on GitHub. Clone your fork locally.

**2. Configure your repos**

Edit `repos.yml`:

```yaml
repos:
  - owner: your-github-username
    repo: your-repo-name
    tweets_per_day: 2
```

Edit `config.yml` to set your timezone and preferred LLM:

```yaml
timezone: "GMT+5:30"
max_tweets_per_day: 8
llm_provider: "anthropic"
```

**3. Get your Twitter (X) API keys**

1. Apply for a developer account at [developer.twitter.com](https://developer.twitter.com)
2. Fill out the use case form. Be honest and specific — something like: *"I'm building a personal automation to post my GitHub commits and project updates to my X account. This is for personal use only, no data scraping."* Vague answers get rejected or delayed.
3. Create a new App — set permissions to **Read and Write**
4. Under **Keys and Tokens**, generate all four keys: API Key, API Secret, Access Token, Access Token Secret

Twitter's Basic plan allows **500 tweets per month**, which is ~16 tweets/day — more than enough.

**4. Add API keys as GitHub Secrets**

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
# edit .env with your keys
```

Then push all keys to GitHub Secrets in one command (requires the [GitHub CLI](https://cli.github.com)):

```bash
npm run setup -- your-username/your-fork-name
```

This reads your `.env` and sets every populated key as a GitHub Secret automatically. Only keys you've filled in get pushed — placeholders are skipped.

**Or add them manually** via your fork → Settings → Secrets and variables → Actions:

| Secret | Where to get it |
|--------|----------------|
| `X_API_KEY` | Twitter Developer Portal |
| `X_API_SECRET` | Same |
| `X_ACCESS_TOKEN` | Same (Keys and Tokens tab) |
| `X_ACCESS_TOKEN_SECRET` | Same |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |
| `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |

You only need the LLM key matching your `llm_provider` setting, plus all four X keys.

**5. Enable GitHub Actions on your fork**

GitHub disables scheduled workflows on forks by default. After forking:

1. Go to your fork → **Actions** tab → click **"I understand my workflows, go ahead and enable them"**
2. Go to Settings → Actions → General → scroll to **Workflow permissions** → select **Read and write permissions** → Save

Then trigger your first run: Actions → **Generate Tweets** → Run workflow. Enter your repo name and number of tweets (e.g. `20`).

The workflow fetches commits, runs the LLM, and commits `{repo}/{repo}-tweets.md` back to your repo. Review and edit that file, then run `npm run approve` (or locally — see below). Tweets will post automatically every 6 hours.

---

## Tweeting as you build (starting from an empty repo)

You don't need a finished project. This tool is designed for sharing progress as you build:

```bash
# Day 1: push your first few commits, then:
npm run fetch -- my-repo
npm run generate -- my-repo --n=3

# Day 5: pushed more commits, generate more tweets:
npm run fetch -- my-repo          # only fetches new commits since last time
npm run generate -- my-repo --n=5 # appends to existing tweets file

# Approve and schedule everything at once:
npm run approve
```

The fetch is always incremental — it only calls the GitHub API for commits you haven't seen yet. `commits.json` is committed to your repo so GitHub Actions picks it up without redundant API calls.

> If your repo has fewer than 3 commits, the tool will warn you. Push a few real commits first for meaningful tweets.

---

## Local workflow

```bash
# 1. Install dependencies
npm install
cp .env.example .env   # fill in your keys

# 2. Fetch commits (only new ones after first run)
npm run fetch -- my-repo

# 3. Generate tweets from commit history
npm run generate -- my-repo --n=20

# 4. Review / edit my-repo/my-repo-tweets.md

# 5. Schedule all PENDING tweets
npm run approve

# 6. Post due tweets + update STATUS.md
npm run post

# Check current status anytime
npm run status
```

---

## Tweet file format

```markdown
## Tweet 1
**Status:** PENDING
**Source:** commits abc1234, def5678
Replaced my polling loop with webhooks — cut server load by 60% and
response time from 2s to 80ms. #buildinpublic #nodejs
---
```

Statuses: `PENDING` → `SCHEDULED` (after `approve`) → `POSTED` (after `post`)

You can edit the tweet text at any point while it's still PENDING or SCHEDULED.

---

## Switching LLM providers

Change `llm_provider` in `config.yml` and add the corresponding API key as a secret.

| Provider | Model | Notes |
|----------|-------|-------|
| `anthropic` | claude-haiku-4-5 | Default. Fast and cheap. |
| `openai` | gpt-4o-mini | Good quality, reasonable cost. |
| `gemini` | gemini-2.0-flash | Fast, generous free tier. |
| `deepseek` | deepseek-chat | Very cheap, strong reasoning. |
| `groq` | llama-3.1-8b-instant | Fastest, free tier available. |

---

## GitHub Actions workflows

### `generate.yml` — manual trigger only
Runs `fetch` + `generate` and commits the output back. Triggered from Actions → Generate Tweets → Run workflow. Inputs: repo name, number of tweets.

### `post.yml` — runs every 6 hours + manual trigger
Runs `post` + `status` and commits all updated Markdown files back. To change the posting frequency, edit the `cron` expression in [`.github/workflows/post.yml`](.github/workflows/post.yml).

Both workflows use `git pull --rebase` before committing back, so they won't conflict if you edit files while Actions is running.

---

## Example tweet quality

Generated from real commit messages — not summaries:

> *"Switched from SQLite to Postgres today. Wasn't strictly necessary but the query planner is doing things SQLite just can't. Joins are 4x faster on the dashboard. #buildinpublic #postgres"*

> *"Finally fixed the race condition in the sync engine. The fix was one line. The debugging took 3 days. Concurrent writes now pass all load tests. #buildinpublic"*

> *"Shipped the first working version of the expense categorization model. 87% accuracy on test set. Used a simple Naive Bayes — ML isn't always the answer but here it genuinely is. #buildinpublic #ml"*

---

## Contributing

PRs welcome. Open an issue first for large changes.
