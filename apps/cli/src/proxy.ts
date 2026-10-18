import { CliError } from "./commands"

/** Standard proxy variables only; values must never appear in protocol output. */
export function proxyForServer(
  server: string,
  env: NodeJS.ProcessEnv
): string | undefined {
  const url = new URL(server)
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  const port = url.port || (url.protocol === "https:" ? "443" : "80")
  const bypass = env.no_proxy ?? env.NO_PROXY ?? ""
  for (const entry of bypass.split(/[\s,]+/)) {
    if (!entry) continue
    if (entry === "*") return undefined
    const match = entry.toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/)
    if (!match || (match[2] && match[2] !== port)) continue
    const host = match[1]!.replace(/^\[|\]$/g, "")
    if (
      hostname === host ||
      ((host.startsWith(".") || host.startsWith("*.")) &&
        hostname.endsWith(host.replace(/^\*/, "")))
    )
      return undefined
  }
  const proxy =
    url.protocol === "https:"
      ? env.https_proxy || env.HTTPS_PROXY || env.all_proxy || env.ALL_PROXY
      : env.http_proxy || env.HTTP_PROXY || env.all_proxy || env.ALL_PROXY
  if (!proxy) return undefined
  try {
    const parsed = new URL(proxy)
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      throw new Error()
    return parsed.href
  } catch {
    throw new CliError(
      "invalid-proxy",
      "Proxy configuration must be an HTTP(S) origin. Check the proxy environment variables."
    )
  }
}
