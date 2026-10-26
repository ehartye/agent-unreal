#include "AnimMachineBridgeLibrary.h"

#include "AnimGraphNode_Base.h"
#include "AnimGraphNode_LinkedAnimLayer.h"
#include "AnimGraphNode_SequencePlayer.h"
#include "AnimGraphNode_TransitionResult.h"
#include "AnimStateNode.h"
#include "AnimStateTransitionNode.h"
#include "AnimationGraph.h"
#include "AnimationGraphSchema.h"
#include "AnimationStateMachineSchema.h"
#include "AnimationTransitionGraph.h"
#include "Animation/AnimBlueprint.h"
#include "Animation/AnimNode_LinkedAnimLayer.h"
#include "K2Node_VariableGet.h"
#include "Kismet2/BlueprintEditorUtils.h"

DEFINE_LOG_CATEGORY_STATIC(LogAnimMachineBridge, Log, All);

namespace
{
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

	// Adds a Sequence Player next to the graph's sink node (the Root node of an AnimGraph or layer, the result node of a state) and links the two.
	bool LinkSequenceToSink(UEdGraph* Graph, UAnimSequenceBase* Sequence)
	{
		if (!Graph || !Sequence)
		{
			return false;
		}
		UAnimGraphNode_Base* Sink = nullptr;
		for (UEdGraphNode* Node : Graph->Nodes)
		{
			UAnimGraphNode_Base* Candidate = Cast<UAnimGraphNode_Base>(Node);
			if (Candidate && Candidate->IsSinkNode())
			{
				Sink = Candidate;
				break;
			}
		}
		if (!Sink)
		{
			UE_LOG(LogAnimMachineBridge, Error, TEXT("LinkSequenceToSink: graph %s has no sink node"), *Graph->GetName());
			return false;
		}
		// The node creator calls CreateNewGuid, PostPlacedNewNode and AllocateDefaultPins (Runtime/Engine/Classes/EdGraph/EdGraph.h).
		FGraphNodeCreator<UAnimGraphNode_SequencePlayer> Creator(*Graph);
		UAnimGraphNode_SequencePlayer* Player = Creator.CreateNode();
		Player->Node.SetSequence(Sequence);   // source: Runtime/Engine/Classes/Animation/AnimNode_SequencePlayer.h, FAnimNode_SequencePlayer::SetSequence
		Player->NodePosX = Sink->NodePosX - 320;
		Player->NodePosY = Sink->NodePosY;
		Creator.Finalize();

		UEdGraphPin* PlayerOut = FindPosePin(Player, EGPD_Output);
		UEdGraphPin* SinkIn = FindPosePin(Sink, EGPD_Input);
		bool bLinked = false;
		if (PlayerOut && SinkIn)
		{
			Graph->GetSchema()->TryCreateConnection(PlayerOut, SinkIn);
			bLinked = PlayerOut->LinkedTo.Contains(SinkIn);
		}
		if (UBlueprint* Blueprint = FBlueprintEditorUtils::FindBlueprintForGraph(Graph))
		{
			FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
		}
		return bLinked;
	}

	UAnimationGraph* FindLayerGraph(UAnimBlueprint* AnimBlueprint, FName LayerName)
	{
		TArray<UEdGraph*> Graphs;
		AnimBlueprint->GetAllGraphs(Graphs);
		for (UEdGraph* Graph : Graphs)
		{
			if (Graph->GetFName() == LayerName)
			{
				if (UAnimationGraph* AnimGraph = Cast<UAnimationGraph>(Graph))
				{
					return AnimGraph;
				}
			}
		}
		return nullptr;
	}
}

bool UAnimMachineBridgeLibrary::SetStateSequence(UAnimStateNode* State, UAnimSequenceBase* Sequence)
{
	return State && LinkSequenceToSink(State->BoundGraph, Sequence);
}

bool UAnimMachineBridgeLibrary::AddTransitionOnVariable(UAnimStateNode* FromState, UAnimStateNode* ToState, FName BoolVariable, float CrossfadeSeconds)
{
	if (!FromState || !ToState || FromState->GetGraph() != ToState->GetGraph())
	{
		return false;
	}
	// The same call the state machine editor makes when a pin is dragged from one state to another (AnimationStateMachineSchema.h).
	const UAnimationStateMachineSchema* Schema = GetDefault<UAnimationStateMachineSchema>();
	if (!Schema->CreateAutomaticConversionNodeAndConnections(FromState->GetOutputPin(), ToState->GetInputPin()))
	{
		return false;
	}
	// Find the transition node that was just linked from FromState to ToState.
	UAnimStateTransitionNode* Transition = nullptr;
	for (UEdGraphPin* Linked : FromState->GetOutputPin()->LinkedTo)
	{
		UAnimStateTransitionNode* Candidate = Cast<UAnimStateTransitionNode>(Linked->GetOwningNode());
		if (Candidate && Candidate->GetOutputPin() && Candidate->GetOutputPin()->LinkedTo.ContainsByPredicate([ToState](const UEdGraphPin* Pin) { return Pin->GetOwningNode() == ToState; }))
		{
			Transition = Candidate;
		}
	}
	if (!Transition)
	{
		UE_LOG(LogAnimMachineBridge, Error, TEXT("AddTransitionOnVariable: the new transition node was not found"));
		return false;
	}
	Transition->CrossfadeDuration = CrossfadeSeconds;

	UAnimationTransitionGraph* RuleGraph = Cast<UAnimationTransitionGraph>(Transition->BoundGraph);
	UAnimGraphNode_TransitionResult* Result = RuleGraph ? RuleGraph->GetResultNode() : nullptr;
	UEdGraphPin* CanEnter = Result ? Result->FindPin(FName(TEXT("bCanEnterTransition")), EGPD_Input) : nullptr;
	if (!CanEnter)
	{
		UE_LOG(LogAnimMachineBridge, Error, TEXT("AddTransitionOnVariable: the rule graph has no bCanEnterTransition pin"));
		return false;
	}

	FGraphNodeCreator<UK2Node_VariableGet> Creator(*RuleGraph);
	UK2Node_VariableGet* Get = Creator.CreateNode();
	Get->VariableReference.SetSelfMember(BoolVariable);   // a member of the Animation Blueprint's class, here a variable of its native parent class
	Get->NodePosX = Result->NodePosX - 250;
	Get->NodePosY = Result->NodePosY;
	Creator.Finalize();

	UEdGraphPin* ValuePin = Get->GetValuePin();
	bool bLinked = false;
	if (ValuePin)
	{
		RuleGraph->GetSchema()->TryCreateConnection(ValuePin, CanEnter);
		bLinked = ValuePin->LinkedTo.Contains(CanEnter);
	}
	if (UBlueprint* Blueprint = FBlueprintEditorUtils::FindBlueprintForGraph(RuleGraph))
	{
		FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
	}
	return bLinked;
}

bool UAnimMachineBridgeLibrary::AddAnimationLayer(UAnimBlueprint* AnimBlueprint, FName LayerName)
{
	if (!AnimBlueprint || LayerName.IsNone())
	{
		return false;
	}
	// The graph the Add Animation Layer command makes (Editor/Kismet/Private/BlueprintEditor.cpp, CGT_NewAnimationLayer).
	UEdGraph* NewGraph = FBlueprintEditorUtils::CreateNewGraph(AnimBlueprint, LayerName, UAnimationGraph::StaticClass(), UAnimationGraphSchema::StaticClass());
	if (!NewGraph)
	{
		return false;
	}
	FBlueprintEditorUtils::AddDomainSpecificGraph(AnimBlueprint, NewGraph);
	FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(AnimBlueprint);
	return true;
}

bool UAnimMachineBridgeLibrary::SetLayerSequence(UAnimBlueprint* AnimBlueprint, FName LayerName, UAnimSequenceBase* Sequence)
{
	return AnimBlueprint && LinkSequenceToSink(FindLayerGraph(AnimBlueprint, LayerName), Sequence);
}

bool UAnimMachineBridgeLibrary::ImplementLayerInterface(UAnimBlueprint* Target, UAnimBlueprint* Interface)
{
	if (!Target || !Interface || !Interface->GeneratedClass)
	{
		return false;
	}
	return FBlueprintEditorUtils::ImplementNewInterface(Target, Interface->GeneratedClass->GetClassPathName());
}

TArray<FString> UAnimMachineBridgeLibrary::DescribeLayers(UAnimBlueprint* AnimBlueprint)
{
	TArray<FString> Lines;
	if (!AnimBlueprint)
	{
		return Lines;
	}
	for (const FBPInterfaceDescription& Description : AnimBlueprint->ImplementedInterfaces)
	{
		FString Graphs;
		for (const UEdGraph* Graph : Description.Graphs)
		{
			Graphs += Graph->GetName() + TEXT(" ");
		}
		Lines.Add(FString::Printf(TEXT("interface %s | graphs %s"), Description.Interface.Get() ? *Description.Interface.Get()->GetName() : TEXT("none"), *Graphs));
	}
	TArray<UEdGraph*> AllGraphs;
	AnimBlueprint->GetAllGraphs(AllGraphs);
	for (UEdGraph* Graph : AllGraphs)
	{
		if (Cast<UAnimationGraph>(Graph))
		{
			Lines.Add(FString::Printf(TEXT("animation-graph %s | interface guid %s"), *Graph->GetName(), Graph->InterfaceGuid.IsValid() ? TEXT("yes") : TEXT("no")));
		}
		for (UEdGraphNode* Node : Graph->Nodes)
		{
			if (const UAnimGraphNode_LinkedAnimLayer* Layer = Cast<UAnimGraphNode_LinkedAnimLayer>(Node))
			{
				Lines.Add(FString::Printf(TEXT("linked-layer %s | layer %s | interface %s"), *Graph->GetName(), *Layer->Node.Layer.ToString(), Layer->Node.Interface.Get() ? *Layer->Node.Interface.Get()->GetName() : TEXT("none")));
			}
		}
	}
	return Lines;
}
