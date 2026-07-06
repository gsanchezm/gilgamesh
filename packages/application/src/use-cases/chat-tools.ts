/**
 * The chat tool registry (slice 9, owner decision S9-4) — the SINGLE source for the tool
 * vocabulary: the Claude API `tools` definitions, the stub's emitted intents, arg validation and
 * the SendChatMessage dispatcher all derive from it. Tool keys are slice-level vocabulary
 * (spec 08/09 §13); they name bindings to EXISTING use cases, never new capabilities.
 */

export interface ChatToolArgSpec {
  type: 'string';
  required: boolean;
  description: string;
}

export interface ChatToolDefinition {
  name: string;
  description: string;
  args: Record<string, ChatToolArgSpec>;
}

export const CHAT_TOOLS: ChatToolDefinition[] = [
  {
    name: 'enqueue_run',
    description: 'Run an authored feature through the standard run path (quota, RBAC and audit apply).',
    args: { featureName: { type: 'string', required: true, description: 'The name of the feature to run.' } },
  },
  {
    name: 'create_test_case',
    description: 'Create a Test Lab test case through the standard authoring path.',
    args: { title: { type: 'string', required: true, description: 'The test case title.' } },
  },
  {
    name: 'generate_feature',
    description: 'Generate draft features for review — nothing is persisted.',
    args: { prompt: { type: 'string', required: true, description: 'What to draft.' } },
  },
];

/** The Anthropic Messages API `tools` parameter shape, generated from the registry (AC-TOOL-03). */
export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export function claudeToolDefinitions(): ClaudeToolDefinition[] {
  return CHAT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(tool.args).map(([field, spec]) => [field, { type: spec.type, description: spec.description }]),
      ),
      required: Object.entries(tool.args)
        .filter(([, spec]) => spec.required)
        .map(([field]) => field),
    },
  }));
}

/**
 * Validates a tool call against the registry. Returns `null` when valid, the literal
 * `'UNREGISTERED'` for a tool outside the whitelist (refused, not audited — AC-TOOL-04), or a
 * human-readable reason naming the offending arg (narrated + audited as INVALID_ARGS — AC-TOOL-02).
 */
export function validateToolArgs(name: string, args: Record<string, unknown>): string | null {
  const tool = CHAT_TOOLS.find((t) => t.name === name);
  if (!tool) return 'UNREGISTERED';
  for (const [field, spec] of Object.entries(tool.args)) {
    const value = args[field];
    if (value == null || (typeof value === 'string' && !value.trim())) {
      if (spec.required) return `missing required arg "${field}"`;
      continue;
    }
    if (typeof value !== spec.type) return `arg "${field}" must be a ${spec.type}`;
  }
  return null;
}
