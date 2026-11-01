import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { json, fileIdentity, canonical, unpack } from './bootstrap-files.mjs';

const message = resolve(process.argv[2]), root = dirname(message), data = json(message);
const runtime = join(root, 'runtime.uar');
if (canonical(fileIdentity(runtime)) !== canonical(data.runtime)) throw Error('Runtime package differs');
if (data.action === 'start' && canonical(data.request.runtime) !== canonical(data.runtime)) throw Error('Request/runtime identity differs');
unpack(runtime, join(root, 'runtime'));
const { endpoint } = await import(pathToFileURL(join(root, 'runtime/scripts/lib/unreal-remote/endpoint.mjs')));
console.log(JSON.stringify(await endpoint(message)));
