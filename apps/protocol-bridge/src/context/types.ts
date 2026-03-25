/**
 * Unified History Management Types
 *
 * This module defines unified message types used by the proxy,
 * supporting both content-block tool calls and function-call style fields.
 */

/**
 * Text content block
 */
export interface TextBlock {
  type: "text"
  text: string
}

/**
 * Tool use content block (Anthropic format)
 * Represents an AI request to use a tool
 */
export interface ToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Tool result content block (Anthropic format)
 * Represents the result of a tool execution
 */
export interface ToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

/**
 * Image content block
 */
export interface ImageBlock {
  type: "image"
  source: {
    type: "base64"
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
    data: string
  }
}

/**
 * Thinking content block (Claude extended thinking)
 */
export interface ThinkingBlock {
  type: "thinking"
  thinking: string
}

/**
 * All possible content block types
 */
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock
  | ThinkingBlock

/**
 * Function-call style tool call
 */
export interface FunctionToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

/**
 * Unified message format
 * Supports both content-block and function-call style formats.
 */
export interface UnifiedMessage {
  role: "system" | "user" | "assistant"
  content: string | ContentBlock[]

  // Function-call style tool calls (assistant messages)
  tool_calls?: FunctionToolCall[]

  // Function-call style tool result reference (tool role messages)
  tool_call_id?: string

  // Metadata
  token_count?: number
  created_at?: number
}

/**
 * Truncation result with metadata
 */
export interface TruncationResult {
  messages: UnifiedMessage[]
  was_truncated: boolean
  original_token_count: number
  truncated_token_count: number
  summary_used: boolean
}

/**
 * Tool pair for integrity checking
 */
export interface ToolPair {
  tool_use_id: string
  tool_use_message_index: number
  tool_result_message_index: number | null
  tool_name: string
}

/**
 * Configuration for truncation
 */
export interface TruncationConfig {
  max_context_tokens: number
  summary_trigger_tokens: number
  min_recent_messages: number
  safety_margin_tokens: number
}

/**
 * Default truncation configuration
 * - max_context_tokens: 190K (leaving 10K safety margin for 200K Cloud Code limit)
 * - summary_trigger_tokens: 150K (trigger async summary generation)
 * - min_recent_messages: 5 (always keep at least 5 recent messages)
 * - safety_margin_tokens: 5K (reduced buffer for more context)
 *
 * Note: Increased limits to allow longer conversations and complete responses.
 * The previous 150K limit was too conservative and caused premature truncation.
 */
export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  max_context_tokens: 190_000,
  summary_trigger_tokens: 150_000,
  min_recent_messages: 5,
  safety_margin_tokens: 5_000,
}

/**
 * Helper type guard for TextBlock
 */
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === "text"
}

/**
 * Helper type guard for ToolUseBlock
 */
export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use"
}

/**
 * Helper type guard for ToolResultBlock
 */
export function isToolResultBlock(
  block: ContentBlock
): block is ToolResultBlock {
  return block.type === "tool_result"
}

/**
 * Helper type guard for ImageBlock
 */
export function isImageBlock(block: ContentBlock): block is ImageBlock {
  return block.type === "image"
}

/**
 * Helper type guard for ThinkingBlock
 */
export function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === "thinking"
}

/**
 * Parse content that may be a JSON string or array
 * Returns null if parsing fails or content is not array-like
 */
export function parseContent(content: unknown): ContentBlock[] | null {
  // Already an array
  if (Array.isArray(content)) {
    return content as ContentBlock[]
  }

  // Try to parse JSON string
  if (typeof content === "string") {
    const trimmed = content.trim()
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed as ContentBlock[]
        }
      } catch {
        // Not valid JSON, return null
      }
    }
  }

  return null
}

/**
 * Normalize message content to array format
 * Handles both string and array content
 */
export function normalizeContent(
  content: string | ContentBlock[]
): ContentBlock[] {
  if (typeof content === "string") {
    // Try to parse as JSON array first
    const parsed = parseContent(content)
    if (parsed) {
      return parsed
    }
    // Plain text string - wrap in TextBlock
    return [{ type: "text", text: content }]
  }
  return content
}

/**
 * Extract text from content (string or array)
 */
export function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    // Try to parse as JSON array
    const parsed = parseContent(content)
    if (parsed) {
      return parsed
        .filter(isTextBlock)
        .map((b) => b.text)
        .join("")
    }
    return content
  }

  return content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("")
}
