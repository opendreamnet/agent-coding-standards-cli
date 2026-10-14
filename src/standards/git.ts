import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compareVersions,
  normalizeRepository,
  validateProfiles,
  validateVersion,
} from './document.ts'

/**
 * Identifies a stable rules version and its resolved commit, not a CLI version
 * or the SHA of an annotated tag object.
 */
export interface RulesRelease {
  version: string
  revision: string
}

interface GitRulesOptions {
  repository: string
  transport?: string
}

/**
 * Reads versioned profiles using native Git in a private temporary bare
 * repository. No consumer repository, remote configuration or checkout is used.
 */
export class GitRules {
  readonly #remote: string

  readonly #directory: string

  #initialized = false

  /**
   * Validates the source and transport before allocating isolated storage.
   * Authentication is delegated to Git credential helpers or the SSH agent.
   */
  constructor(options: GitRulesOptions) {
    const repository = normalizeRepository(options.repository)

    const transport = options.transport ?? 'https'

    if (transport !== 'https' && transport !== 'ssh') {
      throw new Error('Git transport must be https or ssh.')
    }

    this.#remote =
      transport === 'ssh'
        ? `git@github.com:${repository}.git`
        : `https://github.com/${repository}.git`

    this.#directory = mkdtempSync(join(tmpdir(), 'coding-standards-git-'))
  }

  /**
   * Fetches an exact tag and peels it to a commit. Each call consults the remote
   * again, so a previously fetched tag cannot conceal a moved release.
   */
  public async fetchVersion(version: string): Promise<RulesRelease> {
    validateVersion(version)

    await this.#initialize()

    await this.#run(
      [
        'fetch',
        '--depth=1',
        '--no-tags',
        '--no-recurse-submodules',
        '--',
        this.#remote,
        `refs/tags/v${version}`,
      ],
      'The requested rules tag does not exist or is not accessible.',
    )

    const resolved = await this.#run(
      ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
      'The rules tag does not reference a commit.',
    )

    const revision = resolved.trim()

    if (!/^[a-f0-9]{40}$/.test(revision)) {
      throw new Error('Git returned an invalid release commit.')
    }

    return { version, revision }
  }

  /**
   * Selects the highest stable vX.Y.Z tag advertised by the remote, ignoring
   * prereleases and peeled tag lines, then downloads the selected release.
   */
  public async fetchLatestVersion(): Promise<RulesRelease> {
    await this.#initialize()

    const listing = await this.#run(
      ['ls-remote', '--tags', '--', this.#remote],
      'Unable to access rules with Git. Check that Git is installed and authentication is configured.',
    )

    let latest: string | undefined

    for (const line of listing.split('\n')) {
      const match =
        /^[a-f0-9]{40}\trefs\/tags\/v(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(
          line.trimEnd(),
        )

      if (match === null || match.groups?.version === undefined) {
        continue
      }

      const version = validateVersion(match.groups.version)

      if (latest === undefined || compareVersions(version, latest) > 0) {
        latest = version
      }
    }

    if (latest === undefined) {
      throw new Error('No stable vX.Y.Z rules tags were found.')
    }

    return this.fetchVersion(latest)
  }

  /**
   * Reads only the selected regular Markdown blobs from the resolved commit,
   * preserving order and rejecting symlinks, missing files and oversized data.
   */
  public async fetchProfiles(
    release: RulesRelease,
    profiles: string[],
  ): Promise<string[]> {
    validateProfiles(profiles)

    if (!/^[a-f0-9]{40}$/.test(release.revision)) {
      throw new Error(
        'A valid rules commit is required before reading profiles.',
      )
    }

    const contents: string[] = []

    for (const profile of profiles) {
      const path = `profiles/${profile}.md`
      const message = `Profile ${profile} is missing or is not a regular Markdown file.`

      const entry = await this.#run(
        ['ls-tree', release.revision, '--', path],
        message,
      )

      if (
        !/^(?:100644|100755) blob [a-f0-9]{40}\t/.test(entry) ||
        entry.trimEnd().split('\t')[1] !== path
      ) {
        throw new Error(message)
      }

      const size = Number(
        await this.#run(
          ['cat-file', '-s', `${release.revision}:${path}`],
          message,
        ),
      )

      if (!Number.isSafeInteger(size) || size <= 0 || size > 1_000_000) {
        throw new Error(`Profile ${profile} is empty or too large.`)
      }

      const content = await this.#run(
        ['show', `${release.revision}:${path}`],
        message,
        1_050_000,
      )

      if (content.includes('\0') || !content.trim()) {
        throw new Error(`Profile ${profile} is empty or is not a text file.`)
      }

      contents.push(content)
    }

    return contents
  }

  /**
   * Removes every downloaded object after the owning command completes or fails.
   */
  public close(): void {
    rmSync(this.#directory, { recursive: true, force: true })
  }

  /**
   * Creates the bare repository without templates, hooks or a worktree, using
   * SHA-1 objects to match the fixed revision format in consumer documents.
   */
  async #initialize(): Promise<void> {
    if (this.#initialized) {
      return
    }

    await this.#run(
      ['init', '--bare', '--template=', this.#directory],
      'Unable to initialize temporary rules storage. Check that Git is installed.',
    )

    this.#initialized = true
  }

  /**
   * Executes Git synchronously without a shell, with bounded output and runtime.
   * The Promise interface preserves the command's asynchronous error contract.
   * This form supports environment and timeout options in the native runtime.
   * Repository environment overrides and trace settings are removed, while
   * configured credential helpers and SSH authentication remain available. Raw Git errors
   * are never returned because they can contain credentials or remote content.
   */
  #run(
    args: string[],
    message: string,
    maxBuffer = 8_000_000,
  ): Promise<string> {
    const env: Record<string, string | undefined> = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_DEFAULT_HASH: 'sha1',
    }

    for (const key of Object.keys(env)) {
      if (
        key.startsWith('GIT_TRACE') ||
        [
          'GIT_DIR',
          'GIT_COMMON_DIR',
          'GIT_WORK_TREE',
          'GIT_INDEX_FILE',
          'GIT_OBJECT_DIRECTORY',
          'GIT_ALTERNATE_OBJECT_DIRECTORIES',
          'GIT_NAMESPACE',
          'GIT_SHALLOW_FILE',
          'GIT_GRAFT_FILE',
          'GIT_REPLACE_REF_BASE',
          'GIT_PREFIX',
          'GIT_IMPLICIT_WORK_TREE',
          'GIT_INTERNAL_SUPER_PREFIX',
          'GIT_CURL_VERBOSE',
        ].includes(key)
      ) {
        delete env[key]
      }
    }

    const invocation = [
      '-c',
      `core.hooksPath=${join(this.#directory, 'disabled-hooks')}`,
      '-c',
      'gc.auto=0',
      '-c',
      'maintenance.auto=false',
      '-c',
      'init.defaultObjectFormat=sha1',
      '-c',
      'protocol.ext.allow=never',
      '--git-dir',
      this.#directory,
      ...args,
    ]

    try {
      const output = execFileSync('git', invocation, {
        encoding: 'utf8',
        env,
        timeout: 30_000,
        maxBuffer,
        stdio: 'pipe',
      })

      return Promise.resolve(output)
    } catch {
      return Promise.reject(new Error(message))
    }
  }
}
