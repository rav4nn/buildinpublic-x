# buildinpublic-x

Turn your GitHub commits into actually good tweets using an LLM

github green squares → twitter posts

---

## Why this exists

You want to build in public

but

* you don’t know what to post
* you forget to post
* or writing tweets feels like extra work

Meanwhile your commits already tell the story
they just don’t sound like tweets

---

## What this does

* reads your commits
* uses an LLM (your choice) to turn them into clear, relevant tweets
* lets you review and edit
* schedules and posts automatically
* for live projects - posts automatically every few hours

No backend. No database. No SaaS.
Everything runs from your repo.

---

## Example

> Started building flux-rag today - a universal RAG pipeline. Scaffolding package structure and core models.
> Laying out clear interfaces early prevents significant refactoring later.
>
> What architectural choices do you prioritize at inception?
> #buildinpublic #architecture

---

## How it works

1. Fork this repo
2. Add your API keys (LLM + X)
3. Generate tweets from your commits
4. Review → approve → done

Your tweets are now scheduled

---

## Commands

```bash
npm run generate -- my-repo --n=10
npm run approve
npm run deploy
```

---

## Auto mode

```yaml
auto_generate: true
```

New commits are picked up multiple times a day
tweets get generated and scheduled automatically

---

## Twitter API

You need a Twitter developer account to post. Apply at [developer.twitter.com](https://developer.twitter.com) — approval usually takes 1–3 days.

When filling out the use case form, be specific: *"Personal automation to post my GitHub commits to my X account. No scraping, no third-party data."* Vague answers get rejected or delayed.

The Basic plan gives 500 tweets/month (~16/day) which is more than enough.

---

## Who this is for

* indie hackers trying to stay consistent
* devs who commit regularly but don’t post
* anyone who has said “I should build in public” but hasn’t

---