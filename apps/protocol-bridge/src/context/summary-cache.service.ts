import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common"
import Database from "better-sqlite3"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import { TokenCounterService } from "./token-counter.service"
import { UnifiedMessage, extractText } from "./types"

/**
 * Cached summary record
 */
interface CachedSummary {
  hash: string
  summary_text: string
  token_count: number
  message_count: number
  created_at: number
}

/**
 * Summary Cache Service
 *
 * Lightweight caching for conversation summaries.
 * Key insight: We cache based on the TRUNCATED messages' content hash,
 * not session ID. This works because:
 * 1. Cursor sends full history each time
 * 2. Same truncated portion = same summary needed
 * 3. No need to store original messages
 */
@Injectable()
export class SummaryCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SummaryCacheService.name)
  private db: Database.Database | null = null
  private readonly dbPath: string

  constructor(private readonly tokenCounter: TokenCounterService) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp"
    const dataDir = path.join(homeDir, ".protocol-bridge")

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    this.dbPath = path.join(dataDir, "summary-cache.db")
  }

  onModuleInit() {
    this.initDatabase()
  }

  onModuleDestroy() {
    if (this.db) {
      this.db.close()
    }
  }

  private initDatabase(): void {
    try {
      this.db = new Database(this.dbPath)
      this.db.pragma("journal_mode = WAL")

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS summaries (
          hash TEXT PRIMARY KEY,
          summary_text TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          message_count INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_summaries_last_used
          ON summaries(last_used_at);
      `)

      this.logger.log(`Summary cache initialized at ${this.dbPath}`)

      // Cleanup old entries (older than 7 days)
      this.cleanupOldEntries(7)
    } catch (error) {
      this.logger.error(`Failed to initialize summary cache: ${String(error)}`)
    }
  }

  /**
   * Generate hash for truncated messages
   * Uses content of messages to create a stable hash
   */
  generateHash(messages: UnifiedMessage[]): string {
    const content = messages
      .map((m) => {
        const text = extractText(m.content)
        // Use role + first 200 chars of content for hash
        return `${m.role}:${text.slice(0, 200)}`
      })
      .join("|")

    return crypto
      .createHash("sha256")
      .update(content)
      .digest("hex")
      .slice(0, 32)
  }

  /**
   * Get cached summary for truncated messages
   */
  getCachedSummary(truncatedMessages: UnifiedMessage[]): CachedSummary | null {
    if (!this.db) return null

    const hash = this.generateHash(truncatedMessages)

    try {
      const row = this.db
        .prepare(
          `SELECT hash, summary_text, token_count, message_count, created_at
           FROM summaries WHERE hash = ?`
        )
        .get(hash) as CachedSummary | undefined

      if (row) {
        // Update last_used_at
        this.db
          .prepare(`UPDATE summaries SET last_used_at = ? WHERE hash = ?`)
          .run(Date.now(), hash)

        this.logger.debug(`Cache hit for summary: ${hash.slice(0, 8)}...`)
        return row
      }

      return null
    } catch (error) {
      this.logger.error(`Failed to get cached summary: ${String(error)}`)
      return null
    }
  }

  /**
   * Store summary in cache
   */
  storeSummary(truncatedMessages: UnifiedMessage[], summaryText: string): void {
    if (!this.db) return

    const hash = this.generateHash(truncatedMessages)
    const tokenCount = this.tokenCounter.countText(summaryText)
    const now = Date.now()

    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO summaries
           (hash, summary_text, token_count, message_count, created_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(hash, summaryText, tokenCount, truncatedMessages.length, now, now)

      this.logger.debug(
        `Cached summary: ${hash.slice(0, 8)}... (${tokenCount} tokens, ${truncatedMessages.length} messages)`
      )
    } catch (error) {
      this.logger.error(`Failed to store summary: ${String(error)}`)
    }
  }

  /**
   * Cleanup old cache entries
   */
  private cleanupOldEntries(daysToKeep: number): void {
    if (!this.db) return

    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000

    try {
      const result = this.db
        .prepare(`DELETE FROM summaries WHERE last_used_at < ?`)
        .run(cutoffTime)

      if (result.changes > 0) {
        this.logger.log(
          `Cleaned up ${result.changes} old summary cache entries`
        )
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup old entries: ${String(error)}`)
    }
  }

  /**
   * Get cache stats
   */
  getStats(): { totalEntries: number; totalTokens: number } {
    if (!this.db) return { totalEntries: 0, totalTokens: 0 }

    try {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) as count, COALESCE(SUM(token_count), 0) as tokens FROM summaries`
        )
        .get() as { count: number; tokens: number }

      return { totalEntries: row.count, totalTokens: row.tokens }
    } catch {
      return { totalEntries: 0, totalTokens: 0 }
    }
  }
}
