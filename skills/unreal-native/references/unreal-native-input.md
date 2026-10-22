# Native Unreal input replay

Observed in one consuming Unreal 5.8.2 CL56702186 project on Windows; not reproduced in this repo. Engine source inspection and executed behaviour are labelled separately. Simulated mapped events do not establish human controller acceptance.

- [documented] Installed-source inspection: `UPlayerInput` adds analog samples within one processing frame (`PlayerInput.cpp:331–332`) and retains trigger state without a new sample (`1345–1395`). A press sample of 1 followed by 0 in the same frame sums to 1. Replay one complete trigger state per frame, including zero values after release; avoid transition-frame duplicates.
- [general] A first controller replay retained the right trigger at 1 during left-trigger braking and failed reverse. `-NoGamepad` alone did not fix it. After correcting the sample schedule, the native suite passed all its checks, including brake-to-reverse. The suite drove simulated events through production mappings.
- [documented] Installed-source inspection: Windows `-NoGamepad` sets `bForceNoGamepads` and returns before `PollGameDeviceState` external-device polling (`WindowsApplication.cpp:1302–1305,4247–4252`). It is process-local. A capture-only controller guard can additionally reject `!Params.IsSimulatedInput()` and flush initial cached keys once, while ordinary play keeps hardware input. Preserve native failure/proof receipts rather than assuming a launch flag establishes isolation.

See the [native game loop](unreal-native-game.md) for fresh artifact validation, process ownership and fixed simulation step limits.

Input actions, mapping contexts and runtime context switching: [Enhanced Input](../../unreal-features/references/unreal-enhanced-input.md).
