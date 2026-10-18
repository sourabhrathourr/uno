import { createServer } from "node:http"
import { connect } from "node:net"
import type { Socket } from "node:net"
import { once } from "node:events"
import { expect, it } from "vitest"
import { proxyForServer } from "./proxy"
import { UnoClient } from "./client"
import { fixture } from "./test-fixture"

it("selects protocol-specific/lowercase proxies and honors NO_PROXY hosts, suffixes, ports and IPv6", () => {
  const proxy = "http://proxy.invalid:8080/"
  expect(proxyForServer("https://game.invalid", { HTTPS_PROXY: proxy })).toBe(
    proxy
  )
  expect(
    proxyForServer("https://game.invalid", {
      https_proxy: proxy,
      HTTPS_PROXY: "http://other.invalid",
    })
  ).toBe(proxy)
  expect(proxyForServer("http://game.invalid", { HTTP_PROXY: proxy })).toBe(
    proxy
  )
  expect(
    proxyForServer("http://game.invalid", { HTTPS_PROXY: proxy })
  ).toBeUndefined()
  expect(proxyForServer("https://game.invalid", { ALL_PROXY: proxy })).toBe(
    proxy
  )
  for (const NO_PROXY of [
    "*",
    "game.invalid",
    "game.invalid:443",
    ".invalid",
    "*.invalid",
    "else.invalid, game.invalid",
  ]) {
    expect(
      proxyForServer("https://game.invalid", { HTTPS_PROXY: proxy, NO_PROXY })
    ).toBeUndefined()
  }
  expect(
    proxyForServer("https://game.invalid", {
      HTTPS_PROXY: proxy,
      NO_PROXY: "game.invalid:80",
    })
  ).toBe(proxy)
  expect(
    proxyForServer("https://notgame.invalid", {
      HTTPS_PROXY: proxy,
      NO_PROXY: "game.invalid",
    })
  ).toBe(proxy)
  expect(
    proxyForServer("http://[::1]:4001", {
      HTTP_PROXY: proxy,
      NO_PROXY: "[::1]:4001",
    })
  ).toBeUndefined()
  expect(proxyForServer("https://game.invalid", {})).toBeUndefined()
})

it("rejects invalid proxy configuration without exposing credentials or values", () => {
  for (const HTTPS_PROXY of [
    "socks://secret:password@proxy.invalid",
    "http://secret:password@proxy.invalid/path",
    "secret-value",
  ]) {
    try {
      proxyForServer("https://game.invalid", { HTTPS_PROXY })
      throw new Error("expected rejection")
    } catch (cause) {
      expect(cause).toMatchObject({ code: "invalid-proxy" })
      expect(String(cause)).not.toMatch(/secret|password|proxy.invalid/)
    }
  }
})

it("creates, joins, mutates and resyncs through a configured HTTP CONNECT proxy, then closes its tunnels", async () => {
  const f = await fixture()
  const proxy = createServer()
  const sockets = new Set<Socket>()
  let tunnels = 0
  proxy.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  proxy.on("connect", (req, downstream, head) => {
    const target = new URL(f.url)
    expect(req.url).toBe(target.host)
    const upstream = connect(Number(target.port), target.hostname, () => {
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length) upstream.write(head)
      downstream.pipe(upstream).pipe(downstream)
      tunnels++
    })
    downstream.on("error", () => upstream.destroy())
    downstream.on("close", () => upstream.destroy())
    upstream.on("error", () => downstream.destroy())
  })
  proxy.listen(0, "127.0.0.1")
  await once(proxy, "listening")
  const proxyUrl = `http://dummy-user:dummy-password@127.0.0.1:${(proxy.address() as { port: number }).port}`
  const client = new UnoClient({
    serverUrl: f.url,
    proxyEnv: { HTTP_PROXY: proxyUrl },
  })
  const notices: unknown[] = []
  client.on("notice", (notice) => notices.push(notice))
  try {
    await client.execute({ action: "create", name: "Proxy player" })
    expect(client.status().joined).toBe(true)
    const id = client.status().playerId
    await client.execute({ action: "ready", ready: true })
    await client.execute({ action: "resync" })
    expect(client.status().playerId).toBe(id)
    expect(tunnels).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(notices)).not.toMatch(
      /dummy-password|dummy-user|sessionId/
    )
    client.close()
    await expect.poll(() => sockets.size).toBe(0)
  } finally {
    client.close()
    sockets.forEach((socket) => socket.destroy())
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
    await f.close()
  }
})
