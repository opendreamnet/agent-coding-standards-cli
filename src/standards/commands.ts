import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { createInterface } from 'node:readline'
import { createTwoFilesPatch } from 'diff'
import {
  compareVersions,
  createCodingDocument,
  normalizeRepository,
  parseCodingDocument,
  renderCodingBody,
  updateCodingVersion,
  validateProfiles,
  validateVersion,
} from './document.ts'
import { GitRules } from './git.ts'

/**
 * Configures the consumer directory, explicit initialization inputs and consent
 * for writing generated content; version and profiles describe rules, not the CLI.
 */
export interface StandardsCommandOptions {
  directory: string
  repository?: string
  profiles?: string[]
  version?: string
  yes?: boolean
  dryRun?: boolean
  transport?: string
}

/**
 * Distinguishes creation, regeneration of a pin, adoption of newer rules and
 * read-only verification.
 */
export type StandardsCommand = 'init' | 'sync' | 'update' | 'check'

/**
 * Reads an existing regular document, returning undefined only for absence and
 * rejecting symbolic links, including dangling links, before any replacement.
 */
function getExistingContent(path: string): string | undefined {
  /*
   * Directory entries catch dangling symlinks, which existsSync follows.
   */
  if (
    !existsSync(path) &&
    !readdirSync(dirname(path)).includes(basename(path))
  ) {
    return undefined
  }

  const stat = lstatSync(path)

  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('CODING.md must be a regular file, not a symbolic link.')
  }

  return readFileSync(path, 'utf8')
}

/**
 * Requires an interactive terminal and accepts only an explicit yes; EOF,
 * blank input and other answers deny replacement.
 */
async function confirmReplacement(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Confirmation requires an interactive terminal. Review --dry-run, then use --yes to authorize replacement.',
    )
  }

  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  /*
   * readline's callback API needs an explicit lifecycle to handle EOF as denial.
   */
  // oxlint-disable-next-line promise/avoid-new
  return new Promise((resolve) => {
    let answered = false

    terminal.on('close', () => {
      if (!answered) {
        resolve(false)
      }
    })

    terminal.question(
      'Replace CODING.md with these changes? [y/N] ',
      (answer) => {
        answered = true
        terminal.close()
        resolve(/^y(?:es)?$/i.test(answer.trim()))
      },
    )
  })
}

/**
 * Installs staged content without replacing a concurrently changed document,
 * preserving existing permissions and cleaning staging files after success or
 * failure. Initial creation is exclusive; replacement uses an atomic rename.
 */
function setDocument(
  path: string,
  previous: string | undefined,
  next: string,
): void {
  const temporaryDirectory = mkdtempSync(`${path}.`)
  const temporary = join(temporaryDirectory, 'CODING.md')

  try {
    if (previous !== undefined) {
      /*
       * Copy first so replacing the body retains the existing file permissions.
       */
      copyFileSync(path, temporary)
    }

    writeFileSync(temporary, next, 'utf8')

    if (getExistingContent(path) !== previous) {
      throw new Error(
        'CODING.md changed during this operation. No changes were written; retry after reviewing the file.',
      )
    }

    if (previous === undefined) {
      /*
       * Exclusive creation prevents init from replacing a concurrently created file.
       */
      linkSync(temporary, path)
    } else {
      renameSync(temporary, path)
    }
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary)
    }

    rmdirSync(temporaryDirectory)
  }
}

/**
 * Generates only CODING.md. Replacements are previewed and require explicit
 * approval; GitHub credentials and unrelated YAML metadata are never printed.
 */
export async function runStandardsCommand(
  command: StandardsCommand,
  options: StandardsCommandOptions,
): Promise<void> {
  const path = resolvePath(options.directory, 'CODING.md')
  const previous = getExistingContent(path)

  if (command === 'init' && previous !== undefined) {
    throw new Error(
      'CODING.md already exists. init never replaces an existing file; use sync or update for a configured document.',
    )
  }

  if (command !== 'init' && previous === undefined) {
    throw new Error('CODING.md does not exist. Run init first.')
  }

  const document =
    previous === undefined ? undefined : parseCodingDocument(previous)

  const repository =
    document?.config.repository ??
    normalizeRepository(
      options.repository ??
        'https://github.com/opendreamnet/agent-coding-standards',
    )

  const profiles =
    document?.config.profiles ?? validateProfiles(options.profiles)

  if (options.version !== undefined) {
    validateVersion(options.version)
  }

  const source = new GitRules({
    repository,
    transport: options.transport,
  })

  try {
    const pinnedRelease = document
      ? await source.fetchVersion(document.config.version)
      : undefined

    if (document && pinnedRelease?.revision !== document.config.revision) {
      throw new Error(
        'The pinned rules tag has moved. Refusing to use different rules for the same version.',
      )
    }

    let release = pinnedRelease

    if (
      command === 'update' ||
      (command === 'init' && options.version === undefined)
    ) {
      release = await source.fetchLatestVersion()
    } else if (command === 'init' && options.version !== undefined) {
      release = await source.fetchVersion(options.version)
    }

    if (release === undefined) {
      throw new Error('Unable to resolve the rules version.')
    }

    if (
      document &&
      release.version === document.config.version &&
      release.revision !== document.config.revision
    ) {
      throw new Error(
        'The pinned rules tag has moved. Refusing to change its commit.',
      )
    }

    if (
      command === 'update' &&
      document &&
      compareVersions(release.version, document.config.version) < 0
    ) {
      throw new Error(
        'The latest available stable version is older than the pinned version. Refusing to downgrade.',
      )
    }

    const contents = await source.fetchProfiles(release, profiles)

    const body = renderCodingBody(contents)
    let next: string

    if (document) {
      const header =
        command === 'update'
          ? updateCodingVersion(document, release.version, release.revision)
          : document.header

      next = `${header}${header.endsWith('\n') ? '' : '\n'}${body}`
    } else {
      next = createCodingDocument(
        { repository, ...release, profiles },
        contents,
      )
    }

    console.log(
      `Rules: ${repository} v${release.version} (${release.revision})`,
    )

    console.log(`Profiles: ${profiles.join(', ')}`)

    if (previous === next) {
      console.log('CODING.md is up to date.')

      return
    }

    /*
     * Preview only owned fields and the generated body, not unrelated metadata.
     */
    if (document && document.config.version !== release.version) {
      console.log(`Version: ${document.config.version} -> ${release.version}`)
    }

    console.log(
      createTwoFilesPatch(
        'CODING.md',
        'CODING.md',
        document?.body ?? '',
        document ? body : next,
      ),
    )

    if (command === 'check') {
      throw new Error(
        'CODING.md differs from the rules declared in its front matter.',
      )
    }

    if (options.dryRun) {
      console.log('Dry run: no files were changed.')

      return
    }

    if (previous !== undefined) {
      console.log(
        'Replacing the generated body may discard local edits. Keep project-specific exceptions in AGENTS.md.',
      )

      if (!options.yes && !(await confirmReplacement())) {
        throw new Error('Replacement declined. No files were changed.')
      }
    }

    setDocument(path, previous, next)

    console.log(
      `CODING.md ${command === 'init' ? 'created' : 'updated'}. Review the diff before committing.`,
    )

    if (command === 'init') {
      console.log(
        'Add an instruction in AGENTS.md to consult CODING.md before changing code. AGENTS.md was not modified.',
      )
    }
  } finally {
    source.close()
  }
}
