import { LLMMessage, LLMProvider, LLMResponse, LLMToolCall, LLMToolDefinition } from '../types';
import { DEFAULT_MODELS, resolveTextModel } from '../constants';

const OLLAMA_BASE = (import.meta.env.VITE_OLLAMA_URL || '/ollama').replace(/\/$/, '');
const OLLAMA_DEFAULT_TIMEOUT_MS = 120_000;

function requestTimeoutMs(model: string): number {
  const name = model.toLowerCase();
  // Large local models need longer first-token + decode windows on 8GB GPUs.
  if (name.includes('gemma4') || name.includes('26b') || name.includes('qwen') || name.includes('deepseek')) {
    return 240_000;
  }
  if (name.includes('llama3.1')) return 150_000;
  return OLLAMA_DEFAULT_TIMEOUT_MS;
}

function predictBudget(model: string, hasTools: boolean): number | undefined {
  const name = model.toLowerCase();
  // Tool calls should finish quickly; long creative prose can still use a moderate budget.
  if (name.includes('gemma4') || name.includes('qwen') || name.includes('deepseek')) {
    return hasTools ? 768 : 1024;
  }
  if (name.includes('llama3.1')) return hasTools ? 640 : 1024;
  return undefined;
}

const KNOWN_TOOLS = ['set_user_brief', 'propose_task', 'complete_task', 'deliver_project'];

function stripDataUrl(img: string): string {
  const match = img.match(/^data:image\/[a-z]+;base64,(.+)$/i);
  return match ? match[1] : img;
}

function sanitizeToolJson(raw: string): string {
  return raw
    .replace(/```(?:json)?/gi, '')
    .trim()
    .replace(/,\s*"[^"]+"\s*:\s*$/, '')
    .replace(/,\s*"[^"]+"\s*:\s*}/g, '}')
    .replace(/,\s*}/g, '}');
}

function toToolCall(name: string, args: Record<string, unknown>): LLMToolCall {
  return {
    id: Math.random().toString(36).substring(7),
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args || {}),
    },
  };
}

function mapNativeToolCalls(raw: any[]): LLMToolCall[] {
  return (raw || []).map((tc: any) => {
    const args = tc.function?.arguments ?? tc.parameters ?? tc.arguments;
    return toToolCall(
      tc.function?.name || tc.name,
      typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {})
    );
  });
}

export function extractToolCallsFromContent(content?: string | null): LLMToolCall[] {
  if (!content) return [];
  const text = sanitizeToolJson(content);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const name = parsed.name || parsed.function?.name;
    const args = parsed.parameters || parsed.arguments || parsed.function?.arguments || {};
    if (typeof name === 'string' && KNOWN_TOOLS.includes(name)) {
      return [toToolCall(name, typeof args === 'string' ? JSON.parse(args) : args)];
    }
  } catch {
    const nameMatch = text.match(/"name"\s*:\s*"(set_user_brief|propose_task|complete_task|deliver_project)"/);
    if (!nameMatch) return [];
    const args: Record<string, unknown> = {};
    const title = text.match(/"title"\s*:\s*"([^"]*)"/);
    const description = text.match(/"description"\s*:\s*"([^"]*)"/);
    const brief = text.match(/"brief"\s*:\s*"([^"]*)"/);
    const output = text.match(/"output"\s*:\s*"([^"]*)"/);
    const taskId = text.match(/"taskId"\s*:\s*"([^"]*)"/);
    const agentId = text.match(/"agentId"\s*:\s*(\d+)/);
    if (title) args.title = title[1];
    if (description) args.description = description[1];
    if (brief) args.brief = brief[1];
    if (output) args.output = output[1];
    if (taskId) args.taskId = taskId[1];
    if (agentId) args.agentId = Number(agentId[1]);
    return [toToolCall(nameMatch[1], args)];
  }
  return [];
}

export class OllamaProvider implements LLMProvider {
  async generateCompletion(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
    systemInstruction?: string,
    modelName: string = DEFAULT_MODELS.text
  ): Promise<LLMResponse> {
    const model = resolveTextModel(modelName);
    const ollamaMessages: any[] = [];
    // Local Llama / Qwen / DeepSeek models are text-only — never send images.
    const visionOk = /llava|vision|bakllava|minicpm-v|moondream/i.test(model);

    if (systemInstruction) {
      ollamaMessages.push({ role: 'system', content: systemInstruction });
    }

    for (const m of messages) {
      if (m.role === 'system') continue;
      const msg: any = {
        role: m.role === 'tool' ? 'tool' : m.role,
        content: m.content || '',
      };
      if (visionOk && m.images?.length) {
        msg.images = m.images.map(stripDataUrl);
      }
      if (m.tool_calls?.length) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          function: {
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments || '{}'),
          },
        }));
      }
      ollamaMessages.push(msg);
    }

    const payload: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: false,
      think: false,
    };
    if (tools?.length) {
      payload.tools = tools;
    }
    const numPredict = predictBudget(model, Boolean(tools?.length));
    if (numPredict) {
      payload.options = { num_predict: numPredict };
    }

    const timeoutMs = requestTimeoutMs(model);
    let res: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        const seconds = Math.round(timeoutMs / 1000);
        throw new Error(
          `Ollama timed out after ${seconds} seconds (${model}). The request was stopped so the app can continue with a local fallback.`
        );
      }
      throw new Error(
        `Ollama is not reachable from this browser. Open the app at the host PC's LAN URL so /ollama is proxied. ${err instanceof Error ? err.message : err}`
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Ollama is not reachable (${res.status}). Start Ollama on the PC running npm run dev and pull ${model}. ${text}`
      );
    }

    const result = await res.json();
    const message = result.message || {};
    let toolCalls: LLMToolCall[] = [];
    try {
      toolCalls = mapNativeToolCalls(message.tool_calls || []);
    } catch {
      toolCalls = [];
    }
    if (toolCalls.length === 0) {
      toolCalls = extractToolCallsFromContent(message.content);
    }

    return {
      content: toolCalls.length > 0 ? null : (message.content || null),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: result.prompt_eval_count || 0,
        completionTokens: result.eval_count || 0,
        totalTokens: (result.prompt_eval_count || 0) + (result.eval_count || 0),
      },
      finishReason: result.done_reason,
      raw: result,
      request: {
        contents: ollamaMessages,
        systemInstruction,
        tools,
      },
    };
  }
}
