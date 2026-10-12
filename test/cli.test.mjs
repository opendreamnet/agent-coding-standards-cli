/* oxlint-disable import/no-nodejs-modules -- These tests use the Node.js test runner. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const binary = process.env.CLI_TEST_BINARY

function runCli(args) {
  return spawnSync(
    binary ?? process.execPath,
    binary ? args : [entry, ...args],
    {
      encoding: 'utf8',
    },
  )
}

test('parses a string flag', () => {
  const result = runCli(['--name', 'Ada'])

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Hello, Ada!\n')
})

test('parses a boolean flag and its alias', () => {
  for (const flag of ['--uppercase', '-u']) {
    const result = runCli(['--name', 'Ada', flag])

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'HELLO, ADA!\n')
  }
})

test('shows help without printing a greeting', () => {
  const result = runCli(['--help'])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /agent-coding-standards/)
  assert.match(result.stdout, /--uppercase/)
  assert.doesNotMatch(result.stdout, /Hello,/)
})

test('uses the default name when no flags are supplied', () => {
  const result = runCli([])

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Hello, World!\n')
})

test('rejects unknown flags', () => {
  const result = runCli(['--unknown'])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /unknown option/)
})

test('rejects a string option without its value', () => {
  const result = runCli(['--name'])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /argument missing/)
})
