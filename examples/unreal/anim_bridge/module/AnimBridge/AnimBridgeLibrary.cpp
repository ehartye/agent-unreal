#include "AnimBridgeLibrary.h"

#include "AnimGraphNode_Root.h"
#include "AnimGraphNode_Slot.h"
#include "AnimStateNode.h"
#include "AnimStateEntryNode.h"
#include "AnimationGraph.h"
#include "AnimationStateMachineGraph.h"
#include "AnimationStateMachineSchema.h"
#include "AnimationGraphSchema.h"
#include "Animation/AnimBlueprint.h"
#include "Animation/BlendSpace.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/CompilerResultsLog.h"
#include "Kismet2/KismetEditorUtilities.h"

DEFINE_LOG_CATEGORY_STATIC(LogAnimBridge, Log, All);

namespace
{
	UAnimationGraph* FindAnimGraph(UAnimBlueprint* AnimBlueprint)
	{
		if (AnimBlueprint)
		{
			for (UEdGraph* Graph : AnimBlueprint->FunctionGraphs)
			{
				if (UAnimationGraph* AnimGraph = Cast<UAnimationGraph>(Graph))
				{
					return AnimGraph;
				}
			}
		}
		return nullptr;
	}

	UEdGraphPin* FindPosePin(UEdGraphNode* Node, EEdGraphPinDirection Direction)
	{
		for (UEdGraphPin* Pin : Node->Pins)
		{
			if (Pin->Direction == Direction && UAnimationGraphSchema::IsPosePin(Pin->PinType))
			{
				return Pin;
			}
		}
		return nullptr;
	}
}

FSlotBridgeResult UAnimBridgeLibrary::AddSlotToAnimBlueprint(UAnimBlueprint* AnimBlueprint, FName SlotName)
{
	FSlotBridgeResult Result;
	UAnimationGraph* AnimGraph = FindAnimGraph(AnimBlueprint);
	if (!AnimGraph)
	{
		UE_LOG(LogAnimBridge, Error, TEXT("AddSlotToAnimBlueprint: the Blueprint has no AnimGraph"));
		return Result;
	}

	UAnimGraphNode_Root* Root = nullptr;
	for (UEdGraphNode* Node : AnimGraph->Nodes)
	{
		if ((Root = Cast<UAnimGraphNode_Root>(Node)) != nullptr)
		{
			break;
		}
	}
	if (!Root)
	{
		UE_LOG(LogAnimBridge, Error, TEXT("AddSlotToAnimBlueprint: the AnimGraph has no Root node"));
		return Result;
	}

	// The node creator calls CreateNewGuid, PostPlacedNewNode and AllocateDefaultPins (Runtime/Engine/Classes/EdGraph/EdGraph.h).
	FGraphNodeCreator<UAnimGraphNode_Slot> Creator(*AnimGraph);
	UAnimGraphNode_Slot* Slot = Creator.CreateNode();
	Slot->Node.SlotName = SlotName;
	Slot->NodePosX = Root->NodePosX - 320;
	Slot->NodePosY = Root->NodePosY;
	Creator.Finalize();

	UEdGraphPin* SlotOut = FindPosePin(Slot, EGPD_Output);
	UEdGraphPin* RootIn = FindPosePin(Root, EGPD_Input);
	if (SlotOut && RootIn)
	{
		AnimGraph->GetSchema()->TryCreateConnection(SlotOut, RootIn);
		Result.bSlotLinkedToRoot = SlotOut->LinkedTo.Contains(RootIn);
	}

	FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(AnimBlueprint);
	FCompilerResultsLog Log;
	FKismetEditorUtilities::CompileBlueprint(AnimBlueprint, EBlueprintCompileOptions::None, &Log);
	Result.NumErrors = Log.NumErrors;
	Result.NumWarnings = Log.NumWarnings;
	Result.BlueprintStatus = static_cast<int32>(AnimBlueprint->Status);
	Result.bCompiled = AnimBlueprint->Status == BS_UpToDate || AnimBlueprint->Status == BS_UpToDateWithWarnings;
	for (const TSharedRef<FTokenizedMessage>& Message : Log.Messages)
	{
		Result.Messages.Add(Message->ToText().ToString());
	}
	return Result;
}

UAnimStateNode* UAnimBridgeLibrary::AddState(UEdGraph* StateMachineGraph, FName StateName, FVector2D Location)
{
	UAnimationStateMachineGraph* Graph = Cast<UAnimationStateMachineGraph>(StateMachineGraph);
	if (!Graph)
	{
		UE_LOG(LogAnimBridge, Error, TEXT("AddState: not a state machine graph"));
		return nullptr;
	}
	bool bFirstState = true;
	for (UEdGraphNode* Node : Graph->Nodes)
	{
		bFirstState &= !Node->IsA<UAnimStateNode>();
	}

	// The action the state machine editor runs for "Add State" (declared in AnimationStateMachineSchema.h).
	UAnimStateNode* State = FEdGraphSchemaAction_NewStateNode::SpawnNodeFromTemplate<UAnimStateNode>(Graph, NewObject<UAnimStateNode>(Graph), FVector2f(Location), false);
	if (!State)
	{
		return nullptr;
	}
	FBlueprintEditorUtils::RenameGraph(State->BoundGraph, StateName.ToString());
	if (bFirstState && Graph->EntryNode)
	{
		for (UEdGraphPin* Pin : Graph->EntryNode->Pins)
		{
			if (Pin->Direction == EGPD_Output)
			{
				Graph->GetSchema()->TryCreateConnection(Pin, State->GetInputPin());
				break;
			}
		}
	}
	return State;
}

bool UAnimBridgeLibrary::AddTransition(UAnimStateNode* FromState, UAnimStateNode* ToState)
{
	if (!FromState || !ToState || FromState->GetGraph() != ToState->GetGraph())
	{
		return false;
	}
	const UAnimationStateMachineSchema* Schema = GetDefault<UAnimationStateMachineSchema>();
	return Schema->CreateAutomaticConversionNodeAndConnections(FromState->GetOutputPin(), ToState->GetInputPin());
}

bool UAnimBridgeLibrary::ResampleBlendSpace(UBlendSpace* BlendSpace)
{
	if (!BlendSpace)
	{
		return false;
	}
	BlendSpace->Modify();
	BlendSpace->ValidateSampleData();
	BlendSpace->ResampleData();
	BlendSpace->MarkPackageDirty();
	return true;
}

TArray<FString> UAnimBridgeLibrary::DescribeAnimGraph(UAnimBlueprint* AnimBlueprint)
{
	TArray<FString> Lines;
	if (!AnimBlueprint)
	{
		return Lines;
	}
	TArray<UEdGraph*> Graphs;
	AnimBlueprint->GetAllGraphs(Graphs);
	for (UEdGraph* Graph : Graphs)
	{
		for (UEdGraphNode* Node : Graph->Nodes)
		{
			Lines.Add(FString::Printf(TEXT("node %s | %s | %s"), *Graph->GetName(), *Node->GetClass()->GetName(), *Node->GetNodeTitle(ENodeTitleType::ListView).ToString()));
			if (const UAnimGraphNode_Slot* Slot = Cast<UAnimGraphNode_Slot>(Node))
			{
				Lines.Add(FString::Printf(TEXT("slot %s"), *Slot->Node.SlotName.ToString()));
			}
			for (const UEdGraphPin* Pin : Node->Pins)
			{
				if (Pin->Direction == EGPD_Output)
				{
					for (const UEdGraphPin* Other : Pin->LinkedTo)
					{
						Lines.Add(FString::Printf(TEXT("link %s | %s.%s -> %s.%s"), *Graph->GetName(), *Node->GetClass()->GetName(), *Pin->PinName.ToString(), *Other->GetOwningNode()->GetClass()->GetName(), *Other->PinName.ToString()));
					}
				}
			}
		}
	}
	return Lines;
}
