import { TwitterApi } from 'twitter-api-v2';

/** Returns a ready-to-use Twitter v2 client. */
function getClient(): TwitterApi {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    throw new Error('Missing Twitter API credentials. Check your .env / GitHub Secrets.');
  }
  return new TwitterApi({
    appKey: X_API_KEY,
    appSecret: X_API_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessSecret: X_ACCESS_TOKEN_SECRET,
  });
}

/** Post a tweet. Returns the posted tweet ID. */
export async function postTweet(text: string): Promise<string> {
  const client = getClient();
  if (text.length > 280) {
    throw new Error(`Tweet too long (${text.length} chars): ${text.slice(0, 50)}...`);
  }
  const { data } = await client.v2.tweet(text);
  return data.id;
}

/** Post a reply to an existing tweet. Returns the new tweet ID. */
export async function postReply(text: string, replyToId: string): Promise<string> {
  const client = getClient();
  const { data } = await client.v2.tweet(text, { reply: { in_reply_to_tweet_id: replyToId } });
  return data.id;
}

/** Validate that Twitter credentials are configured (does not post anything). */
export async function validateCredentials(): Promise<void> {
  const client = getClient();
  await client.v2.me();
}
