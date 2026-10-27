// node examples/unreal/verify_all.mjs --engine "<UE_5.8 folder>" [--class headless,render,package] [--only name,name] [--skip name,name]
//                                    [--report <path>] [--stop-on-fail] [--list]
// Re-verifies an engine build: runs every probe and validator in verify/manifest.mjs one at a time, judges each against its expected
// count, prints a table and writes a JSON report. Run it on each machine class (headless, render, package), then give the reports to
// scripts/pin-engine.mjs. Exit code 0 when everything that ran passed or failed as expected, 1 on a mismatch or error, 2 on usage.
// An engine that is not the pinned build gets a NOTE and is judged the same way; nothing refuses to run on it.
import { main } from './verify/verify-lib.mjs';

process.exitCode = await main(process.argv.slice(2));
