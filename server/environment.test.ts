import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLocalEnvironment } from './environment.js'

const TEST_VARIABLE = 'COTHINKER_ENVIRONMENT_TEST'
const originalValue = process.env[TEST_VARIABLE]
const temporaryDirectories: string[] = []

afterEach(async () => {
  if (originalValue === undefined) delete process.env[TEST_VARIABLE]
  else process.env[TEST_VARIABLE] = originalValue

  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function temporaryEnvPath(contents?: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'cothinker-env-'))
  temporaryDirectories.push(directory)
  const envPath = path.join(directory, '.env')
  if (contents !== undefined) await writeFile(envPath, contents, 'utf8')
  return envPath
}

describe('local environment loading', () => {
  it('continues when the optional file is absent', async () => {
    const envPath = await temporaryEnvPath()

    expect(loadLocalEnvironment(envPath)).toBe(false)
  })

  it('loads values from an available file', async () => {
    delete process.env[TEST_VARIABLE]
    const envPath = await temporaryEnvPath(`${TEST_VARIABLE}=from-file\n`)

    expect(loadLocalEnvironment(envPath)).toBe(true)
    expect(process.env[TEST_VARIABLE]).toBe('from-file')
  })

  it('preserves values already injected into the process', async () => {
    process.env[TEST_VARIABLE] = 'from-process'
    const envPath = await temporaryEnvPath(`${TEST_VARIABLE}=from-file\n`)

    expect(loadLocalEnvironment(envPath)).toBe(true)
    expect(process.env[TEST_VARIABLE]).toBe('from-process')
  })
})
