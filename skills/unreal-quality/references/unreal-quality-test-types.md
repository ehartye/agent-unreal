# Test types and choosing one

Source for every `[documented]` line here: Epic's 5.8 pages "Automation Test Framework in Unreal Engine", "Write C++ Tests in Unreal Engine", "Automation Spec in Unreal Engine", "CQTest Test Framework for Unreal Engine", "Functional Testing in Unreal Engine", "Write Low-Level Tests in Unreal Engine", "Automation Driver in Unreal Engine", "Write Editor Tests with Python in Unreal Engine" and "Data Validation in Unreal Engine". Lines marked community come from one July 2026 article, "Testing in Unreal Engine 5: CQTest, Automation Spec, Functional Tests, and CI"; its authors say its code samples were not fully compiled in a 5.8 project.

## What Epic documents

- `[documented]` The Automation Test Framework names Unit (API-level), Feature (system-level, such as PIE), Smoke, Content Stress and Screenshot Comparison tests. It is built in C++, outside the `UObject` environment, and "is not ideal for pure unit testing"; Epic points to Low-Level Tests for that.
- `[documented]` Smoke tests are "a speed promise by the implementer": they should finish within one second, and only Unit or fast Feature tests should be marked Smoke.
- `[documented]` Simple tests (`IMPLEMENT_SIMPLE_AUTOMATION_TEST`) are single atomic checks. Complex tests (`IMPLEMENT_COMPLEX_AUTOMATION_TEST`) run one `RunTest` over many inputs through `GetTests` and are "generally content stress tests". Put tests in the module's `Private\Tests` directory.
- `[documented]` Automation Spec is BDD-style (`Describe`, `It`, `BeforeEach`, `AfterEach`). Each `It()` is an individual test, and Epic's design intent is to test the public API, not an implementation. It suits latent and thread-sensitive work.
- `[documented]` CQTest extends `FAutomationTestBase` with fixtures that reset state between tests (`BEFORE_EACH`, `AFTER_EACH`, `TEST_METHOD`), spawn helpers (`ActorTestSpawner`, `MapTestSpawner`), `PIENetworkComponent` for replication tests and a fluent `TestCommandBuilder`.
- `[documented]` Functional Tests place a Functional Test Actor in a level. A child `AFunctionalTest` class is "the recommended method" when setup is complex, repeated, spans levels or takes more than a frame; the Level Script suits simple tests. Ground Truth Data stores a verified result to compare later runs against.
- `[documented]` Low-Level Tests use Catch2 in a separate executable, are described as lightweight, and target the smallest testable unit, running "in seconds or less". Explicit tests need their own `.Build.cs` and `.Target.cs`.
- `[documented]` Automation Driver simulates desktop keyboard and mouse input for UI tests. Python tests (`test_*.py` under `/Content/Python`, PythonAutomationTest plugin) suit editor and content checks.
- `[documented]` Data Validation checks assets against rules (naming, budgets, dependencies) in the editor, on save and in CI. By default only C++ rules run.
- `[documented]` Tests placed in plugins can be enabled individually, kept out of packaged builds and stored outside the project's `Content` folder.

## Choosing one

| Behaviour to prove | Test type | Basis |
|---|---|---|
| Pure rule, math, data conversion with no engine state | Low-Level Test, or CQTest / Simple test | Epic: LLT for pure unit tests; community: lightest environment |
| Readable multi-step scenario, async or latent steps | Automation Spec | Epic |
| Many inputs through one check (every map, row, asset) | Complex test | Epic |
| Actors, components, Blueprint and level wiring | Functional Test or CQTest with a spawner | Epic |
| Replication between server and clients | CQTest `PIENetworkComponent` | Epic |
| UI flows | Automation Driver paired with Spec | Epic |
| Editor or content-production rules | Python test or Data Validation | Epic |
| Packaged build, devices, multiple processes | Gauntlet | Community; Epic's Gauntlet pages cover running it |

- `[general]` Community advice: "Use the lightest execution environment that can prove the behavior you care about." Keep most rule checks in fast C++ tests, add a few Functional Tests for critical wiring, and bring in Gauntlet only when the packaged runtime or several processes are part of the requirement.
- `[general]` Move deterministic rules out of Actors and widgets into plain functions or classes so they can be tested without a world. When a rule cannot be reached without a controller or game instance, that is an [architecture](../../unreal-architecture/SKILL.md) finding.
- `[general]` Epic does not rank the types against each other, set a coverage target or give a ratio between layers. Report such choices as preferences.
- `[general]` Keep tests needing CQTest, editor modules or Functional Testing in a dedicated tests module or plugin (community advice), so test-only code stays out of Shipping targets.

Next: [test design](unreal-quality-test-design.md).

- `[general]` The [AgentVerify sample](../../../examples/unreal/agent_verify/README.md) demonstrates consumer ownership with an engine-free `Domain/TravelRule.h` and the Automation name `ObservationSample.Domain.Travel.ReleasedAxisStopsMovement`. Use `<Project>.Domain.<Area>.<Rule>` for such checks; keep world, controller, audio and file adapters outside the rule. AgentVerify supplies scenario observation, not a replacement for Automation, Functional Tests or a general game-test framework.
