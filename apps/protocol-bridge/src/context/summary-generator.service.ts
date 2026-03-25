import { Injectable, Logger } from "@nestjs/common"
import { TokenCounterService } from "./token-counter.service"
import { UnifiedMessage, extractText } from "./types"

/**
 * Summary generation result
 */
export interface SummaryResult {
  summary_text: string
  token_count: number
  success: boolean
  error?: string
}

/**
 * Summary Generator Service
 *
 * Generates concise summaries of conversation history using AI.
 * Used when truncation is needed to compress early messages.
 *
 * Design principles:
 * 1. Summary should be much shorter than original (10-20% of original tokens)
 * 2. Preserve key decisions, context, and tool interactions
 * 3. Use same backend as main conversation (Gemini)
 */
@Injectable()
export class SummaryGeneratorService {
  private readonly logger = new Logger(SummaryGeneratorService.name)

  // Target summary length: 10% of original, max 2000 tokens
  private readonly MAX_SUMMARY_TOKENS = 2000
  private readonly SUMMARY_RATIO = 0.1

  constructor(private readonly tokenCounter: TokenCounterService) {}

  /**
   * Generate summary for truncated messages
   *
   * Note: This is a synchronous text-based summary (no AI call).
   * For AI-powered summary, we would need to inject MessagesService,
   * but that creates a circular dependency.
   *
   * Current approach: Extract key information from messages
   * - First user message (original request)
   * - Tool calls and their purposes
   * - Key decisions made
   */
  generateSummary(messages: UnifiedMessage[]): SummaryResult {
    if (messages.length === 0) {
      return {
        summary_text: "",
        token_count: 0,
        success: true,
      }
    }

    try {
      const summaryParts: string[] = []

      // 1. Extract first user message (original request)
      const firstUserMsg = messages.find((m) => m.role === "user")
      if (firstUserMsg) {
        const text = extractText(firstUserMsg.content).slice(0, 500)
        summaryParts.push(`**Original Request:** ${text}`)
      }

      // 2. Count tool interactions
      const toolCalls = this.extractToolCalls(messages)
      if (toolCalls.length > 0) {
        const toolSummary = this.summarizeToolCalls(toolCalls)
        summaryParts.push(`**Actions Taken:** ${toolSummary}`)
      }

      // 3. Extract key decisions/conclusions from assistant messages
      const keyPoints = this.extractKeyPoints(messages)
      if (keyPoints.length > 0) {
        summaryParts.push(
          `**Key Points:**\n${keyPoints.map((p) => `- ${p}`).join("\n")}`
        )
      }

      // 4. Note how many messages were summarized
      summaryParts.push(`\n_[Summary of ${messages.length} earlier messages]_`)

      const summaryText = summaryParts.join("\n\n")
      const tokenCount = this.tokenCounter.countText(summaryText)

      this.logger.debug(
        `Generated summary: ${tokenCount} tokens from ${messages.length} messages`
      )

      return {
        summary_text: summaryText,
        token_count: tokenCount,
        success: true,
      }
    } catch (error) {
      this.logger.error(`Failed to generate summary: ${String(error)}`)
      return {
        summary_text: "",
        token_count: 0,
        success: false,
        error: String(error),
      }
    }
  }

  /**
   * Extract tool calls from messages
   */
  private extractToolCalls(
    messages: UnifiedMessage[]
  ): Array<{ name: string; purpose: string }> {
    const tools: Array<{ name: string; purpose: string }> = []

    for (const msg of messages) {
      if (msg.role !== "assistant") continue

      // Check function-call style format
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          tools.push({
            name: tc.function.name,
            purpose: this.inferToolPurpose(
              tc.function.name,
              tc.function.arguments
            ),
          })
        }
      }

      // Check Anthropic format (content array with tool_use)
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "tool_use"
          ) {
            const toolBlock = block as {
              name: string
              input: Record<string, unknown>
            }
            tools.push({
              name: toolBlock.name,
              purpose: this.inferToolPurpose(
                toolBlock.name,
                JSON.stringify(toolBlock.input)
              ),
            })
          }
        }
      }
    }

    return tools
  }

  /**
   * Infer tool purpose from name and arguments
   */
  private inferToolPurpose(name: string, args: string): string {
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>

      // Helper to safely get string value
      const str = (key: string): string => {
        const val = parsed[key]
        return typeof val === "string" ? val : ""
      }

      switch (name) {
        case "Read":
        case "read_file":
          return `Read ${str("path") || "file"}`
        case "Write":
        case "write_file":
          return `Write ${str("path") || "file"}`
        case "Edit":
        case "str_replace":
          return `Edit ${str("path") || "file"}`
        case "Bash":
        case "execute_command":
          return `Run: ${str("command").slice(0, 50)}`
        case "Grep":
        case "search":
          return `Search: ${str("pattern") || str("query")}`
        case "Glob":
        case "list_files":
          return `Find files: ${str("pattern") || str("glob_pattern")}`
        default:
          return name
      }
    } catch {
      return name
    }
  }

  /**
   * Summarize tool calls into a concise string
   */
  private summarizeToolCalls(
    tools: Array<{ name: string; purpose: string }>
  ): string {
    // Group by tool type
    const grouped = new Map<string, number>()
    const samples: string[] = []

    for (const tool of tools) {
      const count = grouped.get(tool.name) || 0
      grouped.set(tool.name, count + 1)

      // Keep first 3 samples
      if (samples.length < 3 && tool.purpose !== tool.name) {
        samples.push(tool.purpose)
      }
    }

    const parts: string[] = []

    // Summary of tool counts
    const toolCounts = Array.from(grouped.entries())
      .map(([name, count]) => `${name}(${count})`)
      .join(", ")
    parts.push(toolCounts)

    // Add samples
    if (samples.length > 0) {
      parts.push(`Examples: ${samples.join("; ")}`)
    }

    return parts.join(". ")
  }

  /**
   * Extract key points from assistant messages
   */
  private extractKeyPoints(messages: UnifiedMessage[]): string[] {
    const keyPoints: string[] = []
    const maxPoints = 5

    for (const msg of messages) {
      if (msg.role !== "assistant" || keyPoints.length >= maxPoints) continue

      const text = extractText(msg.content)
      if (text.length < 50) continue

      // Look for decision/conclusion patterns
      const patterns = [
        /I(?:'ll| will) (create|modify|update|fix|implement|add|remove|delete)/gi,
        /The (issue|problem|solution|fix|change) is/gi,
        /(?:Based on|After|Following) .{10,50}, I/gi,
        /(?:Successfully|Completed|Fixed|Updated|Created)/gi,
      ]

      for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match && keyPoints.length < maxPoints) {
          // Extract sentence containing the match
          const startIndex = text.indexOf(match[0])
          const endIndex = Math.min(startIndex + 150, text.length)
          const sentence = text.slice(startIndex, endIndex).split(/[.!?\n]/)[0]
          if (sentence && sentence.length > 20) {
            keyPoints.push(sentence.trim())
            break
          }
        }
      }
    }

    return keyPoints
  }

  /**
   * Calculate target summary tokens based on original content
   */
  getTargetTokens(originalTokens: number): number {
    const target = Math.floor(originalTokens * this.SUMMARY_RATIO)
    return Math.min(target, this.MAX_SUMMARY_TOKENS)
  }
}
