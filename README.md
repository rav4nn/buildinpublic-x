# buildinpublic-x

Turn your GitHub commit history into scheduled #buildinpublic tweets — automatically, with no server.

Fork this repo, add your keys, and your build journey posts itself to X.

---

## How it works

Point it at any GitHub repo. It reads your commits and README, sends them to an LLM, and generates tweets like:

> *"Building flux-rag: Phase 2 done — chunking, embeddings, vector store, retrieval all connected. First run without mocks. Composing pieces is harder than building them.*
>
> *What's your primary bottleneck when connecting RAG stages?*
> *#buildinpublic #rag"*

You review the tweets, approve them, and they post on your schedule via GitHub Actions. No database. No server. No monthly bill.

---

## Setup

**1. Fork this repo**

Click **Fork** on GitHub. Then go to your fork → **Actions** → enable workflows.

Also go to Settings → Actions → General → Workflow permissions → select **Read and write permissions**.

**2. Add your API keys as GitHub Secrets**

Copy `.env.example` to `.env` and fill in your keys, then push them all at once:

```bash
cp .env.example .env
# edit .env with your keys
npm run setup -- your-username/your-fork-name
```

Or add them manually in your fork → Settings → Secrets and variables → Actions:

| Secret | Where to get it |
|--------|----------------|
| `X_API_KEY` | [developer.twitter.com](https://developer.twitter.com) — create an app with Read & Write |
| `X_API_SECRET` | Same |
| `X_ACCESS_TOKEN` | Same (Keys and Tokens tab) |
| `X_ACCESS_TOKEN_SECRET` | Same |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) — free tier available |
| `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) — free tier available |

You only need the key for your chosen LLM provider, plus all four X keys.

> **Twitter API:** Apply at [developer.twitter.com](https://developer.twitter.com). The Basic plan gives 500 tweets/month (~16/day). When filling out the use case form, be specific: *"Personal automation to post my GitHub commits to my X account. No scraping, no third-party data."*

**3. Configure**

Copy `config.example.yml` to `config.yml` and edit it:

```yaml
github_owner: "your-github-username"
repos:
  - your-repo-name
  - another-repo

timezone: "GMT+5:30"
llm_provider: "gemini"       # anthropic | openai | gemini | deepseek | groq
auto_generate: false          # true = picks up new commits 4x/day automatically
paused: false

post_times:
  - "09:00"
  - "13:00"
  - "17:00"
  - "21:00"
```

**4. Generate your first tweets**

Go to Actions → **Generate Tweets** → Run workflow. Enter your repo name and how many tweets to generate.

The workflow commits a `{repo}/{repo}-tweets.txt` file back to your repo. Review it, edit anything you want, then run:

```bash
git pull
npm run approve   # assigns post times, creates schedule-twitter.txt
npm run deploy    # pushes — tweets are now live in the queue
```

Tweets post automatically. The `post.yml` workflow runs every 6 hours and posts anything due.

---

## Local workflow

```bash
npm install
cp .env.example .env               # fill in your keys
cp config.example.yml config.yml   # edit with your repos + settings

# Generate tweets for a repo
npm run generate -- my-repo --n=10

# Review my-repo/my-repo-tweets.txt, edit freely

# Schedule and deploy
npm run approve
npm run deploy
```

---

## Commands

| Command | What it does |
|---------|-------------|
| `npm run generate -- <repo> --n=<count>` | Fetch commits + generate N tweets |
| `npm run approve` | Assign post times, create `schedule-twitter.txt` |
| `npm run deploy` | Validate schedule, commit and push |
| `npm run post` | Post due tweets (runs automatically via Actions) |
| `npm run auto-generate` | Check for new commits, generate + schedule if found |

---

## Editing the schedule

`schedule-twitter.txt` is a plain text file in your repo. Edit it freely — change times, reorder, delete entries — then run `npm run deploy`.

`npm run deploy` validates before pushing and will tell you if anything looks wrong (past dates, tweets over 280 chars, unknown repos, etc.).

---

## LLM providers

| Provider | Model | Notes |
|----------|-------|-------|
| `anthropic` | claude-haiku-4-5 | Fast and cheap |
| `openai` | gpt-4o-mini | Good quality |
| `gemini` | gemini-2.5-flash | Free tier available |
| `deepseek` | deepseek-chat | Very cheap |
| `groq` | llama-3.1-8b-instant | Free tier, fastest |

Change `llm_provider` in `config.yml` and make sure the matching secret is set.

---

## Auto-generate (hands-free mode)

Set `auto_generate: true` in `config.yml` and deploy. Whenever you push new commits to a tracked repo, the tool picks them up automatically (4x/day), generates tweets, schedules them, and deploys — no manual steps needed.

Use the kill switch anytime: set `paused: true` in `config.yml`, run `npm run deploy`.
