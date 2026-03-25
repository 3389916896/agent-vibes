#!/usr/bin/env node

/**
 * Sync Codex CLI credentials into agent-vibes.
 *
 * Reads ~/.codex/auth.json (created by `codex --login`) and writes
 * CODEX_ACCESS_TOKEN, CODEX_REFRESH_TOKEN, and CODEX_ACCOUNT_ID
 * into apps/protocol-bridge/.env.local.
 *
 * Usage:
 *   agent-vibes sync --codex
 *   npm run codex:sync
 */

const fs = require("fs")
const path = require("path")
const os = require("os")

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, "../..")
const ENV_FILE = path.join(PROJECT_ROOT, "apps/protocol-bridge/.env.local")

/** Codex CLI credential file — respects CODEX_HOME env var */
function codexAuthPath() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")
  return path.join(codexHome, "auth.json")
}

// ---------------------------------------------------------------------------
// Read Codex auth.json
// ---------------------------------------------------------------------------

function readCodexAuth() {
  const authFile = codexAuthPath()

  if (!fs.existsSync(authFile)) {
    console.error("❌ Codex CLI not logged in (auth.json not found)")
    console.error(`   Expected at: ${authFile}`)
    console.error("")
    console.error("   Run \`codex --login\` first to authenticate with OpenAI.")
    process.exit(1)
  }

  const raw = fs.readFileSync(authFile, "utf-8")
  let auth

  try {
    auth = JSON.parse(raw)
  } catch (e) {
    console.error(`❌ Failed to parse ${authFile}: ${e.message}`)
    process.exit(1)
  }

  // API key mode
  if (auth.OPENAI_API_KEY) {
    return {
      mode: "api_key",
      apiKey: auth.OPENAI_API_KEY,
    }
  }

  // OAuth mode (from `codex --login` with ChatGPT account)
  const tokens = auth.tokens
  if (!tokens || !tokens.access_token) {
    console.error("❌ No credentials found in auth.json")
    console.error("   Neither OPENAI_API_KEY nor OAuth tokens are present.")
    console.error("")
    console.error("   Run \`codex --login\` to authenticate.")
    process.exit(1)
  }

  // Extract email from id_token JWT (best-effort)
  let email = ""
  let planType = ""
  if (tokens.id_token) {
    try {
      const parts = tokens.id_token.split(".")
      if (parts.length === 3) {
        const claims = JSON.parse(
          Buffer.from(parts[1], "base64url").toString("utf-8")
        )
        email = claims.email || ""
        planType =
          claims["https://api.openai.com/auth"]?.chatgpt_plan_type || ""
      }
    } catch {
      // ignore parse errors
    }
  }

  return {
    mode: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || "",
    accountId: tokens.account_id || "",
    email,
    planType,
  }
}

// ---------------------------------------------------------------------------
// Write to .env.local
// ---------------------------------------------------------------------------

/**
 * Upsert key=value pairs into .env.local.
 * Preserves existing entries that are not being updated.
 */
function upsertEnvFile(envPath, updates) {
  let lines = []

  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, "utf-8").split("\n")
  }

  const updatedKeys = new Set()

  // Update existing lines
  lines = lines
    .map((line) => {
      const trimmed = line.trim()
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) return line

      const eqIdx = trimmed.indexOf("=")
      if (eqIdx === -1) return line

      const key = trimmed.substring(0, eqIdx).trim()
      if (key in updates) {
        updatedKeys.add(key)
        if (updates[key] === null) return null // mark for removal
        return `${key}=${updates[key]}`
      }
      return line
    })
    .filter((line) => line !== null)

  // Append new keys that weren't already in the file
  const newKeys = Object.entries(updates).filter(
    ([k, v]) => !updatedKeys.has(k) && v !== null
  )

  if (newKeys.length > 0) {
    // Add a blank line separator if file doesn't end with one
    const lastLine = lines[lines.length - 1]
    if (lastLine && lastLine.trim() !== "") {
      lines.push("")
    }

    // Add section header if no Codex vars exist yet
    const hasCodexSection = lines.some(
      (l) => l.includes("Codex") || l.includes("CODEX_")
    )
    if (!hasCodexSection) {
      lines.push(
        "# ── Codex Backend (synced via \`agent-vibes sync --codex\`) ─"
      )
    }

    for (const [key, value] of newKeys) {
      lines.push(`${key}=${value}`)
    }
  }

  // Ensure trailing newline
  const content = lines.join("\n").replace(/\n*$/, "\n")
  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  fs.writeFileSync(envPath, content, "utf-8")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("🔄 Syncing Codex CLI credentials...\n")

const auth = readCodexAuth()

if (auth.mode === "api_key") {
  console.log("✅ Found API key in Codex CLI config")
  console.log(`   API Key: ${auth.apiKey.substring(0, 10)}...`)

  upsertEnvFile(ENV_FILE, {
    CODEX_API_KEY: auth.apiKey,
    // Clear OAuth vars if switching to API key mode
    CODEX_ACCESS_TOKEN: null,
    CODEX_REFRESH_TOKEN: null,
    CODEX_ACCOUNT_ID: null,
    CODEX_PLAN_TYPE: null,
  })
} else {
  // OAuth mode
  const label = auth.email ? `${auth.email}` : "OAuth account"
  console.log(`✅ ${label}`)
  console.log(`   Access Token: ${auth.accessToken.substring(0, 30)}...`)
  if (auth.refreshToken) {
    console.log(`   Refresh Token: ${auth.refreshToken.substring(0, 15)}...`)
  }
  if (auth.accountId) {
    console.log(`   Account ID: ${auth.accountId}`)
  }
  if (auth.planType) {
    console.log(`   Plan Type: ${auth.planType}`)
  }

  upsertEnvFile(ENV_FILE, {
    CODEX_ACCESS_TOKEN: auth.accessToken,
    CODEX_REFRESH_TOKEN: auth.refreshToken || null,
    CODEX_ACCOUNT_ID: auth.accountId || null,
    CODEX_PLAN_TYPE: auth.planType || null,
    // Clear API key if switching to OAuth mode
    CODEX_API_KEY: null,
  })
}

console.log(
  `\n✅ Credentials written to ${path.relative(PROJECT_ROOT, ENV_FILE)}`
)
console.log("   Restart the proxy to apply changes.")
