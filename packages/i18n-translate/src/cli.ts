#!/usr/bin/env node
import { resolve } from 'node:path'
import { run } from './runner'
import { loadLanguagesConfig, resolveLlmEnv } from './config'
import { translateOne, type LlmConfig } from './llm'

interface CliArgs {
  localesDir: string
  languagesConfig: string
  dryRun: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    localesDir: resolve(process.cwd(), 'locales'),
    languagesConfig: resolve(process.cwd(), 'i18n.languages.json'),
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--locales-dir') args.localesDir = resolve(argv[++i])
    else if (a === '--languages') args.languagesConfig = resolve(argv[++i])
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--help' || a === '-h') {
      printHelp()
      process.exit(0)
    }
  }
  return args
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      'fuzefront-i18n-translate — build-time AI translation of locale files',
      '',
      'Usage: fuzefront-i18n-translate [options]',
      '',
      'Options:',
      '  --locales-dir <dir>   Locales root (default: ./locales)',
      '  --languages <file>    Language config (default: ./i18n.languages.json)',
      '  --dry-run             Compute the plan without writing or calling the LLM differently',
      '  -h, --help            Show this help',
      '',
      'Environment:',
      '  I18N_LLM_ENDPOINT / OPENAI_BASE_URL   OpenAI-compatible base URL (LiteLLM gateway)',
      '  I18N_LLM_API_KEY  / OPENAI_API_KEY    Gateway API key',
      '  I18N_LLM_MODEL    / OPENAI_MODEL      Model name (default gpt-4o-mini)',
    ].join('\n')
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const languages = loadLanguagesConfig(args.languagesConfig)
  const env = resolveLlmEnv()

  const llmConfig: LlmConfig = {
    endpoint: env.endpoint,
    apiKey: env.apiKey,
    model: env.model,
  }

  const result = await run({
    localesDir: args.localesDir,
    languages,
    write: !args.dryRun,
    log: (m) => console.log(m), // eslint-disable-line no-console
    translate: ({ source, targetCode, targetLanguageName }) =>
      translateOne(llmConfig, { source, targetCode, targetLanguageName }),
  })

  const totalTranslated = result.runs.reduce((n, r) => n + r.translated, 0)
  const totalPruned = result.runs.reduce((n, r) => n + r.pruned, 0)
  // eslint-disable-next-line no-console
  console.log(
    `\nDone. translated=${totalTranslated} pruned=${totalPruned} changed=${result.changed}`
  )
  // Exit 0 always; "changed" is surfaced via stdout for the CI PR step.
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
