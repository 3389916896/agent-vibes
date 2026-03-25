import { describe, expect, it } from "@jest/globals"
import {
  getCodexCursorDisplayModels,
  getCodexPublicModelIds,
  getCursorDisplayModels,
  normalizeCodexModelTier,
} from "./model-registry"

describe("model-registry codex tiers", () => {
  it("normalizes common Codex tier aliases", () => {
    expect(normalizeCodexModelTier("team")).toBe("team")
    expect(normalizeCodexModelTier("business")).toBe("team")
    expect(normalizeCodexModelTier("chatgpt_plus")).toBe("plus")
    expect(normalizeCodexModelTier("enterprise")).toBe("pro")
    expect(normalizeCodexModelTier("")).toBeNull()
  })

  it("filters GPT-5 family by team tier while keeping shared models", () => {
    const modelNames = getCodexCursorDisplayModels({
      codexModelTier: "team",
      excludeMaxNamedModels: true,
    }).map((model) => model.name)

    expect(modelNames).toContain("gpt-5.3-codex")
    expect(modelNames).toContain("gpt-5.4")
    expect(modelNames).not.toContain("gpt-5.3-codex-spark")
    expect(modelNames).not.toContain("gpt-5.1-codex-max")
    expect(modelNames).toContain("o4-mini")
    expect(modelNames).toContain("codex-mini")
  })

  it("keeps the broader curated Codex set when tier is unknown", () => {
    const modelNames = getCodexCursorDisplayModels().map((model) => model.name)

    expect(modelNames).toContain("gpt-5.3-codex-spark")
    expect(modelNames).toContain("gpt-5.1-codex-max")
  })

  it("reuses the same filtered set for Cursor and /v1/models", () => {
    const cursorModels = getCursorDisplayModels({
      includeCodex: true,
      codexModelTier: "free",
      excludeMaxNamedModels: true,
    })
      .filter((model) => model.family === "gpt")
      .map((model) => model.name)

    const publicModels = getCodexPublicModelIds({
      codexModelTier: "free",
      excludeMaxNamedModels: true,
    })

    expect(cursorModels).toContain("gpt-5.2-codex")
    expect(cursorModels).not.toContain("gpt-5.3-codex")
    expect(publicModels).toContain("codex-mini-latest")
    expect(publicModels).not.toContain("gpt-5.1-codex-max")
  })
})
