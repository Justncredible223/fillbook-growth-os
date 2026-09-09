const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-5-20250929";

/**
 * Previously there was NO per-call timeout at all -- a single hung request
 * could consume an entire Vercel invocation's 60s maxDuration with no way
 * for the caller to bound or recover from it. 20s is conservative against
 * real Claude Messages API latency for a 1024-max-token tool-forced call
 * (typically single-digit seconds), while still leaving room for two
 * sequential round-trips (draft, then the parallel review batch) plus DB
 * writes inside one 60s invocation. Configurable via env for tuning
 * without a code change.
 */
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_CALL_TIMEOUT_MS) || 20_000;

export class LlmClientError extends Error {}

export interface ToolCallResult<T> {
  toolName: string;
  input: T;
}

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Thin wrapper around the Claude Messages API. Forces the model to
 * respond via a single tool call rather than free text, so review agents
 * get a reliably-structured verdict instead of parsing prose. Injectable
 * fetchImpl for tests, same pattern as XSignalAdapter/SearchConsoleAdapter.
 * Optional onUsage fires after every successful call with real token
 * counts from the response -- Cost Intelligence's one data source, not a
 * separate estimate.
 */
export class LlmClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
    private workspaceId?: string,
    private onUsage?: (usage: LlmUsage) => void,
  ) {}

  async callTool<T>(systemPrompt: string, userMessage: string, toolName: string, toolSchema: object, timeoutMs = DEFAULT_TIMEOUT_MS, maxTokens = 1024): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          ...(this.workspaceId ? { "anthropic-workspace-id": this.workspaceId } : {}),
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          tools: [{ name: toolName, description: `Submit your ${toolName} result`, input_schema: toolSchema }],
          tool_choice: { type: "tool", name: toolName },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new LlmClientError(`Claude API request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new LlmClientError(`Claude API request failed: HTTP ${res.status} -- ${body}`);
    }

    const json = (await res.json()) as {
      model: string;
      content: Array<{ type: string; name?: string; input?: unknown }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    if (json.usage && this.onUsage) {
      this.onUsage({
        model: json.model,
        inputTokens: json.usage.input_tokens,
        outputTokens: json.usage.output_tokens,
      });
    }

    const toolUse = json.content.find((block) => block.type === "tool_use" && block.name === toolName);
    if (!toolUse) {
      throw new LlmClientError(`Claude API response did not include a ${toolName} tool call`);
    }
    return toolUse.input as T;
  }
}

export function createLlmClient(env: NodeJS.ProcessEnv = process.env, onUsage?: (usage: LlmUsage) => void): LlmClient {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmClientError(
      "ANTHROPIC_API_KEY is not set in the environment. Add it to backend/.env.local for local " +
        "dev and to Vercel's project env vars for production -- never commit it.",
    );
  }
  // Identity-linked keys (the default type Console now issues) require the
  // workspace they act in to be named explicitly on every request.
  return new LlmClient(apiKey, fetch, env.ANTHROPIC_WORKSPACE_ID, onUsage);
}
