import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  })
}

test("Discord client uses exact bounded guild-ban read routes", async () => {
  const requests: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requests.push(String(input))
      return String(input).includes("/bans/400")
        ? jsonResponse({ reason: null, user: { id: "400", username: "target" } })
        : jsonResponse([])
    },
    token: TOKEN,
  })

  await client.listGuildBans("100", { after: "300", limit: 26 })
  await client.getGuildBan("100", "400")

  assert.deepEqual(requests, [
    `${API_BASE_URL}/guilds/100/bans?after=300&limit=26`,
    `${API_BASE_URL}/guilds/100/bans/400`,
  ])
})

test("Discord client rejects malformed guild-ban reads before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([])
    },
    token: TOKEN,
  })

  assert.throws(() => client.listGuildBans("bad"), /guild ID/)
  assert.throws(
    () => client.listGuildBans("100", { after: "bad" }),
    /after cursor/,
  )
  assert.throws(
    () => client.listGuildBans("100", { limit: 102 }),
    /list limit/,
  )
  assert.throws(() => client.getGuildBan("bad", "400"), /guild ID/)
  assert.throws(() => client.getGuildBan("100", "bad"), /user ID/)
  assert.equal(requests, 0)
})
