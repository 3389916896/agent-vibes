import { Module } from "@nestjs/common"
import { TokenCounterService } from "./token-counter.service"
import { ToolIntegrityService } from "./tool-integrity.service"
import { ConversationTruncatorService } from "./conversation-truncator.service"
import { SummaryCacheService } from "./summary-cache.service"
import { SummaryGeneratorService } from "./summary-generator.service"

/**
 * History Module
 *
 * Provides unified conversation history management for proxy request paths.
 *
 * Components:
 * - TokenCounterService: Accurate token counting (tiktoken)
 * - ToolIntegrityService: Tool use/result pair integrity
 * - ConversationTruncatorService: Token-based truncation with summary
 * - SummaryCacheService: Cache for generated summaries
 * - SummaryGeneratorService: Generate summaries for truncated messages
 *
 * Design:
 * - Cursor client manages its own history
 * - We only truncate when exceeding backend token limits
 * - Summaries are generated for truncated messages and cached
 */
@Module({
  providers: [
    TokenCounterService,
    ToolIntegrityService,
    SummaryCacheService,
    SummaryGeneratorService,
    ConversationTruncatorService,
  ],
  exports: [
    TokenCounterService,
    ToolIntegrityService,
    ConversationTruncatorService,
    SummaryCacheService,
    SummaryGeneratorService,
  ],
})
export class HistoryModule {}
