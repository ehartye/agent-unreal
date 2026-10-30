#pragma once

#include "CoreMinimal.h"
#include "EdGraph/EdGraphNode.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "MutableBridgeLibrary.generated.h"

/** The outcome of a bridge call that does not return a node. Python sees it as unreal.MutableBridgeResult. */
USTRUCT(BlueprintType)
struct FMutableBridgeResult
{
	GENERATED_BODY()

	/** The call did what was asked. When false, Message says why and nothing was changed. */
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") bool bOk = false;
	/** The reason for a refusal, or the value read back by GetNodeProperty. */
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FString Message;
};

/** The outcome of AddNode. Python sees it as unreal.MutableBridgeNodeResult. */
USTRUCT(BlueprintType)
struct FMutableBridgeNodeResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") bool bOk = false;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FString Message;
	/** The new node, which already sits in the object's graph with its default pins. Null when bOk is false. */
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") TObjectPtr<UEdGraphNode> Node = nullptr;
};

/** One pin of a node. Python sees it as unreal.MutableBridgePin. */
USTRUCT(BlueprintType)
struct FMutableBridgePin
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FName Name;
	/** "Input" or "Output". */
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FString Direction;
	/** The pin category, for example "mesh", "material" (a mesh section), "enum", "component" or "object". */
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FName Category;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FName SubCategory;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") bool bIsArray = false;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") bool bHidden = false;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") bool bOrphaned = false;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") int32 LinkCount = 0;
};

/** One node of a graph. Python sees it as unreal.MutableBridgeNodeInfo. */
USTRUCT(BlueprintType)
struct FMutableBridgeNodeInfo
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") TObjectPtr<UEdGraphNode> Node = nullptr;
	/** The node's class name without the U prefix, for example CustomizableObjectNodeSkeletalMesh. */
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FString ClassName;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FString NodeId;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") int32 PinCount = 0;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") int32 LinkCount = 0;
};

/** One link between two pins, from an output pin to an input pin. Python sees it as unreal.MutableBridgeLink. */
USTRUCT(BlueprintType)
struct FMutableBridgeLink
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") TObjectPtr<UEdGraphNode> FromNode = nullptr;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FName FromPin;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FString FromClass;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") TObjectPtr<UEdGraphNode> ToNode = nullptr;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FName ToPin;
	UPROPERTY(BlueprintReadWrite, Category = "MutableBridge") FString ToClass;
};

/**
 * Python sees this class as unreal.MutableBridgeLibrary.
 *
 * The Mutable plugin's editor module keeps its node classes private and its graph functions unreflected, so a script can neither add a node to a
 * Customizable Object's graph nor link two pins. These statics do both, by the class's name and the pin's name, and read the graph back. The node
 * classes are reached through reflection, so no Mutable header other than the schema's is included.
 * The first argument of AddNode and GetGraphNodes is the Customizable Object (typed UObject so that this header needs no Mutable include).
 */
UCLASS()
class UMutableBridgeLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** The pin categories the Mutable schema defines (the exported constants of the editor module), as names. */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static TArray<FName> GetPinCategories();

	/**
	 * Add a node of the class NodeClassName (for example CustomizableObjectNodeSkeletalMesh; the name without the U prefix, or a full /Script/ path)
	 * to the graph of a Customizable Object, give it its default pins and a position. A name that is not a placeable Mutable node class is refused.
	 * PropertyNames and PropertyValues (pairs, same length, possibly empty) are set from their text form before the node builds its pins, for
	 * properties that decide the pins, such as the pin type of a switch. The Customizable Object comes from
	 * unreal.CustomizableObjectEditorFunctionLibrary.new_customizable_object and already holds its base object node.
	 */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static FMutableBridgeNodeResult AddNode(UObject* CustomizableObject, const FString& NodeClassName, FVector2D Location, const TArray<FString>& PropertyNames, const TArray<FString>& PropertyValues);

	/**
	 * Set a property of a node from its text form (the form the editor writes to a .ini or a copy: a name, a number, an asset path, or
	 * ((Name="A"),(Name="B")) for an array of structs). It works for properties Python cannot reach because they are not editable. After the
	 * change the node is notified and rebuilds its pins, as it does when the property is edited in the details panel.
	 */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static FMutableBridgeResult SetNodeProperty(UEdGraphNode* Node, FName PropertyName, const FString& ValueText);

	/** Read a property of a node as text; Message holds the value. */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static FMutableBridgeResult GetNodeProperty(UEdGraphNode* Node, FName PropertyName);

	/** Rebuild a node's pins from its properties (what the editor does after a property change). Links that still match are kept. */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static FMutableBridgeResult ReconstructNode(UEdGraphNode* Node);

	/** The pins of a node with their category, direction and link count. Pin names are what LinkPins takes. */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static TArray<FMutableBridgePin> GetNodePins(UEdGraphNode* Node);

	/**
	 * Link an output pin to an input pin through the graph's schema, which applies Mutable's own rules (direction, type category, one link into a
	 * single input). A missing node or pin, two pins of the wrong kind, or a link the schema disallows is refused with the reason in Message.
	 */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static FMutableBridgeResult LinkPins(UEdGraphNode* OutputNode, FName OutputPin, UEdGraphNode* InputNode, FName InputPin);

	/** Every node of a Customizable Object's graph. */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static TArray<FMutableBridgeNodeInfo> GetGraphNodes(UObject* CustomizableObject);

	/** Every link of a Customizable Object's graph, each from an output pin to an input pin. */
	UFUNCTION(BlueprintCallable, Category = "MutableBridge")
	static TArray<FMutableBridgeLink> GetGraphLinks(UObject* CustomizableObject);
};
