import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { existsSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { GitRules } from '../src/standards/git.ts'

const revision = 'a'.repeat(40)

/**
 * Replaces native Git calls with controlled responses while keeping the real
 * temporary storage lifecycle. Restores both CommonJS and ESM bindings afterward.
 */
function mockGit(context, handler) {
  const calls = []

  const mocked = context.mock.method(
    childProcess,
    'execFileSync',
    (command, args, options) => {
      calls.push({ command, args, options })

      return args.includes('init') ? '' : handler(args)
    },
  )

  syncBuiltinESMExports()

  context.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  })

  return calls
}

test('uses argument arrays, immutable commits and isolated temporary storage', async (context) => {
  const calls = mockGit(context, (args) => {
    if (args.includes('rev-parse')) {
      return `${revision}\n`
    }

    if (args.includes('ls-tree')) {
      return `100644 blob ${'b'.repeat(40)}\tprofiles/typescript.md\n`
    }

    if (args.includes('cat-file')) {
      return '13\n'
    }

    return args.includes('show') ? '# TypeScript\n' : ''
  })

  const source = new GitRules({ repository: 'company/rules' })

  try {
    const release = await source.fetchVersion('1.0.0')
    const contents = await source.fetchProfiles(release, ['typescript'])

    assert.deepEqual(contents, ['# TypeScript\n'])
    assert.deepEqual(release, { version: '1.0.0', revision })

    const fetch = calls.find(({ args }) => args.includes('fetch'))
    const show = calls.find(({ args }) => args.includes('show'))

    assert.ok(fetch.args.includes('refs/tags/v1.0.0'))
    assert.ok(fetch.args.includes('https://github.com/company/rules.git'))
    assert.ok(show.args.includes(`${revision}:profiles/typescript.md`))

    assert.ok(
      calls.every(
        ({ command, options }) => command === 'git' && options.shell !== true,
      ),
    )

    assert.ok(calls.every(({ options }) => options.stdio === 'pipe'))

    assert.ok(
      calls.every(
        ({ args }) => !args.includes('push') && !args.includes('checkout'),
      ),
    )
  } finally {
    source.close()
  }

  const directory = calls[0].args[calls[0].args.indexOf('--git-dir') + 1]

  assert.equal(existsSync(directory), false)
})

test('selects stable SemVer tags and ignores annotated peeled lines', async (context) => {
  mockGit(context, (args) => {
    if (args.includes('ls-remote')) {
      return `${revision}\trefs/tags/v1.9.0\n${revision}\trefs/tags/v1.10.0\n${revision}\trefs/tags/v1.10.0^{}\n${revision}\trefs/tags/v3.0.0-beta.1\n`
    }

    return args.includes('rev-parse') ? `${revision}\n` : ''
  })

  const source = new GitRules({ repository: 'company/rules' })

  try {
    assert.deepEqual(await source.fetchLatestVersion(), {
      version: '1.10.0',
      revision,
    })
  } finally {
    source.close()
  }
})

test('keeps raw Git errors and remote output out of failure messages', async (context) => {
  mockGit(context, () => {
    throw new Error('secret-sentinel')
  })

  const source = new GitRules({ repository: 'company/rules' })

  try {
    await assert.rejects(source.fetchVersion('1.0.0'), {
      message: 'The requested rules tag does not exist or is not accessible.',
    })
  } finally {
    source.close()
  }
})

test('rejects unsupported transports and credentials embedded in repository identifiers', () => {
  assert.throws(
    () => new GitRules({ repository: 'company/rules', transport: 'file' }),
  )

  assert.throws(
    () =>
      new GitRules({
        repository: 'https://secret-sentinel@github.com/company/rules',
      }),
  )
})

test('uses the SSH transport without adding credentials to arguments', async (context) => {
  const calls = mockGit(context, (args) =>
    args.includes('rev-parse') ? `${revision}\n` : '',
  )

  const source = new GitRules({ repository: 'company/rules', transport: 'ssh' })

  try {
    await source.fetchVersion('1.0.0')

    assert.ok(
      calls.some(({ args }) =>
        args.includes('git@github.com:company/rules.git'),
      ),
    )
  } finally {
    source.close()
  }
})

test('rejects symbolic-link profiles before reading their blobs', async (context) => {
  const calls = mockGit(context, (args) => {
    if (args.includes('rev-parse')) {
      return `${revision}\n`
    }

    if (args.includes('ls-tree')) {
      return `120000 blob ${revision}\tprofiles/python.md\n`
    }

    return ''
  })

  const source = new GitRules({ repository: 'company/rules' })

  try {
    const release = await source.fetchVersion('1.0.0')

    await assert.rejects(
      source.fetchProfiles(release, ['python']),
      /not a regular Markdown file/,
    )

    assert.ok(calls.every(({ args }) => !args.includes('show')))
  } finally {
    source.close()
  }
})

test('strips consumer repository overrides and trace settings from the Git environment', async (context) => {
  const additions = {
    GIT_DIR: '/consumer/.git',
    GIT_WORK_TREE: '/consumer',
    GIT_INDEX_FILE: '/consumer/index',
    GIT_OBJECT_DIRECTORY: '/consumer/objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/consumer/alternate',
    GIT_GRAFT_FILE: '/consumer/grafts',
    GIT_TRACE: '/consumer/trace.log',
    GIT_TRACE_CURL: '/consumer/curl.log',
  }

  const previous = Object.fromEntries(
    Object.keys(additions).map((key) => [key, process.env[key]]),
  )

  context.after(() => {
    for (const key of Object.keys(additions)) {
      if (previous[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous[key]
      }
    }
  })

  Object.assign(process.env, additions)

  const calls = mockGit(context, (args) =>
    args.includes('rev-parse') ? `${revision}\n` : '',
  )

  const source = new GitRules({ repository: 'company/rules' })

  try {
    await source.fetchVersion('1.0.0')

    for (const { options } of calls) {
      assert.equal(options.env.GIT_TERMINAL_PROMPT, '0')
      assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, '1')
      assert.equal(options.env.GIT_DEFAULT_HASH, 'sha1')

      for (const key of Object.keys(additions)) {
        assert.equal(options.env[key], undefined)
      }
    }
  } finally {
    source.close()
  }
})
