#!/usr/bin/env node

import { loadConnectorConfig } from "./config.js"
import { ENVIRONMENT_NAMES } from "./constants.js"
import { errorMessage, redactText } from "./errors.js"
import { ConnectorService } from "./service.js"

async function main(): Promise<void> {
  const config = loadConnectorConfig()
  const service = new ConnectorService({ config })
  const status = await service.getStatus()
  process.stdout.write(`${JSON.stringify({
    applicationId: status.application.id,
    botId: status.bot.id,
    guildsAccessibleOnFirstPage: status.guildPage.accessible,
    guildsInScopeOnFirstPage: status.guildPage.inScope,
    policy: status.policy,
    status: status.status,
  }, null, 2)}\n`)
}

try {
  await main()
} catch (error) {
  const message = redactText(errorMessage(error), [
    process.env[ENVIRONMENT_NAMES.token],
  ])
  process.stderr.write(`Discord live probe failed: ${message}\n`)
  process.exitCode = 1
}
