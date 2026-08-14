import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function isMainModule(
  metaUrl: string,
  entrypoint: string | undefined = process.argv[1],
): boolean {
  if (!entrypoint) return false
  return realpathSync(resolve(entrypoint)) === realpathSync(fileURLToPath(metaUrl))
}
