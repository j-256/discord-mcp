import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export function isMainModule(metaUrl: string): boolean {
  const entrypoint = process.argv[1]
  return Boolean(entrypoint && pathToFileURL(resolve(entrypoint)).href === metaUrl)
}
