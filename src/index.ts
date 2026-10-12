import { Command } from 'commander'

interface CliOptions {
  name: string
  uppercase?: boolean
}

const program = new Command()
  .name('agent-coding-standards')
  .description('Minimal commander compatibility test for scriptc')
  .option('--name <name>', 'Name to greet', 'World')
  .option('-u, --uppercase', 'Print the greeting in uppercase')
  .parse()

const options = program.opts<CliOptions>()
const greeting = `Hello, ${options.name}!`

console.log(options.uppercase ? greeting.toUpperCase() : greeting)
