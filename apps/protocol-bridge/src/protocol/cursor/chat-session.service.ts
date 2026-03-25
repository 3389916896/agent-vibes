import { Injectable, Logger } from "@nestjs/common"
import { ParsedCursorRequest } from "./cursor-request-parser"

/**
 * Content block types for messages
 */
type MessageContent = string | Array<{ type: string; [key: string]: unknown }>

export type SessionTodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"

export interface SessionTodoItem {
  id: string
  content: string
  status: SessionTodoStatus
  createdAt: number
  updatedAt: number
  dependencies: string[]
}

/**
 * Chat session state for bidirectional streaming
 */
export interface ChatSession {
  conversationId: string
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>
  model: string
  thinkingLevel: number
  isAgentic: boolean
  supportedTools: string[]
  mcpToolDefs?: ParsedCursorRequest["mcpToolDefs"]
  useWeb: boolean
  createdAt: Date
  lastActivityAt: Date

  // Pending tool calls waiting for results
  pendingToolCalls: Map<string, PendingToolCall>
  // ExecServerMessage.id -> toolCallId mapping for control messages/tool results
  pendingToolCallByExecId: Map<number, string>

  // Context from initial request
  projectContext?: ParsedCursorRequest["projectContext"]
  codeChunks?: ParsedCursorRequest["codeChunks"]
  cursorRules?: string[]
  explicitContext?: string
  contextTokenLimit?: number
  usedContextTokens?: number
  requestedMaxOutputTokens?: number
  requestedModelParameters?: Record<string, string>

  // Checkpoint tracking for multi-turn conversations
  usedTokens: number
  readPaths: Set<string>
  fileStates: Map<string, { beforeContent: string; afterContent: string }>

  // Message history with blobIds for checkpoint
  messageBlobIds: string[] // SHA-256 hashes from KV storage
  turns: string[] // Turn identifiers (cumulative)
  currentAssistantMessage?: Record<string, unknown> // Current assistant message being built

  // Protocol counters (session-level, monotonically increasing)
  stepId: number // StepStarted/StepCompleted counter
  execId: number // ExecServerMessage.id counter

  // InteractionQuery pending resolvers
  pendingInteractionQueries: Map<
    number,
    {
      resolve: (response: any) => void
      reject: (error: Error) => void
      queryType: string
      payload?: Record<string, unknown>
    }
  >
  interactionQueryId: number // auto-incrementing counter

  // Session-local web document cache for read_url_content/view_content_chunk
  webDocuments: Map<
    string,
    {
      url: string
      title: string
      contentType: string
      chunks: string[]
      createdAt: Date
    }
  >
  todos: SessionTodoItem[]

  // Sub-agent context (active when a task tool call is running a sub-agent)
  subAgentContext?: SubAgentContext
}

export interface PendingToolCall {
  toolCallId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolFamilyHint?: "mcp"
  modelCallId: string
  startedEmitted: boolean
  sentAt: Date
  execIds: Set<number>
  editApplyWarning?: string
  beforeContent?: string // File content before edit (for edit tools)
  // Shell stream accumulation (for streaming shell output)
  shellStreamOutput?: {
    stdout: string[]
    stderr: string[]
    exitCode?: number
    signal?: string
    started: boolean
  }
}

/**
 * Sub-agent execution context for the task tool.
 * Stored in the parent ChatSession while a sub-agent is running.
 *
 * Event-driven state machine: the sub-agent loop is NOT a blocking loop.
 * Instead, each phase dispatches exec messages and returns. When the bidi
 * handler receives the tool results, it calls back into the sub-agent to
 * start the next LLM turn.
 */
export interface SubAgentContext {
  /** The task tool call ID in the parent */
  parentToolCallId: string
  /** For Cursor UI correlation */
  parentModelCallId: string
  /** Unique sub-agent identifier */
  subagentId: string
  /** Sub-agent conversation history (Anthropic format) */
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>
  /** LLM model for the sub-agent */
  model: string
  /** Tool definitions available to the sub-agent */
  tools: unknown[]
  /** Accumulated text from the current sub-agent turn */
  accumulatedText: string
  /** Tool call IDs that belong to this sub-agent (for routing results) */
  pendingToolCallIds: Set<string>
  /** Start time for duration tracking */
  startTime: number
  /** Number of LLM turns completed */
  turnCount: number
  /** Total tool calls made by the sub-agent */
  toolCallCount: number
  /** Modified file paths (for SubagentStopRequestQuery) */
  modifiedFiles: string[]

  // ── Event-driven state machine fields ──

  /** Tool calls from the current LLM turn, pending dispatch & results */
  currentTurnToolCalls: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }>
  /** Tool results collected so far for the current turn */
  pendingToolResults: Map<string, SubAgentToolResult>
  /** IDs of tools we are still waiting for (subset of currentTurnToolCalls) */
  expectedToolCallIds: Set<string>
}

export interface SubAgentToolResult {
  toolCallId: string
  content: string
  resultData: Buffer
  resultCase: string
}

@Injectable()
export class ChatSessionManager {
  private readonly logger = new Logger(ChatSessionManager.name)
  private readonly sessions = new Map<string, ChatSession>()
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes

  constructor() {
    // Cleanup expired sessions every 5 minutes
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000)
  }

  /**
   * Touch session activity timestamp to keep long-lived tool/interaction turns alive.
   */
  touchSession(conversationId: string): boolean {
    const session = this.sessions.get(conversationId)
    if (!session) return false
    session.lastActivityAt = new Date()
    return true
  }

  /**
   * Create or get existing session
   */
  getOrCreateSession(
    conversationId: string,
    initialRequest?: ParsedCursorRequest
  ): ChatSession {
    let session = this.sessions.get(conversationId)

    if (!session) {
      session = {
        conversationId,
        messages: initialRequest?.conversation || [],
        model: initialRequest?.model || "claude-sonnet-4.5",
        thinkingLevel: initialRequest?.thinkingLevel || 0,
        isAgentic: initialRequest?.isAgentic || false,
        supportedTools: initialRequest?.supportedTools || [],
        mcpToolDefs: initialRequest?.mcpToolDefs,
        useWeb: initialRequest?.useWeb || false,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        pendingToolCalls: new Map(),
        pendingToolCallByExecId: new Map(),
        projectContext: initialRequest?.projectContext,
        codeChunks: initialRequest?.codeChunks,
        cursorRules: initialRequest?.cursorRules,
        explicitContext: initialRequest?.explicitContext,
        contextTokenLimit: initialRequest?.contextTokenLimit,
        usedContextTokens: initialRequest?.usedContextTokens,
        requestedMaxOutputTokens: initialRequest?.requestedMaxOutputTokens,
        requestedModelParameters: initialRequest?.requestedModelParameters,
        usedTokens: initialRequest?.usedContextTokens || 0,
        readPaths: new Set(),
        fileStates: new Map(),
        messageBlobIds: [],
        turns: [],
        currentAssistantMessage: undefined,
        stepId: 0,
        execId: 1,
        pendingInteractionQueries: new Map(),
        interactionQueryId: 0,
        webDocuments: new Map(),
        todos: [],
      }

      this.sessions.set(conversationId, session)
      this.logger.log(
        `>>> Created new session: ${conversationId} (model: ${session.model})`
      )
    } else {
      // Update last activity
      session.lastActivityAt = new Date()

      // Refresh protocol fields on every turn so continuation strictly follows Cursor request.
      if (initialRequest?.model) {
        session.model = initialRequest.model
      }
      if (initialRequest?.thinkingLevel !== undefined) {
        session.thinkingLevel = initialRequest.thinkingLevel
      }
      if (initialRequest?.supportedTools) {
        session.supportedTools = initialRequest.supportedTools
      }
      if (initialRequest) {
        session.mcpToolDefs = initialRequest.mcpToolDefs
      }
      if (initialRequest?.useWeb !== undefined) {
        session.useWeb = initialRequest.useWeb
      }
      if (initialRequest?.projectContext) {
        session.projectContext = initialRequest.projectContext
      }
      if (initialRequest?.cursorRules) {
        session.cursorRules = initialRequest.cursorRules
      }
      if (initialRequest?.explicitContext) {
        session.explicitContext = initialRequest.explicitContext
      }
      if (initialRequest?.contextTokenLimit !== undefined) {
        session.contextTokenLimit = initialRequest.contextTokenLimit
      }
      if (initialRequest?.usedContextTokens !== undefined) {
        session.usedContextTokens = initialRequest.usedContextTokens
        session.usedTokens = initialRequest.usedContextTokens
      }
      if (initialRequest?.requestedMaxOutputTokens !== undefined) {
        session.requestedMaxOutputTokens =
          initialRequest.requestedMaxOutputTokens
      }
      if (initialRequest?.requestedModelParameters) {
        session.requestedModelParameters =
          initialRequest.requestedModelParameters
      }

      this.logger.log(
        `>>> Using existing session: ${conversationId} (blobIds: ${session.messageBlobIds.length}, turns: ${session.turns.length})`
      )
    }

    return session
  }

  /**
   * Update session with new message
   */
  addMessage(
    conversationId: string,
    role: "user" | "assistant",
    content: MessageContent
  ): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.messages.push({ role, content })
      session.lastActivityAt = new Date()

      // Estimate token usage (rough estimate: 1 token ≈ 4 characters)
      const contentStr =
        typeof content === "string" ? content : JSON.stringify(content)
      session.usedTokens += Math.ceil(contentStr.length / 4)
    }
  }

  /**
   * Add blobId to session's message history
   * This is used for building conversationCheckpointUpdate
   */
  addMessageBlobId(conversationId: string, blobId: string): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.lastActivityAt = new Date()
      session.messageBlobIds.push(blobId)
      this.logger.log(
        `>>> Added blobId to session ${conversationId}: ${blobId.substring(0, 20)}... (total: ${session.messageBlobIds.length})`
      )
    } else {
      this.logger.error(
        `>>> FAILED to add blobId - session not found: ${conversationId}`
      )
    }
  }

  /**
   * Add a new turn to the session
   * Turns are cumulative identifiers for each conversation round
   */
  addTurn(conversationId: string, turnId: string): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.lastActivityAt = new Date()
      session.turns.push(turnId)
      this.logger.log(
        `>>> Added turn ${session.turns.length} to session ${conversationId}: ${turnId.substring(0, 20)}...`
      )
    } else {
      this.logger.error(
        `>>> FAILED to add turn - session not found: ${conversationId}`
      )
    }
  }

  /**
   * Set current assistant message being built
   */
  setCurrentAssistantMessage(
    conversationId: string,
    message: Record<string, unknown>
  ): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.lastActivityAt = new Date()
      session.currentAssistantMessage = message
    }
  }

  /**
   * Clear current assistant message
   */
  clearCurrentAssistantMessage(conversationId: string): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.lastActivityAt = new Date()
      session.currentAssistantMessage = undefined
    }
  }

  /**
   * Track file read operation
   */
  addReadPath(conversationId: string, filePath: string): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.lastActivityAt = new Date()
      session.readPaths.add(filePath)
    }
  }

  /**
   * Initialize shell stream output tracking for a tool call
   */
  initShellStream(conversationId: string, toolCallId: string): void {
    const session = this.sessions.get(conversationId)
    if (!session) return

    const pendingCall = session.pendingToolCalls.get(toolCallId)
    if (pendingCall) {
      session.lastActivityAt = new Date()
      pendingCall.shellStreamOutput = {
        stdout: [],
        stderr: [],
        started: false,
      }
      this.logger.debug(`Initialized shell stream for ${toolCallId}`)
    }
  }

  /**
   * Append shell stream stdout
   */
  appendShellStdout(
    conversationId: string,
    toolCallId: string,
    data: string
  ): void {
    const session = this.sessions.get(conversationId)
    if (!session) return

    const pendingCall = session.pendingToolCalls.get(toolCallId)
    if (pendingCall?.shellStreamOutput) {
      session.lastActivityAt = new Date()
      pendingCall.shellStreamOutput.stdout.push(data)
      this.logger.debug(`Appended ${data.length} chars stdout to ${toolCallId}`)
    }
  }

  /**
   * Append shell stream stderr
   */
  appendShellStderr(
    conversationId: string,
    toolCallId: string,
    data: string
  ): void {
    const session = this.sessions.get(conversationId)
    if (!session) return

    const pendingCall = session.pendingToolCalls.get(toolCallId)
    if (pendingCall?.shellStreamOutput) {
      session.lastActivityAt = new Date()
      pendingCall.shellStreamOutput.stderr.push(data)
      this.logger.debug(`Appended ${data.length} chars stderr to ${toolCallId}`)
    }
  }

  /**
   * Mark shell stream as started
   */
  markShellStarted(conversationId: string, toolCallId: string): void {
    const session = this.sessions.get(conversationId)
    if (!session) return

    const pendingCall = session.pendingToolCalls.get(toolCallId)
    if (pendingCall?.shellStreamOutput) {
      session.lastActivityAt = new Date()
      pendingCall.shellStreamOutput.started = true
      this.logger.debug(`Marked shell started for ${toolCallId}`)
    }
  }

  /**
   * Set shell stream exit info
   */
  setShellExit(
    conversationId: string,
    toolCallId: string,
    exitCode: number,
    signal?: string
  ): void {
    const session = this.sessions.get(conversationId)
    if (!session) return

    const pendingCall = session.pendingToolCalls.get(toolCallId)
    if (pendingCall?.shellStreamOutput) {
      session.lastActivityAt = new Date()
      pendingCall.shellStreamOutput.exitCode = exitCode
      pendingCall.shellStreamOutput.signal = signal
      this.logger.debug(
        `Set shell exit for ${toolCallId}: code=${exitCode}, signal=${signal}`
      )
    }
  }

  /**
   * Get accumulated shell output
   */
  getShellOutput(
    conversationId: string,
    toolCallId: string
  ): { stdout: string; stderr: string; exitCode?: number } | null {
    const session = this.sessions.get(conversationId)
    if (!session) return null

    const pendingCall = session.pendingToolCalls.get(toolCallId)
    if (!pendingCall?.shellStreamOutput) return null

    return {
      stdout: pendingCall.shellStreamOutput.stdout.join(""),
      stderr: pendingCall.shellStreamOutput.stderr.join(""),
      exitCode: pendingCall.shellStreamOutput.exitCode,
    }
  }

  /**
   * Check if shell stream is complete (has exit event)
   */
  isShellStreamComplete(conversationId: string, toolCallId: string): boolean {
    const session = this.sessions.get(conversationId)
    if (!session) return false

    const pendingCall = session.pendingToolCalls.get(toolCallId)
    return pendingCall?.shellStreamOutput?.exitCode !== undefined
  }

  /**
   * Track file edit operation
   */
  addFileState(
    conversationId: string,
    filePath: string,
    beforeContent: string,
    afterContent: string
  ): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.lastActivityAt = new Date()
      session.fileStates.set(filePath, { beforeContent, afterContent })
    }
  }

  /**
   * Add pending tool call
   */
  async addPendingToolCall(
    conversationId: string,
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolFamilyHint?: "mcp",
    modelCallId: string = ""
  ): Promise<void> {
    const session = this.sessions.get(conversationId)
    if (session) {
      // For edit tools, capture file content BEFORE the edit
      let beforeContent: string | undefined
      if (toolName === "edit_file_v2" || toolName === "edit") {
        const filePath = (toolInput as { path?: string })?.path
        if (filePath) {
          try {
            const fs = await import("fs/promises")
            beforeContent = await fs.readFile(filePath, "utf-8")
            this.logger.debug(
              `Captured before content for ${filePath}: ${beforeContent.length} bytes`
            )
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e)
            this.logger.warn(
              `Failed to read file before edit: ${filePath} - ${errorMessage}`
            )
          }
        }
      }

      session.pendingToolCalls.set(toolCallId, {
        toolCallId,
        toolName,
        toolInput,
        toolFamilyHint,
        modelCallId,
        startedEmitted: false,
        sentAt: new Date(),
        execIds: new Set(),
        beforeContent,
      })
      session.lastActivityAt = new Date()
      this.logger.debug(
        `Added pending tool call: ${toolCallId} (${toolName}) for session ${conversationId}`
      )
    }
  }

  /**
   * Get and remove pending tool call
   */
  consumePendingToolCall(
    conversationId: string,
    toolCallId: string
  ): PendingToolCall | undefined {
    const session = this.sessions.get(conversationId)
    if (session) {
      const toolCall = session.pendingToolCalls.get(toolCallId)
      if (toolCall) {
        // Remove all execId mappings associated with this tool call.
        for (const execId of toolCall.execIds) {
          session.pendingToolCallByExecId.delete(execId)
        }
        // Defensive cleanup in case execIds set was incomplete.
        for (const [
          execId,
          mappedToolCallId,
        ] of session.pendingToolCallByExecId) {
          if (mappedToolCallId === toolCallId) {
            session.pendingToolCallByExecId.delete(execId)
          }
        }
        session.pendingToolCalls.delete(toolCallId)
        session.lastActivityAt = new Date()
        this.logger.debug(
          `Consumed tool call: ${toolCallId} for session ${conversationId}`
        )
        return toolCall
      }
    }
    return undefined
  }

  registerPendingToolExecId(
    conversationId: string,
    toolCallId: string,
    execIdNumber: number
  ): boolean {
    const session = this.sessions.get(conversationId)
    if (!session) return false
    if (!Number.isFinite(execIdNumber) || execIdNumber <= 0) return false

    const pending = session.pendingToolCalls.get(toolCallId)
    if (!pending) {
      this.logger.warn(
        `registerPendingToolExecId: pending tool call not found: ${toolCallId}`
      )
      return false
    }

    const normalizedExecId = Math.floor(execIdNumber)
    session.pendingToolCallByExecId.set(normalizedExecId, toolCallId)
    pending.execIds.add(normalizedExecId)
    session.lastActivityAt = new Date()
    this.logger.debug(
      `Mapped execId=${normalizedExecId} -> toolCallId=${toolCallId} for session ${conversationId}`
    )
    return true
  }

  markPendingToolCallStarted(conversationId: string, toolCallId: string): void {
    const session = this.sessions.get(conversationId)
    if (!session) return
    const pending = session.pendingToolCalls.get(toolCallId)
    if (!pending) return
    session.lastActivityAt = new Date()
    pending.startedEmitted = true
  }

  getPendingToolCallIdByExecId(
    conversationId: string,
    execIdNumber: number
  ): string | undefined {
    const session = this.sessions.get(conversationId)
    if (!session) return undefined
    if (!Number.isFinite(execIdNumber) || execIdNumber <= 0) return undefined
    return session.pendingToolCallByExecId.get(Math.floor(execIdNumber))
  }

  consumePendingToolCallByExecId(
    conversationId: string,
    execIdNumber: number
  ): PendingToolCall | undefined {
    const toolCallId = this.getPendingToolCallIdByExecId(
      conversationId,
      execIdNumber
    )
    if (!toolCallId) return undefined
    return this.consumePendingToolCall(conversationId, toolCallId)
  }

  /**
   * Register an InteractionQuery, returns {id, promise}
   * The promise resolves when the client replies with an InteractionResponse
   */
  registerInteractionQuery(
    conversationId: string,
    queryType: string,
    payload?: Record<string, unknown>
  ): { id: number; promise: Promise<any> } {
    const session = this.sessions.get(conversationId)
    if (!session) {
      throw new Error(`Session not found: ${conversationId}`)
    }

    session.interactionQueryId++
    const queryId = session.interactionQueryId

    let resolve!: (response: any) => void
    let reject!: (error: Error) => void
    const promise = new Promise<any>((res, rej) => {
      resolve = res
      reject = rej
    })

    session.pendingInteractionQueries.set(queryId, {
      resolve,
      reject,
      queryType,
      payload,
    })
    session.lastActivityAt = new Date()

    this.logger.log(
      `Registered InteractionQuery id=${queryId} type=${queryType} for ${conversationId}`
    )

    return { id: queryId, promise }
  }

  /**
   * Parse InteractionResponse and resolve the corresponding pending query
   */
  resolveInteractionQuery(
    conversationId: string,
    queryId: number,
    response: any
  ): { queryType: string; payload?: Record<string, unknown> } | null {
    const session = this.sessions.get(conversationId)
    if (!session) {
      this.logger.warn(
        `resolveInteractionQuery: session not found ${conversationId}`
      )
      return null
    }

    const pending = session.pendingInteractionQueries.get(queryId)
    if (!pending) {
      this.logger.warn(
        `resolveInteractionQuery: no pending query id=${queryId}`
      )
      return null
    }

    this.logger.log(
      `Resolve InteractionQuery id=${queryId} type=${pending.queryType}`
    )
    pending.resolve(response)
    session.pendingInteractionQueries.delete(queryId)
    session.lastActivityAt = new Date()
    return {
      queryType: pending.queryType,
      payload: pending.payload,
    }
  }

  /**
   * Get session
   */
  getSession(conversationId: string): ChatSession | undefined {
    return this.sessions.get(conversationId)
  }

  /**
   * Delete session
   */
  deleteSession(conversationId: string): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.pendingInteractionQueries.clear()
    }
    this.sessions.delete(conversationId)
    this.logger.log(`Deleted session: ${conversationId}`)
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now()
    let cleanedCount = 0

    for (const [conversationId, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt.getTime() <= this.SESSION_TIMEOUT) {
        continue
      }

      const hasPendingWork =
        session.pendingToolCalls.size > 0 ||
        session.pendingInteractionQueries.size > 0
      if (hasPendingWork) {
        this.logger.debug(
          `Skipping cleanup for session ${conversationId}: pendingToolCalls=${session.pendingToolCalls.size}, pendingInteractionQueries=${session.pendingInteractionQueries.size}`
        )
        continue
      }

      this.sessions.delete(conversationId)
      cleanedCount++
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} expired session(s)`)
    }
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number
    activeSessions: number
    oldestSession: Date | null
  } {
    const now = Date.now()
    let activeSessions = 0
    let oldestSession: Date | null = null

    for (const session of this.sessions.values()) {
      if (now - session.lastActivityAt.getTime() < 5 * 60 * 1000) {
        activeSessions++
      }
      if (!oldestSession || session.createdAt < oldestSession) {
        oldestSession = session.createdAt
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      oldestSession,
    }
  }

  // ── Sub-Agent Context helpers ──────────────────────────

  setSubAgentContext(conversationId: string, context: SubAgentContext): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.subAgentContext = context
      session.lastActivityAt = new Date()
      this.logger.log(
        `Set SubAgentContext for ${conversationId}: subagentId=${context.subagentId}, parentToolCallId=${context.parentToolCallId}`
      )
    }
  }

  getSubAgentContext(conversationId: string): SubAgentContext | undefined {
    return this.sessions.get(conversationId)?.subAgentContext
  }

  clearSubAgentContext(conversationId: string): void {
    const session = this.sessions.get(conversationId)
    if (session) {
      session.subAgentContext = undefined
      session.lastActivityAt = new Date()
      this.logger.log(`Cleared SubAgentContext for ${conversationId}`)
    }
  }

  /**
   * Check if a tool call ID belongs to the active sub-agent.
   */
  isSubAgentToolCall(conversationId: string, toolCallId: string): boolean {
    const ctx = this.sessions.get(conversationId)?.subAgentContext
    return !!ctx && ctx.pendingToolCallIds.has(toolCallId)
  }
}
