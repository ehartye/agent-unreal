import { readFileSync } from 'node:fs';
import { runContainedProcess } from '../controller.mjs';
const options = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const result = await runContainedProcess(options);
process.exitCode = result.exitCode;
