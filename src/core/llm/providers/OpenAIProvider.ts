import { LLMMessage, LLMProvider, LLMResponse, LLMToolCall, LLMToolDefinition } from '../types';
import { DEFAULT_MODELS, resolveTextModel } from '../constants';

const OPENAI_BASE = (import.meta.env.VITE_OPENAI_URL || '/openai').replace(/\/$/, '');

function toOpenAIContent(m: LLMMessage): any {
  if (!m.images?.length) return m.content || '';
  const parts: any[] = [];
  if (m.content) parts.push({ type: 'text', text: m.content });
  for (const img of m.images) {
    const url = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
    parts.push({ type: 'image_url', image_url: { url } });
  }
  return parts;
}

export class OpenAIProvider implements LLMProvider {
  async generateCompletion(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    systemInstruction?: string,
    modelName: string = DEFAULT_MODELS.text
  ): Promise<LLMResponse> {
    const model = resolveTextModel(modelName);
    const openaiMessages: any[] = [];

    if (systemInstruction) {
      openaiMessages.push({ role: 'system', content: systemInstruction });
    }

    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        openaiMessages.push({
          role: 'tool',
          name: m.name,
          content: m.content || '',
        });
        continue;
      }
      const msg: any = {
        role: m.role,
        content: toOpenAIContent(m),
      };
      if (m.tool_calls?.length) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }
      openaiMessages.push(msg);
    }

    const payload: Record<string, unknown> = {
      model,
      messages: openaiMessages,
    };
    if (tools?.length) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    if (!res.ok) {
      const msg = result?.error?.message || JSON.stringify(result);
      throw new Error(`OpenAI chat failed (${res.status}): ${msg}`);
    }

    const choice = result.choices?.[0];
    const message = choice?.message || {};
    const toolCalls: LLMToolCall[] = (message.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function?.name,
        arguments: tc.function?.arguments || '{}',
      },
    }));

    return {
      content: message.content || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: result.usage
        ? {
            promptTokens: result.usage.prompt_tokens || 0,
            completionTokens: result.usage.completion_tokens || 0,
            totalTokens: result.usage.total_tokens || 0,
          }
        : undefined,
      finishReason: choice?.finish_reason,
      raw: result,
      request: {
        contents: openaiMessages,
        systemInstruction,
        tools,
      },
    };
  }
}
