# Native procedural road contact

Observed in one consuming Unreal 5.8.2 CL56702186 project on Windows; not reproduced in this repo. This is a consuming-project case study, not a universal collision prescription. Source, actual physics trajectories and rendered bodywork answer different questions.

## Reproduce and separate the mechanisms

- [general] A closed 80 cm ProceduralMesh triangle road shell, with CCD on the simulated chassis, admitted a head-on wall impact. The chassis center ended well below the road top; a vertical drop settled near the underside. Suspension still reported contacts. Above-road traces found the correct top, so missing rendered road was not the failure.
- [documented] Installed ProceduralMeshComponent source already sets `bDoubleSidedGeometry=true` before collision cooking. Reassigning it after CreateMeshSection was redundant in this version and did not explain the observed failure. Inspect installed implementation before treating a suspicious local assignment as the root cause.
- [general] The probe separated chassis center/oriented box corners, actual transformed imported body/wheel vertices, camera height, road support trace, contacts, velocity and reset serial. An overhanging corner outside a deck footprint is not proof of tunneling. Severe impacts can briefly compress visual wheels below the local plane while the chassis remains supported.

## A fix can pass the original gate and create another regression

- [general] Replacing the surface with several hundred convex prisms sharing the same tile corners/depths prevented below-deck loss in every fixture. However a high-speed closed-loop run encountered a steep internal convex-cap contact, became airborne and departed the track. Its floor-only assertion ignored outside-deck positions correctly, but therefore could not establish track retention.
- [general] Two explicit retained-track checks and independent CSV corridor checks made that intermediate receipt RED. The final experiment restored the original continuous triangle contact surface and added hidden collision-only convex support tops a few centimetres beneath it, retaining the original bottoms and the intentional jump gap. The native suite then passed with no recovery or track departures; the closed-loop sample stayed grounded for every frame.
- [general] The final wall/ram/drop and high-speed seam cases cover bounded initial fixtures. The vertical drop observation window was lengthened to include a real rebound and settling, keeping its original minimum-contact-frame requirement. Other cases kept the shorter window. A longer legitimate observation is different from lowering a failed threshold or relocating the vehicle during measurement.

## Preserve the evidence contract

- [general] Record fixture-only initial pose/velocity assignments, then observe ordinary production physics without per-frame corrections or rescue resets. Require actual contact/air/ground exposure as well as no-loss outcomes; a fixture that never reaches its hazard proves little. Preserve old failures, intermediate regressions and successful native reports independently.
- [general] Keep visual construction separate from contact ownership. Assert the actual cooked/runtime hull count and intentional openings. Check gameplay and real screenshots after a collision representation change; pure geometry calculations cannot establish solver behavior, visual overlap, human handling or sustained performance.

See [the native game loop](unreal-native-game.md) for capture provenance and simulation-time limits.
