import { Injectable, Logger } from "@nestjs/common"
import { createSpanContext, generateBlobId } from "./agent-helpers"

export interface KvBlobData {
  blobId: string
  blobData: string // base64 encoded
}

export interface KvServerMessage {
  id?: number
  setBlobArgs?: {
    blobId: string
    blobData: string
  }
  getBlobArgs?: {
    blobId: string
  }
  spanContext?: {
    traceId: string
    spanId: string
    traceFlags: number
  }
}

@Injectable()
export class KvStorageService {
  private readonly logger = new Logger(KvStorageService.name)
  private kvMessageIdCounter = 0
  private blobStore = new Map<string, string>() // blobId -> blobData

  /**
   * Reset KV message ID counter for new conversation
   */
  resetCounter(): void {
    this.kvMessageIdCounter = 0
  }

  /**
   * Get next KV message ID
   */
  private getNextId(): number {
    return ++this.kvMessageIdCounter
  }

  /**
   * Store blob and create setBlobArgs message
   */
  createSetBlobMessage(
    content: unknown,
    traceId?: string,
    includeId: boolean = true
  ): KvServerMessage {
    // Serialize content to JSON and encode to base64
    const jsonContent = JSON.stringify(content)
    const blobData = Buffer.from(jsonContent).toString("base64")
    const blobId = generateBlobId(blobData)

    // Store in local cache
    this.blobStore.set(blobId, blobData)

    const message: KvServerMessage = {
      setBlobArgs: {
        blobId,
        blobData,
      },
    }

    // Add ID if requested (not for first message)
    if (includeId) {
      message.id = this.getNextId()
    }

    // Add span context if traceId provided
    if (traceId) {
      message.spanContext = createSpanContext(traceId)
    }

    this.logger.debug(
      `Created setBlobArgs: id=${message.id}, blobId=${blobId.substring(0, 20)}...`
    )

    return message
  }

  /**
   * Create getBlobArgs message
   */
  createGetBlobMessage(blobId: string, traceId?: string): KvServerMessage {
    const message: KvServerMessage = {
      id: this.getNextId(),
      getBlobArgs: {
        blobId,
      },
    }

    if (traceId) {
      message.spanContext = createSpanContext(traceId)
    }

    return message
  }

  /**
   * Get blob data by ID
   */
  getBlob(blobId: string): string | undefined {
    return this.blobStore.get(blobId)
  }

  /**
   * Clear all stored blobs
   */
  clearBlobs(): void {
    this.blobStore.clear()
    this.logger.debug("Cleared all blob storage")
  }

  /**
   * Get storage statistics
   */
  getStats(): { blobCount: number; messageIdCounter: number } {
    return {
      blobCount: this.blobStore.size,
      messageIdCounter: this.kvMessageIdCounter,
    }
  }
}
