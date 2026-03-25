#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")

function collectTargets(root) {
  const targets = [path.join(root, ".turbo")]
  const queue = [root]
  const ignored = new Set(["node_modules", ".git"])

  while (queue.length > 0) {
    const current = queue.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      if (ignored.has(entry.name)) {
        continue
      }

      const fullPath = path.join(current, entry.name)
      if (entry.name === "dist" || entry.name === ".turbo") {
        targets.push(fullPath)
        continue
      }

      queue.push(fullPath)
    }
  }

  return Array.from(new Set(targets))
}

const targets = collectTargets(ROOT)

for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true })
  console.log(`removed ${path.relative(ROOT, target)}`)
}
