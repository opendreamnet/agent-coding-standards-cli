import { Command } from 'commander'
import {
  runStandardsCommand,
  type StandardsCommandOptions,
} from './standards/commands.ts'

const program = new Command()
  .name('acs')
  .description('Generate shared coding standards from pinned Git profiles')
  .addHelpText(
    'after',
    `
Rules contract: stable vX.Y.Z tags containing profiles/<name>.md.
CODING.md front matter: repository, version, revision and profiles at the YAML root.
Requires Git on PATH. Private repositories use Git credential helpers (HTTPS)
or the SSH agent (--transport ssh). Tokens are never embedded in remote URLs.
Project-specific instructions remain in AGENTS.md, which this CLI never modifies.
`,
  )

for (const name of ['init', 'sync', 'update', 'check'] as const) {
  const command = program
    .command(name)
    .description(
      {
        init: 'Create CODING.md with explicitly selected profiles',
        sync: 'Regenerate CODING.md using exactly the pinned rules version',
        update: 'Adopt the latest stable rules version, preserving profiles',
        check: 'Verify CODING.md without changing any files',
      }[name],
    )
    .option('-C, --directory <path>', 'Consumer repository directory', '.')
    .option('--transport <https|ssh>', 'Git authentication transport', 'https')

  if (name === 'init') {
    command
      .option(
        '--repository <owner/repo>',
        'GitHub rules repository',
        'https://github.com/opendreamnet/agent-coding-standards',
      )
      .requiredOption(
        '--profiles <names...>',
        'Ordered profile names (e.g. --profiles typescript vue); no profiles are added implicitly',
      )
      .option(
        '--version <X.Y.Z>',
        'Rules version to pin; defaults to the latest stable tag',
      )
  }

  if (name !== 'check') {
    command
      .option('--dry-run', 'Show the proposed changes without writing files')
      .option(
        '--yes',
        'Authorize replacement of existing generated content without prompting',
      )
  }

  command.action(async (options: StandardsCommandOptions) => {
    await runStandardsCommand(name, options)
  })
}

try {
  await program.parseAsync()
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : 'Unable to generate coding standards.',
  )

  process.exit(1)
}
