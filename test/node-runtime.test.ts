import assert from "node:assert/strict"
import test from "node:test"

import {
  LOW_MEMORY_NODE_ARGUMENTS,
  NODE_22_23_LOW_MEMORY_NODE_ARGUMENTS,
  lowMemoryNodeArguments,
  resolveNodeRuntime,
  STANDARD_RUNTIME_ARGUMENT,
} from "../src/node-runtime.js"

const EXECUTABLE = "/runtime/node"
const LAUNCHER = "/package/dist/bin.js"
const CLI = "/package/dist/cli.js"

test("Node runtime replacement preserves arguments and adds one exact low-memory profile", () => {
  const resolution = resolveNodeRuntime({
    argv: [EXECUTABLE, LAUNCHER, "serve", "--config", "/private/policy.json"],
    cliEntrypoint: CLI,
    execArgv: ["--enable-source-maps"],
    execPath: EXECUTABLE,
    nodeVersion: "22.22.0",
    processReplacementAvailable: true,
  })
  assert.equal(resolution.profile, "low-memory")
  assert.deepEqual(resolution.cliArguments, ["serve", "--config", "/private/policy.json"])
  assert.deepEqual(resolution.replacement, {
    args: [
      EXECUTABLE,
      "--enable-source-maps",
      ...NODE_22_23_LOW_MEMORY_NODE_ARGUMENTS,
      CLI,
      "serve",
      "--config",
      "/private/policy.json",
    ],
    file: EXECUTABLE,
  })
})

test("Node runtime avoids duplicate active low-memory flags", () => {
  const resolution = resolveNodeRuntime({
    argv: [EXECUTABLE, LAUNCHER, "version"],
    cliEntrypoint: CLI,
    execArgv: ["--no-expose_wasm", "--lite_mode"],
    execPath: EXECUTABLE,
    nodeVersion: "22.22.0",
    processReplacementAvailable: true,
  })
  assert.equal(resolution.profile, "low-memory")
  assert.equal(resolution.replacement, undefined)
  assert.deepEqual(resolution.cliArguments, ["version"])
})

test("Node runtime recognizes the universal low-memory profile", () => {
  const resolution = resolveNodeRuntime({
    argv: [EXECUTABLE, LAUNCHER, "version"],
    cliEntrypoint: CLI,
    execArgv: ["--lite-mode"],
    execPath: EXECUTABLE,
    nodeVersion: "26.7.0",
    processReplacementAvailable: true,
  })
  assert.equal(resolution.profile, "low-memory")
  assert.equal(resolution.replacement, undefined)
  assert.deepEqual(resolution.cliArguments, ["version"])
})

test("Node runtime respects explicit standard-runtime choices", () => {
  for (const execArgv of [
    ["--no-lite-mode"],
    ["--expose-wasm"],
    ["--lite-mode=false"],
  ]) {
    const resolution = resolveNodeRuntime({
      argv: [EXECUTABLE, LAUNCHER, "serve"],
      cliEntrypoint: CLI,
      execArgv,
      execPath: EXECUTABLE,
      nodeVersion: "26.7.0",
      processReplacementAvailable: true,
    })
    assert.equal(resolution.profile, "standard")
    assert.equal(resolution.replacement, undefined)
  }

  const explicit = resolveNodeRuntime({
    argv: [EXECUTABLE, LAUNCHER, STANDARD_RUNTIME_ARGUMENT, "serve"],
    cliEntrypoint: CLI,
    execArgv: [],
    execPath: EXECUTABLE,
    nodeVersion: "26.7.0",
    processReplacementAvailable: true,
  })
  assert.equal(explicit.profile, "standard")
  assert.deepEqual(explicit.cliArguments, ["serve"])
  assert.equal(explicit.replacement, undefined)
})

test("Node runtime treats the standard profile switch only as a launcher prefix", () => {
  const resolution = resolveNodeRuntime({
    argv: [
      EXECUTABLE,
      LAUNCHER,
      "serve",
      "--config",
      STANDARD_RUNTIME_ARGUMENT,
    ],
    cliEntrypoint: CLI,
    execArgv: [],
    execPath: EXECUTABLE,
    nodeVersion: "26.7.0",
    processReplacementAvailable: false,
  })
  assert.deepEqual(resolution.cliArguments, [
    "serve",
    "--config",
    STANDARD_RUNTIME_ARGUMENT,
  ])
})

test("Node runtime falls back without process replacement", () => {
  const resolution = resolveNodeRuntime({
    argv: [EXECUTABLE, LAUNCHER, "help"],
    cliEntrypoint: CLI,
    execArgv: [],
    execPath: EXECUTABLE,
    nodeVersion: "26.7.0",
    processReplacementAvailable: false,
  })
  assert.equal(resolution.profile, "standard")
  assert.deepEqual(resolution.cliArguments, ["help"])
  assert.equal(resolution.replacement, undefined)
})

test("Node runtime falls back to the standard profile on an unverified future line", () => {
  const resolution = resolveNodeRuntime({
    argv: [EXECUTABLE, LAUNCHER, "serve"],
    cliEntrypoint: CLI,
    execArgv: [],
    execPath: EXECUTABLE,
    nodeVersion: "27.0.0",
    processReplacementAvailable: true,
  })
  assert.equal(resolution.profile, "standard")
  assert.deepEqual(resolution.cliArguments, ["serve"])
  assert.equal(resolution.replacement, undefined)
})

test("Node runtime selects only flags supported by each Node line", () => {
  assert.deepEqual(lowMemoryNodeArguments("22.15.0"), [
    "--no-expose-wasm",
    "--lite-mode",
  ])
  assert.deepEqual(lowMemoryNodeArguments("23.11.1"), [
    "--no-expose-wasm",
    "--lite-mode",
  ])
  assert.deepEqual(lowMemoryNodeArguments("24.8.0"), LOW_MEMORY_NODE_ARGUMENTS)
  assert.deepEqual(lowMemoryNodeArguments("25.9.0"), LOW_MEMORY_NODE_ARGUMENTS)
  assert.deepEqual(lowMemoryNodeArguments("26.7.0"), LOW_MEMORY_NODE_ARGUMENTS)
  assert.deepEqual(lowMemoryNodeArguments("27.0.0"), [])
  assert.deepEqual(lowMemoryNodeArguments("invalid"), [])
})
