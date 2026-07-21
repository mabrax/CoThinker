import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadEnvFile } from 'node:process'

export function loadLocalEnvironment(
  envPath = path.resolve(process.cwd(), '.env'),
): boolean {
  if (!existsSync(envPath)) return false

  loadEnvFile(envPath)
  return true
}
