# UMG cost rules and the focus and input traps

Target: Unreal Engine 5.8. The cost rules are Epic's; no run measured any UI cost, so none of them is tested and none comes with a number. Epic's page gives relative cost only. The traps are in two groups: what Epic documents, and single forum posts, labelled anecdotal. A native game's frame-time measurement is in [unreal-native](../../unreal-native/SKILL.md).

## Cost rules (Epic's Optimization Guidelines for UMG)

- [documented] Invalidation caches widget information and repaints only what changed: Invalidation Boxes cache their children, Global Invalidation treats the whole window as one, and Retainer Panels flatten children to a texture with a configurable frame rate. It suits groups that rarely change; widgets that change every frame should be marked Volatile.
- [documented] Use On Tick and On Paint logic sparingly; Event Dispatchers and delegates respond to specific events without Tick.
- [documented] Never use raw attribute binding. A bound attribute is polled every frame; call a function or event in the widget when the value changes, for example an `OnHealthChanged` event instead of binding a health bar to the attribute.
- [documented] Every child of a widget is loaded and constructed whether or not it is visible, so remove unused widgets before committing. Keep widgets that need a fast response loaded but hidden, and load rarely used ones asynchronously and destroy them when dismissed.
- [documented] Use Canvas Panels sparingly: they increment their children's Layer IDs and so use several draw calls, and Overlays do too, though less. One Canvas Panel as the root of a HUD or menu is fine; avoid one inside each custom widget. Overlays, Size Boxes and Horizontal, Vertical or Grid Boxes can often replace them.
- [documented] A Spacer is much cheaper than a Size Box, which takes several passes. Do not combine a Scale Box and a Size Box: they update each other and flip between two sizes every frame.
- [documented] Rich Text widgets are very expensive next to standard text. Prefer a font that carries the style and a standard Text widget.
- [documented] Animation cost, cheapest first: material-only animation costs no CPU; Blueprint-scripted animation is low; Sequencer animation from UMG's animation editor is high; animation that changes layout is the most expensive. A Sequencer animation that changes a non-transform attribute such as colour redraws the widget without invalidating layout, and a render-transform animation invalidates layout every frame it changes the widget: avoid it or mark the widget Volatile.
- [documented] A Sequencer animation initializes an animation object and resolves its property paths before it starts, so for short, frequent animations such as damage numbers use Blueprint-scripted tweens.
- [documented] Epic's page points to Unreal Insights and Slate Insights for profiling UI; this skill did not run either.
- [general] The probe's test widget used one Canvas Panel as its root and no bound attributes; that follows the rules above and is not a measurement. Read a cost claim as relative and measure on the target device before acting on it.
- [general] These rules apply to scripted widgets as to any others: a script that adds many children to a canvas, binds attributes or fills a widget with Rich Text builds the cost in.

## Focus and input traps documented by Epic

- [documented] Epic's CommonUI Input Technical Guide lists what to check when a synthetic cursor click misbehaves: the pointer event may be handling input for the wrong user, the cursor may be far from the expected position, or another widget that has capture may change the widget path, depending on the Input Config's mouse capture mode.
- [documented] The same guide warns that input processors run on all input, the Unreal Editor's included, and names `FCommonAnalogCursor::IsGameViewportInFocusPathWithoutCapture` as a way to tell the game from the rest of the editor.
- [documented] Epic's 5.8 release notes: `UCommonUILibrary::RefreshFocusIfLeafmostDescendant` refreshes focus on the leafmost activatable widget for asynchronously created or plugin-injected widgets that cannot call the refresh on their owner; `CommonUI.DumpActivatableTree` shows each node's `SupportsActivationFocus`.
- [documented] Epic's 5.8 release notes fix list-view focus that was stranded on the container when no item was selected (it now falls back to item 0), a one-frame focus flash on common list and tile views, and a hold-action fix behind `CommonUI.bEnhancedInputDynamicallyResolveHoldKeysForInputAction`. Proximate-entry navigation for list and tile views is opt-in through `bEnableProximateEntryNavigation`.

## Anecdotal traps (single forum posts, none run here)

- [general] Anecdotal, one 2023 forum guide for 5.1 to 5.2: a widget's own input component does not follow focus order, and input is better handled by overriding the key handlers on the widget; the poster treats the component as useful only for opening a menu from gameplay.
- [general] Anecdotal, the same guide: a focusable inner widget such as a button handles the navigation and selection keys before the outer widget, so set `bIsFocusable` deliberately on the one widget meant to receive input.
- [general] Anecdotal, the same guide: visually diagonal or long-distance navigation often fails; wrap scroll box entries in a box; set the navigation rules to Stop in every direction on a menu's root widget so focus does not jump to a background widget by position; a skipped focusable widget may have its visibility set to Hit Test Invisible.
- [general] Anecdotal, the same guide: an asset referenced only from C++ may be left out of packaging, so a localized string reads as missing; add such assets to the packaging settings. The guide also says Common UI is built on the older Slate and UMG code and so inherits its bugs; that is the poster's opinion.
- [general] Anecdotal, one 5.7 forum report: pressing all four shoulder buttons and triggers while moving the stick left Common UI navigation in a corrupted state. The poster traced it to code in `CommonAnalogCursor.cpp` compiled only when `UE_BUILD_SHIPPING` is not defined, which would limit it to editor and development builds; Epic did not confirm it in the captured thread.
- [general] Epic's documented activatable-widget model addresses part of what the 2023 guide calls a trap, returning focus after a popup closes. The two sources do not discuss each other, and nothing here shows that Common UI removes the other traps.

## Not established

- [general] No UI cost was measured, no focus or navigation trap was reproduced, and none of the anecdotal reports was checked on 5.8. Input and focus behaviour on a physical gamepad or keyboard needs a person at the device.
