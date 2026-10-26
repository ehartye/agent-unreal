#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "AnimMachineBridgeLibrary.generated.h"

class UAnimBlueprint;
class UAnimSequenceBase;
class UAnimStateNode;

/**
 * Editor C++ for the parts of a played state machine and of linked layers that Python cannot place. Python sees this class as
 * unreal.AnimMachineBridgeLibrary. It works with unreal.AnimBridgeLibrary (AddState, ResampleBlendSpace), which builds the states.
 */
UCLASS()
class UAnimMachineBridgeLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Put a Sequence Player that plays Sequence into the state's graph and link it to the state's result node. */
	UFUNCTION(BlueprintCallable, Category = "AnimMachineBridge")
	static bool SetStateSequence(UAnimStateNode* State, UAnimSequenceBase* Sequence);

	/**
	 * Add a transition from one state to another (as AnimBridgeLibrary.AddTransition does) and give its rule graph a Get node for a Boolean
	 * variable of the Animation Blueprint's parent class, linked to the rule's result pin. Returns false when any step could not be done.
	 */
	UFUNCTION(BlueprintCallable, Category = "AnimMachineBridge")
	static bool AddTransitionOnVariable(UAnimStateNode* FromState, UAnimStateNode* ToState, FName BoolVariable, float CrossfadeSeconds);

	/** Add an animation layer graph (a function graph with an AnimGraph Root node) named LayerName. */
	UFUNCTION(BlueprintCallable, Category = "AnimMachineBridge")
	static bool AddAnimationLayer(UAnimBlueprint* AnimBlueprint, FName LayerName);

	/** Put a Sequence Player that plays Sequence into the layer graph named LayerName and link it to the graph's Root node. */
	UFUNCTION(BlueprintCallable, Category = "AnimMachineBridge")
	static bool SetLayerSequence(UAnimBlueprint* AnimBlueprint, FName LayerName, UAnimSequenceBase* Sequence);

	/** Make Target implement the layer interface Interface (FBlueprintEditorUtils::ImplementNewInterface); the layer graphs appear in Target. Compile Interface first. */
	UFUNCTION(BlueprintCallable, Category = "AnimMachineBridge")
	static bool ImplementLayerInterface(UAnimBlueprint* Target, UAnimBlueprint* Interface);

	/** One line per implemented interface, per animation graph (name, interface guid) and per Linked Anim Layer node (layer, interface). */
	UFUNCTION(BlueprintCallable, Category = "AnimMachineBridge")
	static TArray<FString> DescribeLayers(UAnimBlueprint* AnimBlueprint);
};
