#include "StateTreeBridgeLibrary.h"

#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "Components/StateTreeAIComponentSchema.h"
#include "Logging/TokenizedMessage.h"
#include "StateTree.h"
#include "StateTreeCompilerLog.h"
#include "StateTreeEditingSubsystem.h"
#include "StateTreeEditorData.h"
#include "StateTreeFactory.h"
#include "StateTreeProbeNodes.h"
#include "StateTreeState.h"

DEFINE_LOG_CATEGORY_STATIC(LogStateTreeBridge, Log, All);

UStateTree* UStateTreeBridgeLibrary::CreateTree(const FString& PackagePath, const FString& AssetName, int32 MinTicks, bool bBroken)
{
	// The factory needs its schema before FactoryCreateNew; without one it returns null. It then adds the "Root" state and compiles once.
	UStateTreeFactory* Factory = NewObject<UStateTreeFactory>();
	Factory->SetSchemaClass(UStateTreeAIComponentSchema::StaticClass());

	IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
	UStateTree* Tree = Cast<UStateTree>(AssetTools.CreateAsset(AssetName, PackagePath, UStateTree::StaticClass(), Factory));
	UStateTreeEditorData* Data = Tree ? Cast<UStateTreeEditorData>(Tree->EditorData) : nullptr;
	if (!Data || Data->SubTrees.IsEmpty())
	{
		UE_LOG(LogStateTreeBridge, Error, TEXT("No tree or no root state for %s/%s"), *PackagePath, *AssetName);
		return nullptr;
	}

	UStateTreeState& Root = *Data->SubTrees[0];
	UStateTreeState& Work = Root.AddChildState(TEXT("Work"));
	UStateTreeState& Done = Root.AddChildState(TEXT("Done"));

	// Tasks: AddTask<T>() returns the editor node, GetInstanceData() the struct that holds the task's properties.
	Work.AddTask<FProbeWorkTask>().GetInstanceData().Label = TEXT("Work");
	TStateTreeEditorNode<FProbeWorkTask>& DoneTask = Done.AddTask<FProbeWorkTask>();
	DoneTask.GetInstanceData().Label = TEXT("Done");
	DoneTask.GetInstanceData().bCountTicks = false;
	if (bBroken)
	{
		Work.AddTask<FProbeNeedsComponentTask>();
	}

	// Enter condition on Done, and a transition on tick from Work to Done with the same condition. The transition's condition takes the
	// owning state as its outer (AddConditionWithOuter); AddCondition is deprecated in 5.8.
	Done.AddEnterCondition<FProbeCounterCondition>().GetInstanceData().MinTicks = MinTicks;
	FStateTreeTransition& ToDone = Work.AddTransition(EStateTreeTransitionTrigger::OnTick, EStateTreeTransitionType::GotoState, &Done);
	ToDone.AddConditionWithOuter<FProbeCounterCondition>(&Work).GetInstanceData().MinTicks = MinTicks;
	return Tree;
}

FStateTreeBridgeCompileResult UStateTreeBridgeLibrary::CompileTree(UStateTree* Tree)
{
	FStateTreeBridgeCompileResult Result;
	if (!Tree)
	{
		return Result;
	}
	FStateTreeCompilerLog Log;
	Result.bCompiled = UStateTreeEditingSubsystem::CompileStateTree(Tree, Log);
	for (const TSharedRef<FTokenizedMessage>& Message : Log.ToTokenizedMessages())
	{
		const TCHAR* Severity = Message->GetSeverity() == EMessageSeverity::Error ? TEXT("Error") : Message->GetSeverity() == EMessageSeverity::Warning ? TEXT("Warning") : TEXT("Info");
		Result.Messages.Add(FString::Printf(TEXT("%s: %s"), Severity, *Message->ToText().ToString()));
	}
	Log.DumpToLog(Tree, LogStateTreeBridge);
	return Result;
}

bool UStateTreeBridgeLibrary::IsReadyToRun(const UStateTree* Tree)
{
	return Tree && Tree->IsReadyToRun();
}

bool UStateTreeBridgeLibrary::NeedsRecompile(const UStateTree* Tree)
{
	return Tree && UStateTreeEditingSubsystem::NeedsRecompile(Tree);
}
