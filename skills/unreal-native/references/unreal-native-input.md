# Native Unreal input replay

Observed in one consuming project on an earlier engine build; not reproduced in this repo. Engine source inspection and executed behaviour are labelled separately. Simulated mapped events do not establish human controller acceptance.

- [documented] Installed-source inspection: `UPlayerInput` adds analog samples within one processing frame (`PlayerInput.cpp:331–332`) and retains trigger state without a new sample (`1345–1395`). A press sample of 1 followed by 0 in the same frame sums to 1. Replay one complete trigger state per frame, including zero values after release; avoid transition-frame duplicates.
- [general] A first controller replay retained the right trigger at 1 during left-trigger braking and failed reverse. `-NoGamepad` alone did not fix it. After correcting the sample schedule, the native suite passed all its checks, including brake-to-reverse. The suite drove simulated events through production mappings.
- [documented] Installed-source inspection: Windows `-NoGamepad` sets `bForceNoGamepads` and returns before `PollGameDeviceState` external-device polling (`WindowsApplication.cpp:1302–1305,4247–4252`). It is process-local. A capture-only controller guard can additionally reject `!Params.IsSimulatedInput()` and flush initial cached keys once, while ordinary play keeps hardware input. Preserve native failure/proof receipts rather than assuming a launch flag establishes isolation.

- [documented] Installed-source inspection (`InputCoreTypes.cpp:170–207,686–722`): a gamepad control that has both a value and a press is two keys. An analog key is an axis that carries a value; a digital key is a button that is pressed and released. An input mapping names one key, so replay the key the mapping names.

| Control | Analog key (send a value each frame) | Digital key (press and release) |
|---|---|---|
| Left trigger | `Gamepad_LeftTriggerAxis` | `Gamepad_LeftTrigger` |
| Right trigger | `Gamepad_RightTriggerAxis` | `Gamepad_RightTrigger` |
| Left stick | `Gamepad_LeftX`, `Gamepad_LeftY` (paired as `Gamepad_Left2D`) | `Gamepad_LeftStick_Up`, `_Down`, `_Left`, `_Right` |
| Right stick | `Gamepad_RightX`, `Gamepad_RightY` (paired as `Gamepad_Right2D`) | `Gamepad_RightStick_Up`, `_Down`, `_Left`, `_Right` |
| Mouse movement | `MouseX`, `MouseY` | none |

- [general] Read the key from the mapping asset before writing the replay, then check the outcome the mapping drives. In one project a trigger ability bound to the digital trigger key never fired when the replay sent a value to the analog key, and the replay reported no error.
- [documented] Installed-source inspection (`InputKeyEventArgs.cpp:50–53`): `FInputKeyEventArgs::CreateSimulated` sets the sample count to 1 for an analog key and 0 for a digital key unless the caller gives a count. A simulated stick value is one sample, so send it every frame.

See the [native game loop](unreal-native-game.md) for fresh artifact validation, process ownership and fixed simulation step limits.

Input actions, mapping contexts and runtime context switching: [Enhanced Input](../../unreal-gameplay/references/unreal-enhanced-input.md).
