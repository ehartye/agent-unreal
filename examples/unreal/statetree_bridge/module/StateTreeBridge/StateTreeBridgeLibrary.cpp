#include "StateTreeBridgeLibrary.h"

#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "Components/StateTreeAIComponentSchema.h"
#include "Components/StateTreeComponentSchema.h"
#include "Logging/TokenizedMessage.h"
#include "PropertyBindingPath.h"
#include "StateTree.h"
#include "StateTreeCompilerLog.h"
#include "StateTreeEditingSubsystem.h"
#include "StateTreeEditorData.h"
#include "StateTreeExecutionTypes.h"
#include "StateTreeFactory.h"
#include "StateTreeProbeNodes.h"
#include "StateTreeSchema.h"
#include "StateTreeState.h"
#include "StructUtils/PropertyBag.h"

DEFINE_LOG_CATEGORY_STATIC(LogStateTreeBridge, Log, All);

namespace
{
	/** Creates the asset with the given schema class. The factory needs the schema before FactoryCreateNew; without one it returns null. */
	UStateTree* MakeTree(const FString& PackagePath, const FString& AssetName, UClass* SchemaClass)
	{
		UStateTreeFactory* Factory = NewObject<UStateTreeFactory>();
		Factory->SetSchemaClass(SchemaClass);

		IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
		UStateTree* Tree = Cast<UStateTree>(AssetTools.CreateAsset(AssetName, PackagePath, UStateTree::StaticClass(), Factory));
		UStateTreeEditorData* Data = Tree ? Cast<UStateTreeEditorData>(Tree->EditorData) : nullptr;
		if (!Data || Data->SubTrees.IsEmpty())
		{
			UE_LOG(LogStateTreeBridge, Error, TEXT("No tree or no root state for %s/%s"), *PackagePath, *AssetName);
			return nullptr;
		}
		return Tree;
	}
}

UStateTree* UStateTreeBridgeLibrary::CreateTree(const FString& PackagePath, const FString& AssetName, int32 MinTicks, bool bBroken, bool bComponentSchema)
{
	// Both schemas offer an "Actor" context object that an Actor-typed Context property binds to: the controlled pawn under the AI
	// component schema, the component's owner (the pawn itself) under the component schema.
	UClass* SchemaClass = bComponentSchema ? UStateTreeComponentSchema::StaticClass() : UStateTreeAIComponentSchema::StaticClass();
	UStateTree* Tree = MakeTree(PackagePath, AssetName, SchemaClass);
	if (!Tree)
	{
		return nullptr;
	}
	UStateTreeEditorData* Data = Cast<UStateTreeEditorData>(Tree->EditorData);

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

UStateTree* UStateTreeBridgeLibrary::CreateParameterTree(const FString& PackagePath, const FString& AssetName, int32 Threshold)
{
	UStateTree* Tree = MakeTree(PackagePath, AssetName, UStateTreeAIComponentSchema::StaticClass());
	if (!Tree)
	{
		return nullptr;
	}
	UStateTreeEditorData* Data = Cast<UStateTreeEditorData>(Tree->EditorData);

	// The root parameter bag has no mutable accessor; the engine's own tests add to it through a const_cast.
	FInstancedPropertyBag& Bag = const_cast<FInstancedPropertyBag&>(Data->GetRootParametersPropertyBag());
	Bag.AddProperty(TEXT("Threshold"), EPropertyBagPropertyType::Int32);
	Bag.SetValueInt32(TEXT("Threshold"), Threshold);

	UStateTreeState& Root = *Data->SubTrees[0];
	UStateTreeState& Work = Root.AddChildState(TEXT("Work"));
	UStateTreeState& Done = Root.AddChildState(TEXT("Done"));
	Work.AddTask<FProbeWorkTask>().GetInstanceData().Label = TEXT("Work");
	TStateTreeEditorNode<FProbeWorkTask>& DoneTask = Done.AddTask<FProbeWorkTask>();
	DoneTask.GetInstanceData().Label = TEXT("Done");
	DoneTask.GetInstanceData().bCountTicks = false;

	// The condition's own MinTicks stays at a value the pawn cannot reach; the binding from the root parameter is what lets it pass.
	FStateTreeTransition& ToDone = Work.AddTransition(EStateTreeTransitionTrigger::OnTick, EStateTreeTransitionType::GotoState, &Done);
	TStateTreeEditorNode<FProbeCounterCondition>& Condition = ToDone.AddConditionWithOuter<FProbeCounterCondition>(&Work);
	Condition.GetInstanceData().MinTicks = 1000000;
	Data->AddPropertyBinding(FPropertyBindingPath(Data->GetRootParametersGuid(), TEXT("Threshold")), FPropertyBindingPath(Condition.ID, TEXT("MinTicks")));
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

FStateTreeBridgeTreeInfo UStateTreeBridgeLibrary::DescribeTree(UStateTree* Tree)
{
	FStateTreeBridgeTreeInfo Info;
	UStateTreeEditorData* Data = Tree ? Cast<UStateTreeEditorData>(Tree->EditorData) : nullptr;
	const UStateTreeSchema* Schema = Data ? Data->Schema.Get() : nullptr;
	if (!Schema)
	{
		return Info;
	}
	Info.SchemaClass = Schema->GetClass()->GetName();
	for (const FStateTreeExternalDataDesc& Desc : Schema->GetContextDataDescs())
	{
		Info.ContextObjects.Add(FString::Printf(TEXT("%s:%s"), *Desc.Name.ToString(), Desc.Struct ? *Desc.Struct->GetName() : TEXT("None")));
	}
	// The AI task base is not exported from its module, so it is looked up by path rather than named.
	const UScriptStruct* AITaskBase = FindObject<UScriptStruct>(nullptr, TEXT("/Script/GameplayStateTreeModule.StateTreeAITaskBase"));
	Info.bAllowsAiTaskBase = AITaskBase && Schema->IsStructAllowed(AITaskBase);
	Info.bAllowsProbeTask = Schema->IsStructAllowed(FProbeWorkTask::StaticStruct());
	Info.bAllowsEvaluators = Schema->AllowEvaluators();
	Info.bAllowsGlobalParameters = Schema->AllowGlobalParameters();

	const FInstancedPropertyBag& Bag = Data->GetRootParametersPropertyBag();
	if (const UPropertyBag* BagStruct = Bag.GetPropertyBagStruct())
	{
		for (const FPropertyBagPropertyDesc& Desc : BagStruct->GetPropertyDescs())
		{
			FString Value;
			if (Desc.ValueType == EPropertyBagPropertyType::Int32)
			{
				const TValueOrError<int32, EPropertyBagResult> Read = Bag.GetValueInt32(Desc.Name);
				if (Read.HasValue())
				{
					Value = FString::FromInt(Read.GetValue());
				}
			}
			Info.RootParameters.Add(FString::Printf(TEXT("%s:%s=%s"), *Desc.Name.ToString(), *UEnum::GetValueAsString(Desc.ValueType), *Value));
		}
	}
	return Info;
}

bool UStateTreeBridgeLibrary::IsReadyToRun(const UStateTree* Tree)
{
	return Tree && Tree->IsReadyToRun();
}

bool UStateTreeBridgeLibrary::NeedsRecompile(const UStateTree* Tree)
{
	return Tree && UStateTreeEditingSubsystem::NeedsRecompile(Tree);
}
