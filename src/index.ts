import * as dotenv from 'dotenv';
dotenv.config();

import { fetchCommand } from './commands/fetch';
import { generateCommand } from './commands/generate';
import { approveCommand } from './commands/approve';
import { postCommand } from './commands/post';
import { statusCommand } from './commands/status';

const args = process.argv.slice(2).filter(a => a !== '--');
const command = args[0];
const cmdArgs = args.slice(1);

async function main(): Promise<void> {
  switch (command) {
    case 'fetch':    await fetchCommand(cmdArgs); break;
    case 'generate': await generateCommand(cmdArgs); break;
    case 'approve':  await approveCommand(); break;
    case 'post':     await postCommand(); break;
    case 'status':   await statusCommand(); break;
    default:
      console.error(`Unknown command: "${command}"`);
      console.error('Available commands: fetch | generate | approve | post | status');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('\n✗ Error:', err.message ?? err);
  process.exit(1);
});
