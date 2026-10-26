# C++ structure rules

Source for every `[documented]` line here: Epic's 5.8 page "Epic C++ Coding Standard for Unreal Engine". The page is long; this keeps the rules that shape structure and are cheap to check. It says little about `UCLASS`, `USTRUCT` or `UPROPERTY` specifiers, `.generated.h` ordering or smart-pointer ownership, so this reference does not either.

## Naming and layout

- `[documented]` Type prefixes: `T` templates, `U` `UObject` descendants, `A` `AActor` descendants, `S` `SWidget`, `I` abstract interfaces, `C` concept-like structs, `E` enums, `F` most other classes and structs. Unreal Header Tool requires the right prefix in most cases. File names carry no prefix (`Scene.cpp`, not `UScene.cpp`).
- `[documented]` PascalCase with no underscores; boolean variables start with `b`; types and variables are nouns, methods are verbs; macros are fully capitalized and prefixed `UE_`. Functions returning `bool` should ask a question (`IsVisible()`). Avoid names starting `Handle` or `Process` as ambiguous.
- `[documented]` Class organization is for the reader: public interface first, then private implementation. Declare each variable on its own line so it can be commented.
- `[documented]` Modules have `Public` and `Private` source directories: anything other modules need goes in `Public`, everything else in `Private`.

## Headers and includes

- `[documented]` Guard every header with `#pragma once`. Minimize physical coupling: prefer forward declarations to includes, avoid including standard library headers from other headers, include fine-grained headers rather than `Core.h`, include everything you need directly and never rely on indirect inclusion.
- `[documented]` Do not set up headers for precompiled-header generation; Unreal Build Tool does that better. Avoid non-trivial static variables in headers.
- `[documented]` Namespaces are not supported by Unreal Header Tool, so do not use them on `UCLASS` or `USTRUCT`. New non-reflected APIs go in a `UE::` namespace, and no `using` declarations at global scope, even in `.cpp` files, because of unity builds.

## Encapsulation and API shape

- `[documented]` Members are almost always private unless part of the public or protected interface; use private fields with protected accessors for derived-only access. Mark a class `final` if it is not designed to be derived from.
- `[documented]` Avoid boolean parameters, especially flags: prefer an enum flag type (a single-state setter such as `SetEnabled(bool bEnabled)` is acceptable). Pass a struct instead of long parameter lists. Do not overload on `bool` and `FString`.
- `[documented]` Interface classes are abstract, prefixed `I`, and have no member variables. Pass `UObject`s by pointer, not by reference.
- `[documented]` Use `enum class` (including for `UENUM`s) instead of namespaced enums; `UENUM`s exposed to Blueprints must still be based on `uint8`. Use `ENUM_CLASS_FLAGS` for flags with a `None = 0` enumerator.
- `[documented]` Platform code lives in platform subdirectories behind the hardware abstraction layer; cross-platform code must never depend on platform-specific code.

## Build cost and deferred code

- `[documented]` Split large functions, avoid many inline functions (they force rebuilds in files that do not use them) and be conservative with `FORCEINLINE`.
- `[documented]` Lambdas: keep them to a couple of statements, capture explicitly rather than `[&]` or `[=]`, and never capture locals or members by reference in a deferred lambda. Use `CreateWeakLambda`, `CreateSPLambda` or weak pointers for deferred execution, because automatic capture can hide a `UObject` pointer from the garbage collector.
- `[documented]` Default member initializers suit in-game code more than engine code; consider config files for default values. Changing a header default rebuilds dependents.

## Use in an audit

- `[general]` Sample the highest-traffic headers rather than checking every file; report a pattern (monolithic includes, public data members, boolean flag parameters) once with a count and two examples.
- `[general]` Naming and formatting findings are low severity and rarely belong in a remediation plan unless a tool can fix them in bulk. Include-hygiene and encapsulation findings that widen dependencies rank higher.
- `[general]` Epic's standard is written for engine code; its own text says some rules suit engine code more than game code. Mark a game-side deviation as a preference unless it breaks a build rule.

Next: [audit](unreal-architecture-audit.md).
