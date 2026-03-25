import { Injectable, Logger } from "@nestjs/common"
import {
  DEFAULT_GEMINI_MODEL,
  detectModelFamily,
  isOpusModel,
  resolveCloudCodeModel,
} from "./model-registry"

/**
 * Backend types for routing.
 * - google: Gemini-family models via Google Cloud Code
 * - google-claude: Claude family models served by Google Cloud Code
 * - codex: OpenAI GPT/O-series models via Codex reverse proxy
 */
export type BackendType = "google" | "google-claude" | "codex"

/**
 * Model routing result
 */
export interface ModelRouteResult {
  backend: BackendType
  model: string
  isThinking: boolean
}

@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name)

  private googleAvailable = false
  private codexAvailable = false

  /**
   * Keep availability check so startup behavior remains explicit.
   */
  async initializeRouting(
    googleCheck: () => Promise<boolean>,
    codexCheck?: () => Promise<boolean>
  ): Promise<void> {
    this.logger.log("=== Testing Backend APIs ===")

    this.googleAvailable = await googleCheck().catch((e) => {
      this.logger.error(
        `Google Cloud Code check error: ${(e as Error).message}`
      )
      return false
    })

    if (codexCheck) {
      this.codexAvailable = await codexCheck().catch((e) => {
        this.logger.error(`Codex check error: ${(e as Error).message}`)
        return false
      })
    }

    this.logger.log("=== Backend Availability ===")
    this.logger.log(`  Google Cloud Code: ${this.googleAvailable ? "✓" : "✗"}`)
    this.logger.log(`  Codex (OpenAI):    ${this.codexAvailable ? "✓" : "✗"}`)
    this.logger.log("=== Routing Decision ===")
    this.logger.log("  Gemini/Claude models -> Google backend")
    if (this.codexAvailable) {
      this.logger.log("  GPT/O-series models  -> Codex backend")
    } else {
      this.logger.log("  GPT/O-series models  -> Google fallback (no Codex)")
    }
    this.logger.log("========================")
  }

  /**
   * Resolve model to appropriate backend.
   * Uses unified model-registry for all name resolution.
   */
  resolveModel(cursorModel: string): ModelRouteResult {
    const normalized = cursorModel.toLowerCase().trim()
    const family = detectModelFamily(normalized)
    const entry = resolveCloudCodeModel(normalized)

    // 1. Known model with registry entry
    if (entry) {
      // GPT family → Codex backend (if available)
      if (entry.family === "gpt") {
        if (this.codexAvailable) {
          this.logger.log(
            `[ROUTE] ${cursorModel} -> Codex | ${entry.cloudCodeId}`
          )
          return {
            backend: "codex",
            model: entry.cloudCodeId,
            isThinking: entry.isThinking,
          }
        }

        this.logger.warn(
          `[ROUTE] ${cursorModel} requested but no Codex backend available, rerouting to ${DEFAULT_GEMINI_MODEL}`
        )
        return {
          backend: "google",
          model: DEFAULT_GEMINI_MODEL,
          isThinking: false,
        }
      }

      // Claude/Gemini → Google backend
      const backend: BackendType = entry.isClaudeThroughGoogle
        ? "google-claude"
        : "google"
      this.logger.log(
        `[ROUTE] ${cursorModel} -> Google Cloud Code${entry.isClaudeThroughGoogle ? " Claude" : ""} | ${entry.cloudCodeId}`
      )
      return {
        backend,
        model: entry.cloudCodeId,
        isThinking: entry.isThinking,
      }
    }

    // 2. Claude Opus not in registry -> default Opus
    if (isOpusModel(normalized)) {
      this.logger.log(
        `[ROUTE] ${cursorModel} -> Google Cloud Code Claude | claude-opus-4-6-thinking`
      )
      return {
        backend: "google-claude",
        model: "claude-opus-4-6-thinking",
        isThinking: true,
      }
    }

    // 3. GPT family -> Codex if available, else fallback to Gemini
    if (family === "gpt") {
      if (this.codexAvailable) {
        this.logger.log(
          `[ROUTE] ${cursorModel} -> Codex | ${normalized}`
        )
        return {
          backend: "codex",
          model: normalized,
          isThinking:
            normalized.startsWith("o3") ||
            normalized.startsWith("o4") ||
            normalized.startsWith("codex"),
        }
      }
      this.logger.warn(
        `[ROUTE] ${cursorModel} requested but no Codex backend available, rerouting to ${DEFAULT_GEMINI_MODEL}`
      )
      return {
        backend: "google",
        model: DEFAULT_GEMINI_MODEL,
        isThinking: false,
      }
    }

    // 4. Known family but not in registry -> reroute to default
    if (family === "claude") {
      this.logger.warn(
        `[ROUTE] ${cursorModel} requested in Google-only mode, rerouting to ${DEFAULT_GEMINI_MODEL}`
      )
      return {
        backend: "google",
        model: DEFAULT_GEMINI_MODEL,
        isThinking: normalized.includes("thinking"),
      }
    }

    // 5. Unknown -> default
    this.logger.log(`[ROUTE] ${cursorModel} -> Google Cloud Code (default)`)
    return {
      backend: "google",
      model: DEFAULT_GEMINI_MODEL,
      isThinking: normalized.includes("thinking"),
    }
  }
}
