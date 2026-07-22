import { access, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkoutRepository, type CheckoutOptions } from './github'

const sha = '0123456789abcdef0123456789abcdef01234567'

function harness(overrides: Partial<CheckoutOptions> = {}) {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
  const commandRunner = vi.fn(async (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    calls.push({ args, env: options.env })
    if (args[0] === 'rev-parse') return { stdout: `${sha}\n`, stderr: '' }
    if (args[0] === 'ls-files') return { stdout: '100644 abc 0\tREADME.md\n', stderr: '' }
    return { stdout: '', stderr: '' }
  })
  return {
    calls,
    options: {
      owner: 'fuze',
      name: 'sample',
      commitSha: sha,
      installationId: '1234',
      tokenProvider: vi.fn(async () => 'super-secret-token'),
      commandRunner,
      ...overrides,
    } satisfies CheckoutOptions,
  }
}

describe('secure GitHub checkout', () => {
  it('fetches only the requested SHA without persisting the credential', async () => {
    const { calls, options } = harness()
    const directory = await checkoutRepository(options)

    expect(calls.map(call => call.args)).toEqual([
      ['init', '--quiet'],
      ['remote', 'add', 'origin', 'https://github.com/fuze/sample.git'],
      ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', sha],
      ['checkout', '--quiet', '--detach', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
      ['ls-files', '--stage'],
    ])
    expect(JSON.stringify(calls.map(call => call.args))).not.toContain('super-secret-token')
    expect(calls[2].env.GIT_CONFIG_VALUE_0).toContain('Authorization: Basic ')
    expect(calls[1].env.GIT_CONFIG_VALUE_0).toBeUndefined()
    await access(directory)
  })

  it('rejects mutable revisions before requesting a token', async () => {
    const { options } = harness({ commitSha: 'main' })
    await expect(checkoutRepository(options)).rejects.toThrow('exact 40-character commit SHA')
    expect(options.tokenProvider).not.toHaveBeenCalled()
  })

  it('cleans the ephemeral checkout when git fails and redacts diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fq19-test-'))
    const { options } = harness({
      checkoutRoot: root,
      commandRunner: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === 'fetch') throw new Error('authorization=super-secret-token')
        return { stdout: '', stderr: '' }
      }),
    })

    await expect(checkoutRepository(options)).rejects.toThrow('authorization=[REDACTED]')
    expect(await readdir(root)).toEqual([])
  })

  it('rejects symlink entries and cleans the checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fq19-symlink-'))
    const { options } = harness({ checkoutRoot: root })
    options.commandRunner = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: `${sha}\n`, stderr: '' }
      if (args[0] === 'ls-files') return { stdout: '120000 abc 0\tescape\n', stderr: '' }
      return { stdout: '', stderr: '' }
    })

    await expect(checkoutRepository(options)).rejects.toThrow('symbolic links')
    expect(await readdir(root)).toEqual([])
  })

  it('reports bounded success metrics without credentials', async () => {
    const onMetrics = vi.fn()
    const { options } = harness({ onMetrics })
    await checkoutRepository(options)
    expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success', repository: 'fuze/sample' }))
    expect(JSON.stringify(onMetrics.mock.calls)).not.toContain('super-secret-token')
  })
})
