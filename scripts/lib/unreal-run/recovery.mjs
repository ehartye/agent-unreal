// Fixed, engine-free policy boundary. Read the original JSON bytes so the native
// bridge cannot turn string/number/boolean evidence into a different contract.
import { readFileSync } from 'node:fs';
import { hash, recoveryDecision } from './contracts.mjs';

try {
  const input = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  if (!input || typeof input.lock !== 'string' || !['production', 'fixture'].includes(input.purpose)) throw Error('Missing recovery context');
  const bytes = readFileSync(input.ownerPath);
  const ownerHash = hash(bytes);
  if (ownerHash !== input.ownerHash) throw Error('Ownership evidence changed');
  const owner = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  console.log(JSON.stringify({ ...recoveryDecision(owner, input.observations, input), ownerHash, lock: input.lock }));
} catch (error) {
  console.error(`Recovery policy refused: ${error.message}`);
  process.exitCode = 74;
}
