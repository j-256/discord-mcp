import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer, type IncomingHttpHeaders } from "node:http"
import { once } from "node:events"
import test from "node:test"

interface CapturedRequest {
  body: Buffer
  headers: IncomingHttpHeaders
  url: string
}

interface ProtobufField {
  bytes?: Uint8Array
  number: number
  wireType: number
}

interface TraceSpan {
  name: string
  parentSpanId: string
  spanId: string
  traceId: string
}

function readVarint(buffer: Uint8Array, start: number): [bigint, number] {
  let offset = start
  let shift = 0n
  let value = 0n
  while (offset < buffer.length && shift <= 63n) {
    const byte = buffer[offset]
    if (byte === undefined) break
    offset += 1
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return [value, offset]
    shift += 7n
  }
  throw new Error("Invalid protobuf varint")
}

function protobufFields(buffer: Uint8Array): ProtobufField[] {
  const fields: ProtobufField[] = []
  let offset = 0
  while (offset < buffer.length) {
    const [tag, afterTag] = readVarint(buffer, offset)
    offset = afterTag
    const number = Number(tag >> 3n)
    const wireType = Number(tag & 0x7n)
    if (number < 1) throw new Error("Invalid protobuf field number")
    if (wireType === 0) {
      const [, afterValue] = readVarint(buffer, offset)
      offset = afterValue
      fields.push({ number, wireType })
      continue
    }
    if (wireType === 1) {
      offset += 8
      fields.push({ number, wireType })
      continue
    }
    if (wireType === 2) {
      const [length, afterLength] = readVarint(buffer, offset)
      const end = afterLength + Number(length)
      if (end > buffer.length) throw new Error("Invalid protobuf field length")
      fields.push({ bytes: buffer.subarray(afterLength, end), number, wireType })
      offset = end
      continue
    }
    if (wireType === 5) {
      offset += 4
      fields.push({ number, wireType })
      continue
    }
    throw new Error(`Unsupported protobuf wire type ${wireType}`)
  }
  return fields
}

function bytesField(fields: ProtobufField[], number: number): Uint8Array[] {
  return fields
    .filter((field) => field.number === number && field.bytes)
    .map((field) => field.bytes as Uint8Array)
}

function hex(value: Uint8Array | undefined): string {
  return value ? Buffer.from(value).toString("hex") : ""
}

function traceSpans(request: Uint8Array): TraceSpan[] {
  const spans: TraceSpan[] = []
  for (const resourceSpans of bytesField(protobufFields(request), 1)) {
    for (const scopeSpans of bytesField(protobufFields(resourceSpans), 2)) {
      for (const encodedSpan of bytesField(protobufFields(scopeSpans), 2)) {
        const fields = protobufFields(encodedSpan)
        spans.push({
          name: Buffer.from(bytesField(fields, 5)[0] || []).toString("utf8"),
          parentSpanId: hex(bytesField(fields, 4)[0]),
          spanId: hex(bytesField(fields, 2)[0]),
          traceId: hex(bytesField(fields, 1)[0]),
        })
      }
    }
  }
  return spans
}

test("OTLP runtime keeps privacy-safe protobuf export and parent context isolated from preloaded globals", async (context) => {
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      requests.push({
        body: Buffer.concat(chunks),
        headers: request.headers,
        url: request.url || "",
      })
      response.writeHead(200, { "content-type": "application/x-protobuf" })
      response.end()
    })()
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  context.after(async () => {
    server.close()
    await once(server, "close")
  })
  const address = server.address()
  assert.ok(address && typeof address === "object")

  const privateValue = "999999999999999999/private-route/private message body"
  const privateToken = "private-discord-token-value"
  const collectorHeader = "collector-header-secret"
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    "test/fixtures/otel-export.ts",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TEST_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      TEST_OTLP_HEADERS: `x-test-key=${collectorHeader}`,
      TEST_OTLP_SERVICE_NAME: "discord-mcp.integration-test",
      TEST_PRIVATE_TOKEN: privateToken,
      TEST_PRIVATE_VALUE: privateValue,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk)
  })
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk)
  })
  const [exitCode] = await once(child, "close")

  assert.equal(exitCode, 0, stderr)
  assert.equal(stderr, "")
  const snapshot = JSON.parse(stdout) as {
    exporter: { attempts: number; failures: number; state: string; successes: number }
  }
  assert.equal(snapshot.exporter.state, "stopped")
  assert.equal(snapshot.exporter.failures, 0)
  assert.equal(snapshot.exporter.attempts, snapshot.exporter.successes)

  const traces = requests.filter(({ url }) => url === "/v1/traces")
  const metrics = requests.filter(({ url }) => url === "/v1/metrics")
  assert.equal(traces.length > 0, true)
  assert.equal(metrics.length > 0, true)
  for (const request of requests) {
    assert.equal(request.headers["content-type"], "application/x-protobuf")
    assert.equal(request.headers["x-test-key"], collectorHeader)
    assert.equal(request.headers["content-encoding"], undefined)
    const wireText = request.body.toString("utf8")
    assert.equal(wireText.includes(privateValue), false)
    assert.equal(wireText.includes(privateToken), false)
    assert.equal(wireText.includes(collectorHeader), false)
    assert.equal(wireText.includes("private-route"), false)
    assert.equal(wireText.includes("private message body"), false)
  }

  const spans = traces.flatMap(({ body }) => traceSpans(body))
  const tool = spans.find(({ name }) => name === "mcp.tool.get_message")
  const rest = spans.find(({ name }) => name === "discord.rest.get_message")
  const unknown = spans.find(({ name }) => name === "mcp.tool.unknown")
  assert.ok(tool)
  assert.ok(rest)
  assert.ok(unknown)
  assert.equal(tool.parentSpanId, "")
  assert.equal(rest.traceId, tool.traceId)
  assert.equal(rest.parentSpanId, tool.spanId)
  assert.equal(rest.spanId.length, 16)
  assert.equal(tool.traceId.length, 32)

  const metricWire = Buffer.concat(metrics.map(({ body }) => body)).toString("utf8")
  assert.match(metricWire, /mcp\.tool\.calls/)
  assert.match(metricWire, /discord\.rest\.calls/)
  assert.match(metricWire, /discord-mcp\.integration-test/)
})
