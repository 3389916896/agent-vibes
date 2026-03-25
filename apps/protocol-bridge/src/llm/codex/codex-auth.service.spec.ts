import { describe, expect, it } from "@jest/globals"
import { CodexAuthService } from "./codex-auth.service"

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.signature`
}

describe("CodexAuthService", () => {
  it("extracts plan type from nested OpenAI auth claims", () => {
    const service = new CodexAuthService()
    const idToken = createJwt({
      email: "team@example.com",
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "team",
      },
    })

    expect(service.getPlanTypeFromIdToken(idToken)).toBe("team")
  })

  it("extracts account id from nested OpenAI auth claims", () => {
    const service = new CodexAuthService()
    const idToken = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_nested",
      },
    })

    expect(service.getAccountIdFromIdToken(idToken)).toBe("acct_nested")
  })

  it("reports the current plan type from token state", () => {
    const service = new CodexAuthService()
    const idToken = createJwt({
      email: "plus@example.com",
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "plus",
      },
    })

    service.setTokenData({
      idToken,
      accessToken: "access",
      refreshToken: "refresh",
      accountId: "acct",
      email: "plus@example.com",
      expire: new Date(Date.now() + 60_000).toISOString(),
    })

    expect(service.getPlanType()).toBe("plus")
  })
})
