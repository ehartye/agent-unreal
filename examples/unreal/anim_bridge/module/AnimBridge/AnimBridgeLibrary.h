#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "AnimBridgeLibrary.generated.h"

class UAnimBlueprint;
class UAnimStateNode;
class UBlendSpace;
class UEdGraph;

/** What AddSlotToAnimBlueprint did. Python sees it as unreal.SlotBridgeResult. */
USTRUCT(BlueprintType)
struct FSlotBridgeResult
{
	GENERATED_BODY()

	/** A Slot node now exists in the AnimGraph and its output pose pin is linked to the Result pin of the Root node. */
	UPROPERTY(BlueprintReadWrite, Category = "AnimBridge") bool bSlotLinkedToRoot = false;
	UPROPERTY(BlueprintReadWrite, Category = "AnimBridge") bool bCompiled = false;
	UPROPERTY(BlueprintReadWrite, Category = "AnimBridge") int32 NumErrors = 0;
	UPROPERTY(BlueprintReadWrite, Category = "AnimBridge") int32 NumWarnings = 0;
	/** Blueprint Status after the compile (EBlueprintStatus: 0 unknown, 1 dirty, 2 error, 3 up to date, 4 being created, 5 up to date with warnings). */
	UPROPERTY(BlueprintReadWrite, Category = "AnimBridge") int32 BlueprintStatus = 0;
	UPROPERTY(BlueprintReadWrite, Category = "AnimBridge") TArray<FString> Messages;
};

/** Python sees this class as unreal.AnimBridgeLibrary. */
UCLASS()
class UAnimBridgeLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Add an AnimGraph Slot node named SlotName to an Animation Blueprint, link its output pose to the Root node, and compile.
	 * The Animation Blueprint itself is created from Python (AssetTools with unreal.AnimBlueprintFactory). The Source input of the
	 * Slot node stays unlinked, so the slot produces a pose only while a montage plays in it.
	 */
	UFUNCTION(BlueprintCallable, Category = "AnimBridge")
	static FSlotBridgeResult AddSlotToAnimBlueprint(UAnimBlueprint* AnimBlueprint, FName SlotName);

	/**
	 * Add a state named StateName to a state machine graph (the UAnimationStateMachineGraph that lives under an AnimGraph State Machine
	 * node; Python lists it with unreal.BlueprintEditorLibrary.list_graphs). The first state is linked to the Entry node.
	 * Python cannot place state nodes: the graph's Nodes property is protected and the Blueprint action list offers none.
	 */
	UFUNCTION(BlueprintCallable, Category = "AnimBridge")
	static UAnimStateNode* AddState(UEdGraph* StateMachineGraph, FName StateName, FVector2D Location);

	/** Add a transition from one state to another (a transition node with its rule graph). Returns false when the states are not in one graph. */
	UFUNCTION(BlueprintCallable, Category = "AnimBridge")
	static bool AddTransition(UAnimStateNode* FromState, UAnimStateNode* ToState);

	/**
	 * Validate the samples of a Blend Space and rebuild its runtime data (UBlendSpace::ValidateSampleData and ResampleData, both C++ only).
	 * Python can write blend_parameters and sample_data, but only this step builds the data the Blend Space Player evaluates.
	 */
	UFUNCTION(BlueprintCallable, Category = "AnimBridge")
	static bool ResampleBlendSpace(UBlendSpace* BlendSpace);

	/** One line per node of every graph in the Animation Blueprint (graph, class, title) and per link between nodes, read back from the graphs. */
	UFUNCTION(BlueprintCallable, Category = "AnimBridge")
	static TArray<FString> DescribeAnimGraph(UAnimBlueprint* AnimBlueprint);
};
