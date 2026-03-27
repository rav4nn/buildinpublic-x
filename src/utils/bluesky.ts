const BSKY_API = 'https://bsky.social/xrpc';

interface Session {
  accessJwt: string;
  did: string;
}

interface StrongRef {
  uri: string;
  cid: string;
}

async function bskyFetch(path: string, body: unknown, token?: string): Promise<unknown> {
  const res = await fetch(`${BSKY_API}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bluesky API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function createSession(): Promise<Session> {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier) throw new Error('BLUESKY_IDENTIFIER env var not set');
  if (!password) throw new Error('BLUESKY_APP_PASSWORD env var not set');

  const data = await bskyFetch('com.atproto.server.createSession', { identifier, password }) as Session;
  return data;
}

export async function postBluesky(text: string): Promise<StrongRef> {
  const session = await createSession();
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
  };
  const data = await bskyFetch('com.atproto.repo.createRecord', {
    repo: session.did,
    collection: 'app.bsky.feed.post',
    record,
  }, session.accessJwt) as StrongRef;
  return data;
}

export async function postBlueskyReply(text: string, root: StrongRef, parent: StrongRef): Promise<StrongRef> {
  const session = await createSession();
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
    reply: { root, parent },
  };
  const data = await bskyFetch('com.atproto.repo.createRecord', {
    repo: session.did,
    collection: 'app.bsky.feed.post',
    record,
  }, session.accessJwt) as StrongRef;
  return data;
}
