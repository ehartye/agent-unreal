# Test design: determinism, isolation and latent work

Source for every `[documented]` line here: Epic's 5.8 pages "Automation Test Framework in Unreal Engine", "Write C++ Tests in Unreal Engine", "Automation Spec in Unreal Engine", "CQTest Test Framework for Unreal Engine", "Functional Testing in Unreal Engine", "Write Low-Level Tests in Unreal Engine", "Automation Driver in Unreal Engine" and "Write Editor Tests with Python in Unreal Engine". Community lines come from one July 2026 article (see [test types](unreal-quality-test-types.md)).

## Isolation and state

- `[documented]` Epic's design guidelines: "Do not assume the state of the game or the Editor" (tests can run out of order or in parallel across machines); leave files on disk as you found them, so a test that generates a file deletes it; assume the previous run left the test in a bad state.
- `[documented]` CQTest resets data members between tests. `AFTER_EACH` still runs after a failed assertion, and `OnTearDown` or `CleanUpWith` cleanups run in reverse order.
- `[documented]` Spec: keep `AfterEach()` for clean-up only, and keep each `It()` to one expectation; Epic says `It()` should be used "ideally to just assert the expectation".
- `[documented]` Functional Tests: register spawned actors with `RegisterAutoDestroyActor` so they are destroyed when the test ends; cleanup in `OnTestFinished` can be "vitally important" because tests alter levels and actors.
- `[documented]` Low-Level Tests: unit tests should use mocking, avoid external dependencies and order dependencies, and use cross-platform file APIs (`FPlatformFileManager`).

## Waiting and latent work

- `[documented]` Anything not guaranteed to finish in one frame needs a latent command: in the Editor a map loads immediately, but in game it loads on the next frame. `Update()` returns `true` when a latent command is complete.
- `[documented]` CQTest: prefer `FWaitUntil` (or `StartWhen`/`Until`) to timed waits, which "can introduce unreliability due to variable runtimes". Latent actions cannot yet be added from inside latent actions.
- `[documented]` Spec: `LatentIt()` with a `Done` delegate holds the next block until `Done` is called; `EAsyncExecution` runs a block on a task graph, thread pool or dedicated thread while keeping sequential order.
- `[documented]` Functional Tests: `IsReady` returns `false` while `PrepareTest`'s work is still running; the test must call `FinishTest`.
- `[documented]` Automation Driver: its synchronous API cannot run on the GameThread (it deadlocks), so run it off the GameThread, pair it with Spec, and set up in `BeforeEach()`. Prefer `By::Id()` locators; `By::Path()` is "the most brittle". Python: the editor does not tick during a script, so use `add_latent_command` with `yield`.

## Assertions and expected errors

- `[documented]` Low-Level Tests: every `SECTION` or `THEN` needs at least one `REQUIRE` or `CHECK` ("Tests that don't have expectations are useless"); `REQUIRE` stops the test, `CHECK` continues. Make tests deterministic and of one type; tag slow ones `[slow]` or `[performance]`.
- `[documented]` Python: `assert` or `raise` stops the test; `unreal.log_error` continues. `add_expected_log_error` needs the right occurrence count the first time.
- `[documented]` Automation Spec: parameterized `It()` loops can cause "test bloat"; weigh the number of inputs against the number of tests.

## Judgements and community advice

- `[general]` Never `Sleep` on the game thread to wait for a condition; wait on the condition with a timeout. A test that sleeps to wait for an object it never uses is waiting for nothing.
- `[general]` A test that cannot fail is the worst finding. Prove a new or repaired test can fail by breaking the behaviour on purpose and watching it go red, then restore.
- `[general]` Community advice: fix random seeds and print the seed and input on failure; compare floats with an explicit tolerance; write files under a test-only temporary directory; make failure messages state the condition, expected, actual and target id; register expected errors narrowly with an exact count and test routine invalid input through return values.
- `[general]` One World-independent rule test is the cheapest first step. Add a regression test with the next reproducible bug fix rather than chasing a coverage percentage.

Next: [headless runs and lanes](unreal-quality-lanes.md).
