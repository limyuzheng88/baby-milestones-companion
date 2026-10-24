import { describe, expect, it } from 'vitest';
import { AiRefusal, AnthropicProvider } from '../../src/ai/provider';

function fakeFetch(reply: object, seen: Record<string, unknown>[]) {
  return (async (_url: string, init: RequestInit) => {
    seen.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const message = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 30 },
});

describe('AnthropicProvider', () => {
  it('sends a structured-output request and returns text with token counts', async () => {
    const seen: Record<string, unknown>[] = [];
    const ai = new AnthropicProvider('test-key', 'claude-haiku-5-5', fakeFetch(message('{"kind":"other"}'), seen));
    const res = await ai.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 300, jsonSchema: { type: 'object' } });
    expect(res).toEqual({ text: '{"kind":"other"}', inputTokens: 120, outputTokens: 30 });
    expect(seen[0]).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 300,
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    });
  });

  it('omits output_config for plain text', async () => {
    const seen: Record<string, unknown>[] = [];
    await new AnthropicProvider('k', 'claude-haiku-5-5', fakeFetch(message('hello'), seen)).complete({ system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 100 });
    expect(seen[0]).not.toHaveProperty('output_config');
  });

  it('raises AiRefusal on a refusal, still reporting tokens', async () => {
    const ai = new AnthropicProvider('k', 'claude-haiku-5-5', fakeFetch(message('', 'refusal'), []));
    await expect(ai.complete({ system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 100 })).rejects.toBeInstanceOf(AiRefusal);
  });
});
