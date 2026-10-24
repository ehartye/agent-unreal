import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskCode, splitArgs, matchClose, classifyQuery, scanContent, run, UsageError, DEFAULT_ROOTS, SKIP_DIRS } from './engine_source.mjs';

const SCRIPT = fileURLToPath(new URL('./engine_source.mjs', import.meta.url));

// Everything below is synthetic text written for these tests; none of it is an excerpt of Epic source.
const WIDGET_CVARS = [
  '// Synthetic fixture for the lookup tests.',
  '// A mention of TEXT("w.Widget.Ghost") in a comment is not a definition.',
  '#include "WidgetCvars.h"',
  '',
  'static TAutoConsoleVariable<int32> CVarWidgetBlend(',
  '\tTEXT("w.Widget.Blend"),',
  '\t2,',
  '\tTEXT("How widgets blend. ")',
  '\tTEXT("Higher values blend more.\\n")',
  '\tTEXT("0 - off"),',
  '\tECVF_Scalability',
  '\t\t| ECVF_RenderThreadSafe',
  ');',
  '',
  'int32 GWidgetLimit = 8;',
  'static FAutoConsoleVariableRef CVarWidgetLimit(TEXT("w.Widget.Limit"), GWidgetLimit, TEXT("Maximum widgets per frame."), ECVF_Default);',
  'static FAutoConsoleVariableRef CVarWidgetExternal(TEXT("w.Widget.External"), GWidgetExternal, TEXT("Declared in a header."), ECVF_Default);',
  '',
  'void RegisterWidgetCvars()',
  '{',
  '\tCVarWidgetQuick = IConsoleManager::Get().RegisterConsoleVariable(TEXT("w.Widget.Quick"), 1.5f, TEXT("Quick one."), ECVF_Default);',
  '\tUE_LOG(LogTemp, Log, TEXT("Check w.Widget.Blend and w.Widget.Ghost before enabling"));',
  '\tIConsoleVariable* Found = IConsoleManager::Get().FindConsoleVariable(TEXT("w.Widget.Blend"));',
  '\tRegisterWidgetConsoleVariable(TEXT("w.Widget.Wrapped"), 3);',
  '}',
  '',
  'static TAutoConsoleVariable<float> CVarWidgetNoFlags(TEXT("w.Widget.NoFlags"), 0.5f, TEXT("No flags given."));',
  'static FAutoConsoleCommand CmdWidgetDump(TEXT("w.Widget.Dump"), TEXT("Dump widgets."), FConsoleCommandDelegate::CreateStatic(&DumpWidgets));',
  '',
].join('\n');

// CRLF line endings, a backslash line continuation inside a string, qualified and macro-prefixed flags, help text that names a flag,
// readers and executors that are not registrations, and a console-named type the parser does not know.
const EXTRA_CVARS = [
  'static TAutoConsoleVariable<int32> CVarExtraWrapped(',
  '\tTEXT("w.Extra.Wrapped"),',
  '\t7,',
  '\tTEXT("First sentence here. \\n\\',
  '\t\tSecond line of help."));',
  'static TAutoConsoleVariable<float> CVarExtraHelpMentions(TEXT("w.Extra.HelpMentions"), 1.0f, TEXT("Use ECVF_ReadOnly to lock it."));',
  'static TAutoConsoleVariable<int32> CVarExtraQualified(TEXT("w.Extra.Qualified"), 1, TEXT("Qualified flags."), PRAGMA_ENABLE_DEPRECATION_WARNINGS EConsoleVariableFlags::ECVF_ReadOnly | ECVF_RenderThreadSafe);',
  'static FShaderPlatformCachedIniValue<int32> CVarExtraReader(TEXT("w.Extra.Reader"));',
  'void Run() { GEngine->Exec(World, ExecConsoleCommand(TEXT("w.Extra.Exec"))); }',
  'static FAutoConsoleTaskPriority CTaskExtra(TEXT("w.Extra.Task"), TEXT("Tasks."), ENamedThreads::A, ENamedThreads::B);',
  '',
].join('\r\n');

const SOLVER_H = [
  '#pragma once',
  '// WidgetSolve is mentioned in this comment only.',
  'class UWidgetBrush;',
  'struct FWidgetSolveParams { int32 Depth = 0; };',
  'class WIDGETS_API FWidgetSolver',
  '{',
  'public:',
  '\tstatic bool WidgetSolve(int32 Count);',
  '\tstatic bool WidgetSolveOp(int32 Count);',
  '};',
  '',
].join('\n');

// A class used as a base. The real declaration lives under Source; the derived classes, friends and initialiser lists sit under a
// Plugins folder that sorts first, which is the shape that buries a declaration behind a cap.
const BASE_H = [
  '#pragma once',
  'class UWidgetBase;',
  'class WIDGETS_API UWidgetBase : public UObject',
  '{',
  'public:',
  '\tvirtual void Tick() = 0;',
  '};',
  '',
].join('\n');

const DERIVED_H = [
  '#pragma once',
  'class GADGET_API UWidgetDerivedA : public UWidgetBase',
  '{',
  '};',
  'class GADGET_API UWidgetDerivedB : public UWidgetBase {',
  '};',
  'class UWidgetDerivedC',
  '\t: public UWidgetBase',
  '\t, public IWidgetThing',
  '{',
  '};',
  'struct FWidgetTag : UWidgetBase',
  '{',
  '};',
  'class UWidgetDerivedD : public IWidgetThing, public UWidgetBase',
  '{',
  '};',
  'class UWidgetDerivedE : public virtual UWidgetBase {};',
  'class TWidgetHolder : public TWidgetOf<UWidgetBase>',
  '{',
  '\tfriend UWidgetBase;',
  '\tfriend class UWidgetBase;',
  '};',
  '',
].join('\n');

const DERIVED_CPP = [
  '#include "WidgetDerived.h"',
  'FWidgetHolder::FWidgetHolder()',
  '\t: UWidgetBase(1)',
  '{',
  '}',
  'void Dispatch(int32 Which)',
  '{',
  '\tswitch (Which)',
  '\t{',
  '\tcase 1: UWidgetBase(2); break;',
  '\t}',
  '}',
  'FWidgetHolder::FWidgetHolder(int32 Count) :',
  '\tUWidgetBase(3)',
  '{',
  '}',
  'FWidgetHolder::FWidgetHolder(float Scale) :',
  '\tScale(Scale),',
  '\tUWidgetBase(4)',
  '{',
  '}',
  '',
].join('\n');

// Names that look like declarations on one line but are not: elaborated types in a signature, explicit instantiations and stream
// operands. The real declarations sit in a later file by path, which is the shape that buries them behind a cap.
const WIDGET_PTR_H = [
  '#pragma once',
  'template <typename T>',
  'class WIDGETS_API TWidgetPtr',
  '{',
  '};',
  'template <typename T>',
  'class TWidgetPtr<T*> : public TWidgetBase',
  '{',
  '};',
  'struct FWidgetText { };',
  'TMap<int32, TArray<int32>> BuildTable(int32 Count);',
  'typedef TMap<',
  '\tint32, FString',
  '> FWidgetTable;',
  '',
].join('\n');

const NOISE_CPP = [
  '#include "WidgetPtr.h"',
  'template class TWidgetPtr<int32>;',
  'extern template class TWidgetPtr<float>;',
  'class FNoiseHost',
  '{',
  '\tvirtual class TWidgetPtr<class IWidgetThing> GetThing() const;',
  '\tvoid Take(class TWidgetPtr<UWidgetGizmo> InGizmo);',
  '\tvoid Fill(class TWidgetPtr<UObject*>& Exclude);',
  '};',
  'void Print(FOutput& Out, FString String)',
  '{',
  '\tOut << FWidgetText(String);',
  '\tOut >> FWidgetText(String);',
  '\tOut << BuildTable(2);',
  '}',
  '',
].join('\n');

// Opaque enum declarations (`enum E : T;`) and a deprecation macro between the keyword and the name. The opaque and caller files sit
// at paths that sort before the real declarations, which is the shape that buries a real declaration behind a cap.
const KINDS_H = [
  '#pragma once',
  'enum class EWidgetKind : uint8',
  '{',
  '\tPlain,',
  '};',
  'enum EWidgetMode : uint8 { Fast, Slow };',
  'enum class EWidgetWide :',
  '\tuint16',
  '{',
  '\tWide,',
  '};',
  '',
].join('\n');

const KINDS_FORWARD_H = [
  '#pragma once',
  'enum class EWidgetKind : uint8;',
  'enum EWidgetMode : uint8;',
  'enum class EWidgetWide :',
  '\tuint16;',
  'enum class UE_DEPRECATED(5.0, "Replaced.") EWidgetRetired : uint8;',
  'class UE_DEPRECATED(5.0, "Use another widget.") FWidgetGone;',
  '',
].join('\n');

const DEPRECATED_H = [
  '#pragma once',
  'class UE_DEPRECATED(5.4, "Use X instead.") FWidgetOld : FNoncopyable',
  '{',
  '};',
  'class UE_DEPRECATED(5.4, "Use Y (or Z) instead.") WIDGETS_API UWidgetOld : public UObject',
  '{',
  '};',
  'struct DEPRECATED(4.0, "Use W instead.") FWidgetLegacy',
  '{',
  '};',
  'enum class UE_DEPRECATED(5.0, "Replaced.") EWidgetRetired : uint8',
  '{',
  '\tOne,',
  '};',
  '',
].join('\n');

const DEPRECATED_USE_CPP = [
  'void UseOld()',
  '{',
  '\tFWidgetOld Old;',
  '\tUWidgetOld* Ptr = nullptr;',
  '\tFWidgetLegacy Legacy;',
  '\tEWidgetRetired Retired = EWidgetRetired::One;',
  '\tFWidgetGone* Gone = nullptr;',
  '}',
  '',
].join('\n');

// Any ALL_CAPS macro call between the keyword and the name, whatever its arguments, one forward and one real declaration of each kind.
const MACRO_FORWARD_H = [
  '#pragma once',
  'class UE_EXPERIMENTAL(5.1, "Preview.") FWidgetPreview;',
  'struct UE_EXPERIMENTAL(5.1, "Preview.") FWidgetPreviewData;',
  'enum class UE_EXPERIMENTAL(5.1, "Preview.") EWidgetPreviewMode : uint8;',
  'class UE_DEPRECATED_FORGAME(5.5, "Use another widget.") UWidgetGameOnly;',
  'class UE_INTERNAL FWidgetInternal;',
  'enum class UE_INTERNAL EWidgetInternalMode : uint8;',
  '',
].join('\n');

const MACRO_H = [
  '#pragma once',
  'class UE_EXPERIMENTAL(5.1, "Preview.") FWidgetPreview',
  '{',
  '};',
  'struct UE_EXPERIMENTAL(5.1, "Preview.") FWidgetPreviewData : FNoncopyable',
  '{',
  '};',
  'enum class UE_EXPERIMENTAL(5.1, "Preview.") EWidgetPreviewMode : uint8',
  '{',
  '\tOne,',
  '};',
  'class UE_DEPRECATED_FORGAME(5.5, "Use another widget.") UWidgetGameOnly : public UObject',
  '{',
  '};',
  'class UE_INTERNAL FWidgetInternal : public UObject',
  '{',
  '};',
  'enum class UE_INTERNAL EWidgetInternalMode : uint8',
  '{',
  '	One,',
  '};',
  'struct MS_ALIGN(16) FWidgetAligned',
  '{',
  '};',
  'struct alignas(alignof(uint32)) FWidgetPacked',
  '{',
  '};',
  'class WIDGET_GUARD(!HasFlag(Flags, Mode::Fast) && (Count > (1 + 2))) TWidgetGuarded : public UObject',
  '{',
  '};',
  '',
].join('\n');

const FILES = {
  'Engine/Source/Runtime/Widgets/Public/AaaMacroForward.h': MACRO_FORWARD_H,
  'Engine/Source/Runtime/Widgets/Public/WidgetMacro.h': MACRO_H,
  'Engine/Source/Runtime/Widgets/Public/AaaKindsForward.h': KINDS_FORWARD_H,
  'Engine/Source/Runtime/Widgets/Public/WidgetKinds.h': KINDS_H,
  'Engine/Source/Runtime/Widgets/Public/WidgetDeprecated.h': DEPRECATED_H,
  'Engine/Source/Runtime/Widgets/Private/AaaDeprecatedUse.cpp': DEPRECATED_USE_CPP,
  'Engine/Source/Runtime/Widgets/Private/WidgetCvars.cpp': WIDGET_CVARS,
  'Engine/Source/Runtime/Widgets/Public/WidgetBase.h': BASE_H,
  'Engine/Plugins/Experimental/Gadget/Source/GadgetCore/Public/WidgetDerived.h': DERIVED_H,
  'Engine/Plugins/Experimental/Gadget/Source/GadgetCore/Private/WidgetDerived.cpp': DERIVED_CPP,
  'Engine/Source/Runtime/Widgets/Public/WidgetPtr.h': WIDGET_PTR_H,
  'Engine/Source/Runtime/Widgets/Private/AaaNoise.cpp': NOISE_CPP,
  'Engine/Source/Runtime/Widgets/Public/WidgetInline.h': 'class FWidgetInline\n{\npublic:\n\tFWidgetInline() {}\n};\n',
  // Folders named Documentation and Resources hold real source in an engine install, so they are searched.
  'Engine/Source/Editor/Documentation/Public/IWidgetDocs.h': 'class IWidgetDocs\n{\npublic:\n\tvirtual void Open() = 0;\n};\n',
  'Engine/Source/Editor/Documentation/Private/WidgetDocsTip.cpp': 'static TAutoConsoleVariable<float> CVarWidgetTipTime(TEXT("w.Docs.TipTime"), 0.5f, TEXT("Delay before the tip opens."), ECVF_Default);\n',
  'Engine/Source/Runtime/Launch/Resources/WidgetVersion.h': '#define WIDGET_MAJOR_VERSION 8\n',
  'Engine/Source/Runtime/Widgets/Private/ExtraCvars.cpp': EXTRA_CVARS,
  'Engine/Source/Runtime/Widgets/Public/WidgetCvars.h': 'extern int32 GWidgetExternal;\n',
  'Engine/Source/Runtime/Widgets/Public/WidgetSolver.h': SOLVER_H,
  'Engine/Source/Runtime/Widgets/Public/WidgetBrush.h': 'class WIDGETS_API UWidgetBrush : public UObject\n{\n};\n',
  'Engine/Source/Runtime/Widgets/Private/WidgetSolver.cpp': '#include "WidgetSolver.h"\nbool FWidgetSolver::WidgetSolve(int32 Count)\n{\n\treturn Count > 0;\n}\n',
  'Engine/Source/Runtime/Widgets/Private/AaaCaller.cpp': [
    'void Caller()', '{', '\tFWidgetSolver::WidgetSolve(3);', '\tconst bool bOk = FWidgetSolver::WidgetSolve(2);',
    '\tFWidgetSolver::WidgetSolveOp(1);', '\tRegisterNode("WidgetSolve", 1);', '\tUWidgetBrush* Brush = NewObject<UWidgetBrush>();', '}', '',
  ].join('\n'),
  'Engine/Source/Runtime/Widgets/Public/WidgetSpace.h': 'namespace WidgetSpace\n{\n\textern int32 GWidgetCount;\n}\n',
  'Engine/Source/Runtime/Widgets/Private/WidgetSpace.cpp': '#include "WidgetSpace.h"\nusing namespace WidgetSpace;\nint32 WidgetSpace::GWidgetCount = 0;\n',
  'Engine/Source/Runtime/Widgets/Widgets.Build.cs': 'public class Widgets : ModuleRules { }\n',
  'Engine/Plugins/Experimental/Gadget/Gadget.uplugin': '{ "FileVersion": 3, "Modules": [{ "Name": "GadgetCore", "Type": "Runtime" }] }\n',
  'Engine/Plugins/Experimental/Gadget/Source/GadgetCore/GadgetCore.Build.cs': 'public class GadgetCore : ModuleRules { }\n',
  // Outside the default roots: found only with --root.
  'Engine/Plugins/Compat/Bridge/Private/BridgeCvars.cpp': 'static TAutoConsoleVariable<int32> CVarBridgeMode(TEXT("w.Bridge.Mode"), 1, TEXT("Bridge mode."), ECVF_Default);\n',
  'Engine/Source/Developer/Tooling/Private/ToolingCvars.cpp': 'static TAutoConsoleVariable<int32> CVarToolingLevel(TEXT("w.Tooling.Level"), 4, TEXT("Tooling level."), ECVF_Default);\n',
};
// Generated or third-party copies that must be skipped, one per skipped folder name.
for (const skip of ['Intermediate', 'Binaries', 'ThirdParty', 'Saved', 'Content']) {
  FILES[`Engine/Source/Runtime/Widgets/${skip}/DupCvars.cpp`] = WIDGET_CVARS;
}

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), 'engine-source-'));
  for (const [rel, text] of Object.entries(FILES)) {
    const full = join(root, ...rel.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
});
after(() => rmSync(root, { recursive: true, force: true }));

const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
const find = (query, extra = {}) => run({ engine: root, query, ...extra });

test('a multi-line TAutoConsoleVariable gives its line span, anchor, type, default, joined flags and first help sentence', async () => {
  const r = await find('w.Widget.Blend');
  assert.equal(r.kind, 'cvar');
  assert.equal(r.results.length, 1, 'the lookup and the message string are not definitions');
  const [c] = r.results;
  assert.equal(c.path, 'Engine/Source/Runtime/Widgets/Private/WidgetCvars.cpp');
  assert.deepEqual([c.first, c.last], [lineOf(WIDGET_CVARS, 'CVarWidgetBlend('), lineOf(WIDGET_CVARS, ');')]);
  assert.deepEqual([c.anchor, c.type, c.default, c.flags], ['CVarWidgetBlend', 'int32', '2', 'ECVF_Scalability|ECVF_RenderThreadSafe']);
  assert.equal(c.help, 'How widgets blend.');
});

test('a FAutoConsoleVariableRef takes its default from a same-file initialiser, else says it is not resolved', async () => {
  const [limit] = (await find('w.Widget.Limit')).results;
  assert.deepEqual([limit.anchor, limit.type, limit.default, limit.flags], ['CVarWidgetLimit', 'int32', '8', 'ECVF_Default']);
  assert.equal(limit.first, limit.last, 'single-line Ref');
  const [ext] = (await find('w.Widget.External')).results;
  assert.equal(ext.default, 'ref GWidgetExternal, default not resolved');
});

test('single-line registrations, omitted flags and console commands are read; a wrapper call is listed as unparsed, not dropped', async () => {
  const [quick] = (await find('w.Widget.Quick')).results;
  assert.deepEqual([quick.first, quick.last, quick.anchor, quick.type, quick.default], [21, 21, 'CVarWidgetQuick', 'float', '1.5f']);
  const [noFlags] = (await find('w.Widget.NoFlags')).results;
  assert.equal(noFlags.flags, 'ECVF_Default (omitted)');
  const [dump] = (await find('w.Widget.Dump')).results;
  assert.deepEqual([dump.type, dump.help], ['command', 'Dump widgets.']);
  const [wrapped] = (await find('w.Widget.Wrapped')).results;
  assert.deepEqual([wrapped.unparsed, wrapped.first], [true, lineOf(WIDGET_CVARS, 'w.Widget.Wrapped')]);
});

test('CRLF files, string line continuations, qualified or macro-prefixed flags and flag names in help text are read correctly', async () => {
  const [wrapped] = (await find('w.Extra.Wrapped')).results;
  assert.deepEqual([wrapped.first, wrapped.last, wrapped.default, wrapped.help, wrapped.unparsed], [1, 5, '7', 'First sentence here.', undefined]);
  assert.equal((await find('w.Extra.HelpMentions')).results[0].flags, 'ECVF_Default (omitted)', 'a flag named in the help text is not a flag');
  assert.equal((await find('w.Extra.Qualified')).results[0].flags, 'EConsoleVariableFlags::ECVF_ReadOnly|ECVF_RenderThreadSafe');
});

test('a reader or an executor of a cvar is not listed as a registration, an unknown console type is listed as unparsed', async () => {
  assert.equal((await find('w.Extra.Reader')).found, false);
  assert.equal((await find('w.Extra.Exec')).found, false);
  const [task] = (await find('w.Extra.Task')).results;
  assert.deepEqual([task.unparsed, task.form], [true, 'FAutoConsoleTaskPriority']);
});

test('a name only inside a comment or a longer message string is a miss, and the miss lists the roots and names --root', async () => {
  const r = await find('w.Widget.Ghost');
  assert.deepEqual(r.results, []);
  assert.equal(r.found, false);
  for (const root_ of DEFAULT_ROOTS) assert.ok(r.miss.includes(root_), root_);
  assert.match(r.miss, /--root/);
});

test('generated and third-party folders are skipped, whatever their depth, and the miss message names them', async () => {
  const r = await find('w.Widget.Blend');
  assert.ok(r.results.every((c) => !/\/(Intermediate|Binaries|ThirdParty|Saved|Content)\//.test(c.path)));
  const files = await find('DupCvars.cpp', { kind: 'file' });
  assert.deepEqual(files.results, []);
  assert.deepEqual([...SKIP_DIRS].sort(), ['Binaries', 'Content', 'Intermediate', 'Saved', 'ThirdParty']);
  for (const name of SKIP_DIRS) assert.ok(files.miss.includes(name), `the miss message names the skipped folder ${name}`);
  const inside = await find('DupCvars.cpp', { kind: 'file', roots: ['Engine/Source/Runtime/Widgets/Intermediate'] });
  assert.deepEqual(inside.results.map((f) => f.path), ['Engine/Source/Runtime/Widgets/Intermediate/DupCvars.cpp'], 'a --root that names a skipped folder searches inside it');
});

test('folders named Documentation and Resources are searched, because they hold real engine source', async () => {
  const tip = await find('w.Docs.TipTime');
  assert.equal(tip.results[0].path, 'Engine/Source/Editor/Documentation/Private/WidgetDocsTip.cpp');
  assert.equal(tip.results[0].default, '0.5f');
  const docs = await find('IWidgetDocs');
  assert.deepEqual(docs.results.map((h) => [h.rank, h.path]), [['declaration', 'Engine/Source/Editor/Documentation/Public/IWidgetDocs.h']]);
  const version = await find('WIDGET_MAJOR_VERSION');
  assert.deepEqual(version.results.map((h) => [h.rank, h.path, h.line]), [['declaration', 'Engine/Source/Runtime/Launch/Resources/WidgetVersion.h', 1]]);
  assert.deepEqual((await find('WidgetVersion.h')).results.map((f) => f.path), ['Engine/Source/Runtime/Launch/Resources/WidgetVersion.h']);
});

test('a trailing * lists every cvar with that prefix, sorted by name; a wrong-case query retries case-insensitively and says so', async () => {
  const r = await find('w.Widget.*');
  assert.deepEqual(r.results.map((c) => c.name), ['w.Widget.Blend', 'w.Widget.Dump', 'w.Widget.External', 'w.Widget.Limit', 'w.Widget.NoFlags', 'w.Widget.Quick', 'w.Widget.Wrapped']);
  const ci = await find('W.WIDGET.BLEND');
  assert.equal(ci.results.length, 1);
  assert.equal(ci.results[0].name, 'w.Widget.Blend');
  assert.ok(ci.notes.some((n) => /case-insensitive/.test(n)), ci.notes.join('\n'));
  assert.ok(!(await find('w.Widget.Blend')).notes.some((n) => /case-insensitive/.test(n)), 'exact case needs no retry');
});

test('a symbol ranks declaration, definition, code uses, then string-literal mentions, and skips longer identifiers and comments', async () => {
  const r = await find('WidgetSolve');
  assert.equal(r.kind, 'symbol');
  assert.deepEqual(r.results.map((h) => [h.rank, !!h.string, h.path.split('/').pop(), h.line]), [
    ['declaration', false, 'WidgetSolver.h', 8],
    ['definition', false, 'WidgetSolver.cpp', 2],
    ['use', false, 'AaaCaller.cpp', 3],
    ['use', false, 'AaaCaller.cpp', 4],
    ['use', true, 'AaaCaller.cpp', 6],
  ]);
  const capped = await find('WidgetSolve', { max: 2 });
  assert.equal(capped.results.length, 2);
  assert.equal(capped.more, 3);
});

test('a class named in a base list, a friend declaration or a constructor initialiser list is a use, so the declaration stays first under a cap', async () => {
  const r = await find('UWidgetBase', { max: 100 });
  const derived = r.results.filter((h) => /WidgetDerived\.(h|cpp)$/.test(h.path));
  const declarations = r.results.filter((h) => h.rank === 'declaration' && !h.forward);
  assert.deepEqual(declarations.map((h) => [h.path.split('/').pop(), h.line]), [['WidgetBase.h', lineOf(BASE_H, 'WIDGETS_API UWidgetBase')]]);
  assert.equal(r.results.filter((h) => h.rank === 'declaration' && h.forward).length, 1, 'the forward declaration stays a forward declaration');
  assert.equal(r.results.filter((h) => h.rank === 'definition').length, 0);
  // Brace on the next line and on the same line, a multi-line base list, a struct base, two bases, a virtual base, a template
  // argument, both friend forms, a constructor initialiser after a colon on the same line, after a colon that ends the constructor
  // line and after a comma that ends the previous initialiser, and a case label.
  const wanted = [
    ...['UWidgetDerivedA : public', 'UWidgetDerivedB : public', '\t: public UWidgetBase', 'FWidgetTag : UWidgetBase', 'UWidgetDerivedD',
      'UWidgetDerivedE', 'TWidgetOf<UWidgetBase>', 'friend UWidgetBase;', 'friend class UWidgetBase;'].map((n) => ['WidgetDerived.h', lineOf(DERIVED_H, n), n]),
    ...[': UWidgetBase(1)', 'case 1: UWidgetBase(2)', '\tUWidgetBase(3)', '\tUWidgetBase(4)'].map((n) => ['WidgetDerived.cpp', lineOf(DERIVED_CPP, n), n]),
  ];
  assert.equal(derived.length, wanted.length);
  for (const [file, line, needle] of wanted) {
    const hit = derived.find((h) => h.path.endsWith(file) && h.line === line);
    assert.equal(hit?.rank, 'use', needle);
  }
  const first = await find('UWidgetBase', { max: 1 });
  assert.deepEqual(first.results.map((h) => [h.rank, h.path.split('/').pop(), h.forward]), [['declaration', 'WidgetBase.h', false]], 'the real declaration is the one shown under --max 1');
  assert.equal(first.more, r.results.length - 1);
});

test('an elaborated type, an explicit instantiation or a stream operand is a use, so only the real declarations are ranked declarations', async () => {
  const ptr = await find('TWidgetPtr', { max: 100 });
  assert.deepEqual(ptr.results.filter((h) => h.rank === 'declaration').map((h) => [h.path.split('/').pop(), h.line]), [
    ['WidgetPtr.h', lineOf(WIDGET_PTR_H, 'WIDGETS_API TWidgetPtr')], ['WidgetPtr.h', lineOf(WIDGET_PTR_H, 'TWidgetPtr<T*>')]]);
  assert.equal(ptr.results.length, 2 + 5, 'every noise line is listed, as a use');
  const text = await find('FWidgetText', { max: 100 });
  assert.deepEqual(text.results.map((h) => [h.rank, h.path.split('/').pop()]), [['declaration', 'WidgetPtr.h'], ['use', 'AaaNoise.cpp'], ['use', 'AaaNoise.cpp']]);
  const table = await find('BuildTable', { max: 100 });
  assert.deepEqual(table.results.map((h) => [h.rank, h.path.split('/').pop()]), [['declaration', 'WidgetPtr.h'], ['use', 'AaaNoise.cpp']], 'a nested template return type is still a declaration');
  assert.deepEqual((await find('FWidgetTable')).results.map((h) => [h.rank, h.line]), [['declaration', lineOf(WIDGET_PTR_H, '> FWidgetTable;')]], 'a type whose argument list ends on the name\'s own line is still a declaration');
  const inline = await find('FWidgetInline');
  assert.deepEqual(inline.results.map((h) => [h.rank, h.line]), [['declaration', 1], ['definition', 4]], 'an inline constructor after an access specifier is a definition');
});

test('a class symbol lists its real declaration before a forward declaration, then one line per use', async () => {
  const r = await find('UWidgetBrush');
  assert.deepEqual(r.results.map((h) => [h.rank, h.path.split('/').pop(), !!h.forward]), [
    ['declaration', 'WidgetBrush.h', false],
    ['declaration', 'WidgetSolver.h', true],
    ['use', 'AaaCaller.cpp', false],
  ]);
});

test('an opaque enum declaration (`enum E : T;`) is a forward declaration, so the real enum is listed first', async () => {
  const shape = (r) => r.results.map((h) => [h.rank, h.path.split('/').pop(), !!h.forward]);
  assert.deepEqual(shape(await find('EWidgetKind', { max: 1 })), [['declaration', 'WidgetKinds.h', false]], 'the real enum is the one shown under --max 1');
  assert.deepEqual(shape(await find('EWidgetKind')), [['declaration', 'WidgetKinds.h', false], ['declaration', 'AaaKindsForward.h', true]]);
  assert.deepEqual(shape(await find('EWidgetMode')), [['declaration', 'WidgetKinds.h', false], ['declaration', 'AaaKindsForward.h', true]]);
  assert.deepEqual(shape(await find('EWidgetWide')), [['declaration', 'WidgetKinds.h', false], ['declaration', 'AaaKindsForward.h', true]], 'an underlying type on the next line');
});

test('a deprecation macro between class, struct or enum and the name does not stop the declaration ranking as one', async () => {
  const shape = (r) => r.results.map((h) => [h.rank, h.path.split('/').pop(), !!h.forward]);
  for (const name of ['FWidgetOld', 'UWidgetOld', 'FWidgetLegacy']) {
    assert.deepEqual(shape(await find(name, { max: 1 })), [['declaration', 'WidgetDeprecated.h', false]], name);
  }
  assert.deepEqual(shape(await find('EWidgetRetired')), [['declaration', 'WidgetDeprecated.h', false], ['declaration', 'AaaKindsForward.h', true], ['use', 'AaaDeprecatedUse.cpp', false]]);
  assert.deepEqual(shape(await find('FWidgetGone')), [['declaration', 'AaaKindsForward.h', true], ['use', 'AaaDeprecatedUse.cpp', false]], 'a deprecated forward declaration stays forward');
});

test('any ALL_CAPS macro word or call, alignas or __declspec between class, struct or enum and the name, however its arguments nest, leaves a declaration a declaration', async () => {
  const shape = (r) => r.results.map((h) => [h.rank, h.path.split('/').pop(), !!h.forward]);
  for (const name of ['FWidgetPreview', 'FWidgetPreviewData', 'EWidgetPreviewMode', 'UWidgetGameOnly', 'FWidgetInternal', 'EWidgetInternalMode']) {
    assert.deepEqual(shape(await find(name)), [['declaration', 'WidgetMacro.h', false], ['declaration', 'AaaMacroForward.h', true]], name);
  }
  for (const name of ['FWidgetAligned', 'FWidgetPacked', 'TWidgetGuarded']) assert.deepEqual(shape(await find(name)), [['declaration', 'WidgetMacro.h', false]], name);
});

test('a namespace, a using directive, an extern variable and its definition are ranked, and an include of a same-named header is not a hit', async () => {
  const space = await find('WidgetSpace');
  assert.deepEqual(space.results.map((h) => [h.rank, h.path.split('/').pop(), h.line, !!h.string]), [
    ['declaration', 'WidgetSpace.h', 1, false],
    ['use', 'WidgetSpace.cpp', 2, false],
    ['use', 'WidgetSpace.cpp', 3, false],
  ]);
  const count = await find('GWidgetCount');
  assert.deepEqual(count.results.map((h) => [h.rank, h.path.split('/').pop(), h.line]), [['declaration', 'WidgetSpace.h', 3], ['definition', 'WidgetSpace.cpp', 3]]);
});

test('a module query that names a plugin says so and lists the plugin modules', async () => {
  const r = await find('Gadget', { kind: 'module' });
  assert.equal(r.found, false);
  assert.ok(r.notes.some((n) => /plugin/.test(n) && n.includes('Engine/Plugins/Experimental/Gadget/Gadget.uplugin') && n.includes('GadgetCore')), r.notes.join('\n'));
});

test('a module resolves to its Build.cs and nearest ancestor .uplugin even when the folder is named differently; an engine module says so', async () => {
  const gadget = await find('GadgetCore');
  assert.equal(gadget.kind, 'module');
  assert.deepEqual(gadget.results.map((m) => [m.build, m.plugin, m.pluginName]), [[
    'Engine/Plugins/Experimental/Gadget/Source/GadgetCore/GadgetCore.Build.cs', 'Engine/Plugins/Experimental/Gadget/Gadget.uplugin', 'Gadget']]);
  const widgets = await find('Widgets');
  assert.equal(widgets.kind, 'module');
  assert.deepEqual(widgets.results.map((m) => [m.build, m.plugin]), [['Engine/Source/Runtime/Widgets/Widgets.Build.cs', null]]);
});

test('a folder outside the default roots is searched only with --root, given with or without the Engine prefix', async () => {
  assert.equal((await find('w.Bridge.Mode')).found, false);
  assert.equal((await find('w.Tooling.Level')).found, false);
  for (const folder of ['Engine/Plugins/Compat', 'Plugins/Compat']) {
    const r = await find('w.Bridge.Mode', { roots: [folder] });
    assert.equal(r.results[0].path, 'Engine/Plugins/Compat/Bridge/Private/BridgeCvars.cpp');
  }
  assert.equal((await find('w.Tooling.Level', { roots: ['Engine/Source/Developer'] })).found, true);
  await assert.rejects(find('w.Bridge.Mode', { roots: ['Engine/../..'] }), UsageError);
  await assert.rejects(find('w.Bridge.Mode', { roots: ['Engine/Plugins/DoesNotExist'] }), UsageError);
});

test('auto kind picks file for a name with a source extension, cvar for a dotted name, module for a Build.cs name, else symbol', async () => {
  assert.equal(classifyQuery('MegaLights.cpp', { isModule: false }), 'file');
  assert.equal(classifyQuery('GadgetCore.Build.cs', { isModule: false }), 'file');
  assert.equal(classifyQuery('r.MegaLights.Allowed', { isModule: false }), 'cvar');
  assert.equal(classifyQuery('r.MegaLights.*', { isModule: false }), 'cvar');
  assert.equal(classifyQuery('Widgets', { isModule: true }), 'module');
  assert.equal(classifyQuery('WidgetSolve', { isModule: false }), 'symbol');
  assert.equal(classifyQuery('WidgetSolve', { isModule: false, kind: 'file' }), 'file');
  const file = await find('WidgetSolver.h');
  assert.deepEqual([file.kind, file.results.map((f) => f.path)], ['file', ['Engine/Source/Runtime/Widgets/Public/WidgetSolver.h']]);
});

test('the masking, matching and splitting helpers honour comments, strings and nesting', () => {
  const text = 'F(TEXT("a, (b"), G(1, 2), /* , ) */ x) // tail (\n';
  const masked = maskCode(text);
  assert.equal(masked.length, text.length);
  assert.ok(!masked.includes('a, (b') && !masked.includes('tail'));
  assert.equal(masked.indexOf('\n'), text.indexOf('\n'));
  const open = text.indexOf('(');
  const close = matchClose(masked, open);
  assert.equal(text[close], ')');
  assert.deepEqual(splitArgs(masked, text, open, close), ['TEXT("a, (b")', 'G(1, 2)', '/* , ) */ x']);
  assert.equal(matchClose(maskCode('F(1, (2'), 1), -1);
});

test('the content scan keeps at least 16 reads in flight and reads only what it is given', async () => {
  let inFlight = 0, peak = 0;
  const read = async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return Buffer.from('x'); };
  const files = Array.from({ length: 80 }, (_, i) => `Engine/Source/Runtime/F${i}.cpp`);
  const out = await scanContent(files, { engineDir: root, read, visit: (buf, rel) => rel });
  assert.ok(peak >= 16, `peak ${peak}`);
  assert.equal(out.results.length, 80);
  assert.equal(out.bytes, 80);
});

test('the command line prints install-relative forward-slash paths only, results on stdout and the summary on stderr', () => {
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, '--engine', root, ...args], { encoding: 'utf8' });
  const found = cli('w.Widget.Blend');
  assert.equal(found.status, 0);
  const lines = found.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Engine\/Source\/Runtime\/Widgets\/Private\/WidgetCvars\.cpp:5-13 \| w\.Widget\.Blend \| CVarWidgetBlend \| int32 \| default 2 \| flags ECVF_Scalability\|ECVF_RenderThreadSafe \| How widgets blend\.$/);
  assert.match(found.stderr, /walked \d+ files/);
  const abs = [root, root.split('\\').join('/')];
  for (const out of [found.stdout, found.stderr, cli('WidgetSolve').stdout, cli('GadgetCore').stdout, cli('w.Nothing').stderr]) {
    for (const a of abs) assert.ok(!out.includes(a), 'no absolute path in output');
    assert.ok(!/[A-Za-z]:[\\/]/.test(out), 'no drive path in output');
  }
  const json = JSON.parse(cli('w.Widget.Limit', '--json').stdout);
  assert.deepEqual([json.kind, json.found, json.results[0].default], ['cvar', true, '8']);
  assert.equal(cli('w.Nothing.Here').status, 1);
  assert.match(cli('w.Nothing.Here').stderr, /--root/);
});

test('the command line exits 2 on bad usage', () => {
  const run2 = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }).status;
  assert.equal(run2('--engine', root), 2, 'no query');
  assert.equal(run2('w.Widget.Blend'), 2, 'no --engine');
  assert.equal(run2('--engine', root, '--kind', 'bogus', 'x'), 2);
  assert.equal(run2('--engine', join(root, 'Engine', 'Source'), 'x'), 2, 'not an install folder');
  assert.equal(run2('--engine', root, '--max', 'many', 'x'), 2);
  assert.equal(run2('--engine', root, '--root', 'Engine/../..', 'x'), 2);
});
