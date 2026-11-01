import { join, resolve } from 'node:path';
import { json, write } from './files.mjs';
import { materialize, ignored } from './source.mjs';
import { checkLease, readState } from './state.mjs';

// Fixed internal setup workload. The shared launcher bounds and drains this process and its Git children.
const directory = resolve(process.argv[2]), request = json(join(directory, 'request.json')), metadata = json(join(directory, 'worker.json'));
const state = readState(directory, request); checkLease(metadata.lease, request, state);
if (state.phase !== 'running') throw Error('Materialization has no running worker authority');
const worktree = materialize(metadata.base, request, metadata.payload);
const launcher = { ...request.remote.launcher, project: join(worktree, request.remote.launcher.project), sourceRoot: worktree };
if (launcher.packageDirectory) launcher.packageDirectory = ignored(worktree, join(worktree, launcher.packageDirectory));
write(join(directory, 'project.json'), launcher);
write(join(directory, 'materialized.json'), { version: 1, worktree, source: request.source });
