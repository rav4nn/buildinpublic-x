import Groq from 'groq-sdk';

export async function generateWithGroq(prompt: string): Promise<string> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0].message.content ?? '';
}
