#!/usr/bin/env node

import { runCli } from "./cli.js"

process.exitCode = await runCli({
  args: ["doctor", "--online", "--json"],
})
