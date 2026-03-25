export interface ToolProtocolMessage {
  role: "user" | "assistant"
  content: unknown
}

export interface ToolProtocolNormalizationResult<
  T extends ToolProtocolMessage = ToolProtocolMessage,
> {
  messages: T[]
  removedToolResults: number
  changed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function extractImmediateToolUseIds(content: unknown): Set<string> {
  const ids = new Set<string>()
  if (!Array.isArray(content)) return ids

  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type !== "tool_use") continue
    const id = typeof block.id === "string" ? block.id : ""
    if (id) ids.add(id)
  }

  return ids
}

/**
 * Normalize tool protocol messages for strict backends (e.g. Cloud Code):
 * - user.tool_result must map to a tool_use in the immediately previous assistant message.
 * - invalid tool_result blocks are removed.
 * - if a user content array becomes empty after removal, it falls back to "." text.
 */
export function normalizeToolProtocolMessages<T extends ToolProtocolMessage>(
  messages: T[]
): ToolProtocolNormalizationResult<T> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, removedToolResults: 0, changed: false }
  }

  let removedToolResults = 0
  let changed = false
  const normalized: T[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (!message) continue

    const previous = normalized[normalized.length - 1]
    const allowedToolUseIds =
      previous?.role === "assistant"
        ? extractImmediateToolUseIds(previous.content)
        : new Set<string>()

    if (message.role !== "user" || !Array.isArray(message.content)) {
      normalized.push(message)
      continue
    }

    const filteredContent = message.content.filter((block) => {
      if (!isRecord(block)) return true
      if (block.type !== "tool_result") return true

      const toolUseId =
        typeof block.tool_use_id === "string" ? block.tool_use_id : ""
      const valid = toolUseId.length > 0 && allowedToolUseIds.has(toolUseId)
      if (!valid) {
        removedToolResults += 1
        changed = true
      }
      return valid
    })

    if (filteredContent.length === message.content.length) {
      normalized.push(message)
      continue
    }

    if (filteredContent.length === 0) {
      normalized.push({ ...message, content: "." } as T)
      continue
    }

    normalized.push({ ...message, content: filteredContent } as T)
  }

  return { messages: normalized, removedToolResults, changed }
}
