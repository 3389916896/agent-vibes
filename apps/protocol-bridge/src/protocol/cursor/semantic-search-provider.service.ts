import { Injectable, Logger } from "@nestjs/common"
import { readdir, readFile, stat } from "fs/promises"
import * as path from "path"

export type SemanticSearchFamily = "semantic_search" | "deep_search"

export interface SemanticSearchHit {
  path: string
  score: number
  snippet?: string
}

export interface SemanticSearchRequest {
  conversationId: string
  family: SemanticSearchFamily
  query: string
  rootPath: string
  targetDirectories: string[]
  maxResults: number
}

export interface SemanticSearchResponse {
  status: "success" | "error" | "unavailable"
  provider: string
  message?: string
  results: SemanticSearchHit[]
}

interface IndexedDocument {
  path: string
  normalizedPath: string
  content: string
  normalizedContent: string
}

interface IndexCacheEntry {
  builtAt: number
  documents: IndexedDocument[]
}

@Injectable()
export class SemanticSearchProviderService {
  private readonly logger = new Logger(SemanticSearchProviderService.name)
  private readonly cache = new Map<string, IndexCacheEntry>()
  private readonly cacheTtlMs = 30_000
  private readonly maxFileBytes = 256_000
  private readonly skipDirs = new Set([
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    ".next",
    "dist",
    "build",
    "target",
    "__pycache__",
    ".idea",
    ".vscode",
  ])

  async search(
    request: SemanticSearchRequest
  ): Promise<SemanticSearchResponse> {
    const normalizedRoot = path.resolve(request.rootPath || process.cwd())
    const queryTokens = this.tokenizeQuery(request.query)

    if (queryTokens.length === 0) {
      return {
        status: "error",
        provider: "local",
        message: "missing query terms",
        results: [],
      }
    }

    try {
      const documents = await this.getIndexedDocuments(
        normalizedRoot,
        request.family,
        request.targetDirectories
      )
      const ranked = this.rankDocuments(
        request.query,
        queryTokens,
        documents
      ).slice(0, Math.max(1, request.maxResults || 1))
      return {
        status: "success",
        provider: "local",
        results: ranked,
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "local semantic search failed"
      this.logger.warn(`local semantic search failed: ${message}`)
      return {
        status: "error",
        provider: "local",
        message,
        results: [],
      }
    }
  }

  private tokenizeQuery(query: string): string[] {
    const raw = query.trim()
    if (!raw) return []

    // Split camelCase/PascalCase and non-word separators for better symbol matching.
    const expanded = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    const tokens = expanded
      .toLowerCase()
      .split(/[^a-z0-9_]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)

    return Array.from(new Set(tokens))
  }

  private normalizeRelativeDirectory(
    rootPath: string,
    value: string
  ): string | undefined {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const asUnix = trimmed.replace(/\\/g, "/").replace(/\/+$/g, "")
    if (!asUnix) return undefined

    if (path.isAbsolute(asUnix)) {
      const relative = path.relative(rootPath, asUnix).replace(/\\/g, "/")
      if (relative.startsWith("..")) return undefined
      return relative.replace(/^\.\/+/g, "").replace(/\/+$/g, "")
    }

    return asUnix.replace(/^\.\/+/g, "").replace(/^\/+/g, "")
  }

  private buildCacheKey(
    rootPath: string,
    family: SemanticSearchFamily,
    targetDirectories: string[]
  ): string {
    const normalizedTargets = targetDirectories
      .map((entry) => this.normalizeRelativeDirectory(rootPath, entry))
      .filter((entry): entry is string => Boolean(entry))
      .sort()
    return `${rootPath}::${family}::${normalizedTargets.join("|")}`
  }

  private async getIndexedDocuments(
    rootPath: string,
    family: SemanticSearchFamily,
    targetDirectories: string[]
  ): Promise<IndexedDocument[]> {
    const cacheKey = this.buildCacheKey(rootPath, family, targetDirectories)
    const cached = this.cache.get(cacheKey)
    const now = Date.now()
    if (cached && now - cached.builtAt < this.cacheTtlMs) {
      return cached.documents
    }

    const maxFiles = family === "deep_search" ? 7_000 : 2_500
    const maxDepth = family === "deep_search" ? 12 : 8
    const discovered = await this.collectWorkspaceFiles(
      rootPath,
      maxFiles,
      maxDepth
    )
    const normalizedTargets = targetDirectories
      .map((entry) => this.normalizeRelativeDirectory(rootPath, entry))
      .filter((entry): entry is string => Boolean(entry))

    const candidateFiles =
      normalizedTargets.length > 0
        ? discovered.filter((file) => {
            const normalized = file.replace(/\\/g, "/")
            return normalizedTargets.some(
              (target) =>
                normalized === target || normalized.startsWith(`${target}/`)
            )
          })
        : discovered

    const documents: IndexedDocument[] = []
    for (const relativeFile of candidateFiles) {
      const abs = path.join(rootPath, relativeFile)
      let fileStats
      try {
        fileStats = await stat(abs)
      } catch {
        continue
      }
      if (!fileStats.isFile()) continue
      if (fileStats.size <= 0 || fileStats.size > this.maxFileBytes) continue

      let content = ""
      try {
        content = await readFile(abs, "utf8")
      } catch {
        continue
      }

      if (!this.looksTextual(content)) continue
      const trimmedContent =
        content.length > 32_000 ? content.slice(0, 32_000) : content
      documents.push({
        path: relativeFile.replace(/\\/g, "/"),
        normalizedPath: relativeFile.replace(/\\/g, "/").toLowerCase(),
        content: trimmedContent,
        normalizedContent: trimmedContent.toLowerCase(),
      })
    }

    this.cache.set(cacheKey, {
      builtAt: now,
      documents,
    })
    return documents
  }

  private async collectWorkspaceFiles(
    rootPath: string,
    maxFiles: number,
    maxDepth: number
  ): Promise<string[]> {
    const files: string[] = []
    const queue: Array<{ abs: string; rel: string; depth: number }> = [
      { abs: rootPath, rel: "", depth: 0 },
    ]

    while (queue.length > 0 && files.length < maxFiles) {
      const current = queue.pop()
      if (!current) break
      let entries: Array<{
        isDirectory: () => boolean
        isFile: () => boolean
        name: string
      }> = []
      try {
        entries = (await readdir(current.abs, {
          withFileTypes: true,
        })) as Array<{
          isDirectory: () => boolean
          isFile: () => boolean
          name: string
        }>
      } catch {
        continue
      }

      for (const entry of entries) {
        const rel = current.rel
          ? path.join(current.rel, entry.name)
          : entry.name
        const abs = path.join(current.abs, entry.name)

        if (entry.isDirectory()) {
          if (current.depth >= maxDepth) continue
          if (this.skipDirs.has(entry.name)) continue
          queue.push({ abs, rel, depth: current.depth + 1 })
          continue
        }

        if (!entry.isFile()) continue
        files.push(rel)
        if (files.length >= maxFiles) break
      }
    }

    return files
  }

  private looksTextual(content: string): boolean {
    if (!content) return false
    const sample = content.slice(0, 1_200)
    let controlChars = 0
    for (let i = 0; i < sample.length; i += 1) {
      const code = sample.charCodeAt(i)
      if (code === 0) return false
      if (code < 9 || (code > 13 && code < 32)) controlChars += 1
    }
    return controlChars / sample.length < 0.03
  }

  private countOccurrences(haystack: string, needle: string): number {
    if (!needle) return 0
    let count = 0
    let cursor = 0
    while (cursor < haystack.length) {
      const idx = haystack.indexOf(needle, cursor)
      if (idx < 0) break
      count += 1
      cursor = idx + needle.length
    }
    return count
  }

  private buildSnippet(
    content: string,
    queryTokens: string[]
  ): string | undefined {
    if (!content) return undefined
    const normalized = content.toLowerCase()
    let hitIndex = -1
    for (const token of queryTokens) {
      const idx = normalized.indexOf(token)
      if (idx >= 0 && (hitIndex < 0 || idx < hitIndex)) {
        hitIndex = idx
      }
    }

    if (hitIndex < 0) {
      return content.replace(/\s+/g, " ").trim().slice(0, 140) || undefined
    }

    const start = Math.max(0, hitIndex - 70)
    const end = Math.min(content.length, hitIndex + 180)
    const snippet = content.slice(start, end).replace(/\s+/g, " ").trim()
    return snippet || undefined
  }

  private rankDocuments(
    query: string,
    queryTokens: string[],
    documents: IndexedDocument[]
  ): SemanticSearchHit[] {
    const phrase = query.trim().toLowerCase()
    const compactPhrase = phrase.replace(/\s+/g, "")
    const results: SemanticSearchHit[] = []

    for (const doc of documents) {
      let score = 0
      let matchedTokens = 0

      for (const token of queryTokens) {
        const pathHits = this.countOccurrences(doc.normalizedPath, token)
        const contentHits = this.countOccurrences(doc.normalizedContent, token)
        if (pathHits + contentHits > 0) matchedTokens += 1
        score += pathHits * 3.5
        score += Math.min(contentHits, 8) * 1.1
      }

      if (phrase && doc.normalizedContent.includes(phrase)) {
        score += 8
      }
      if (compactPhrase && doc.normalizedPath.includes(compactPhrase)) {
        score += 4
      }
      if (matchedTokens === queryTokens.length && queryTokens.length > 0) {
        score += 3
      }

      if (score <= 0) continue
      results.push({
        path: doc.path,
        score: Number(score.toFixed(4)),
        snippet: this.buildSnippet(doc.content, queryTokens),
      })
    }

    return results.sort(
      (a, b) => b.score - a.score || a.path.localeCompare(b.path)
    )
  }
}
