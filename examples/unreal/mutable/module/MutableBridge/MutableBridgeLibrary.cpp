#include "MutableBridgeLibrary.h"

#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphNode.h"
#include "EdGraph/EdGraphPin.h"
#include "EdGraph/EdGraphSchema.h"
#include "Misc/StringOutputDevice.h"
#include "MuCOE/EdGraphSchema_CustomizableObject.h"
#include "UObject/UObjectGlobals.h"
#include "UObject/UObjectHash.h"
#include "UObject/UnrealType.h"

DEFINE_LOG_CATEGORY_STATIC(LogMutableBridge, Log, All);

namespace
{
	FMutableBridgeResult Refuse(const FString& Message)
	{
		UE_LOG(LogMutableBridge, Warning, TEXT("refused: %s"), *Message);
		FMutableBridgeResult Result;
		Result.bOk = false;
		Result.Message = Message;
		return Result;
	}

	FMutableBridgeResult Accept(const FString& Message)
	{
		FMutableBridgeResult Result;
		Result.bOk = true;
		Result.Message = Message;
		return Result;
	}

	/** The Customizable Object class and the base class of its nodes, found by path so that this module needs no Mutable class header. */
	UClass* FindObjectClass()
	{
		return FindObject<UClass>(nullptr, TEXT("/Script/CustomizableObject.CustomizableObject"));
	}

	UClass* FindNodeBaseClass()
	{
		return FindObject<UClass>(nullptr, TEXT("/Script/CustomizableObjectEditor.CustomizableObjectNode"));
	}

	/** The graph that is an inner object of the Customizable Object, or null when the argument is not one. */
	UEdGraph* FindGraph(UObject* CustomizableObject, FString& OutError)
	{
		const UClass* ObjectClass = FindObjectClass();
		if (!CustomizableObject)
		{
			OutError = TEXT("the Customizable Object is null");
			return nullptr;
		}
		if (!ObjectClass || !CustomizableObject->IsA(ObjectClass))
		{
			OutError = FString::Printf(TEXT("%s is not a Customizable Object"), *CustomizableObject->GetClass()->GetName());
			return nullptr;
		}
		TArray<UObject*> Inner;
		GetObjectsWithOuter(CustomizableObject, Inner, EGetObjectsFlags::None);
		UEdGraph* First = nullptr;
		for (UObject* Object : Inner)
		{
			UEdGraph* Graph = Cast<UEdGraph>(Object);
			if (!Graph)
			{
				continue;
			}
			if (Graph->GetClass()->GetName().Contains(TEXT("CustomizableObjectGraph")))
			{
				return Graph;
			}
			if (!First)
			{
				First = Graph;
			}
		}
		if (!First)
		{
			OutError = TEXT("the Customizable Object has no graph yet (create it with new_customizable_object)");
		}
		return First;
	}

	UClass* FindNodeClass(const FString& ClassName, FString& OutError)
	{
		UClass* Base = FindNodeBaseClass();
		if (!Base)
		{
			OutError = TEXT("the Mutable editor module is not loaded (no CustomizableObjectNode class)");
			return nullptr;
		}
		UClass* Class = ClassName.Contains(TEXT("."))
			? FindObject<UClass>(nullptr, *ClassName)
			: FindFirstObject<UClass>(*ClassName, EFindFirstObjectOptions::NativeFirst);
		if (!Class)
		{
			OutError = FString::Printf(TEXT("no class named '%s'"), *ClassName);
			return nullptr;
		}
		if (!Class->IsChildOf(Base))
		{
			OutError = FString::Printf(TEXT("%s is not a Customizable Object node class"), *Class->GetName());
			return nullptr;
		}
		if (Class->HasAnyClassFlags(CLASS_Abstract))
		{
			OutError = FString::Printf(TEXT("%s is abstract"), *Class->GetName());
			return nullptr;
		}
		return Class;
	}

	/** Import ValueText into the node's property; false with the reason in OutError when the property or the text is not valid. */
	bool ImportNodeProperty(UEdGraphNode* Node, FName PropertyName, const FString& ValueText, FProperty*& OutProperty, FString& OutError)
	{
		OutProperty = Node->GetClass()->FindPropertyByName(PropertyName);
		if (!OutProperty)
		{
			OutError = FString::Printf(TEXT("%s has no property '%s'"), *Node->GetClass()->GetName(), *PropertyName.ToString());
			return false;
		}
		FStringOutputDevice ImportErrors;
		void* ValuePtr = OutProperty->ContainerPtrToValuePtr<void>(Node);
		const TCHAR* End = OutProperty->ImportText_Direct(*ValueText, ValuePtr, Node, PPF_None, &ImportErrors);
		if (!End)
		{
			OutError = FString::Printf(TEXT("'%s' is not a valid value for %s.%s%s%s"), *ValueText, *Node->GetClass()->GetName(), *PropertyName.ToString(), ImportErrors.IsEmpty() ? TEXT("") : TEXT(": "), *ImportErrors);
			return false;
		}
		return true;
	}

	FString PinLabel(const UEdGraphNode* Node, FName Pin)
	{
		return FString::Printf(TEXT("%s.%s"), Node ? *Node->GetClass()->GetName() : TEXT("null"), *Pin.ToString());
	}
}

TArray<FName> UMutableBridgeLibrary::GetPinCategories()
{
	// These are the editor module's exported constants: reading them is the link-level proof that the module's symbols reach this one.
	return {
		UEdGraphSchema_CustomizableObject::PC_Object, UEdGraphSchema_CustomizableObject::PC_Component, UEdGraphSchema_CustomizableObject::PC_MeshSection,
		UEdGraphSchema_CustomizableObject::PC_Modifier, UEdGraphSchema_CustomizableObject::PC_Mesh, UEdGraphSchema_CustomizableObject::PC_SkeletalMesh,
		UEdGraphSchema_CustomizableObject::PC_SkeletalMesh_Passthrough, UEdGraphSchema_CustomizableObject::PC_Enum, UEdGraphSchema_CustomizableObject::PC_String,
		UEdGraphSchema_CustomizableObject::PC_Material,
	};
}

FMutableBridgeNodeResult UMutableBridgeLibrary::AddNode(UObject* CustomizableObject, const FString& NodeClassName, FVector2D Location, const TArray<FString>& PropertyNames, const TArray<FString>& PropertyValues)
{
	FMutableBridgeNodeResult Result;
	FString Error;
	UEdGraph* Graph = FindGraph(CustomizableObject, Error);
	UClass* NodeClass = Graph ? FindNodeClass(NodeClassName, Error) : nullptr;
	if (Graph && NodeClass && PropertyNames.Num() != PropertyValues.Num())
	{
		Error = TEXT("PropertyNames and PropertyValues must have the same length");
		NodeClass = nullptr;
	}
	if (!Graph || !NodeClass)
	{
		Result.Message = Error;
		UE_LOG(LogMutableBridge, Warning, TEXT("AddNode refused: %s"), *Error);
		return Result;
	}

	// The node is made and given its properties before it joins the graph, so a refused property leaves the graph as it was.
	UEdGraphNode* Node = NewObject<UEdGraphNode>(Graph, NodeClass, NAME_None, RF_Transactional);
	for (int32 Index = 0; Index < PropertyNames.Num(); ++Index)
	{
		FProperty* Property = nullptr;
		if (!ImportNodeProperty(Node, FName(*PropertyNames[Index]), PropertyValues[Index], Property, Error))
		{
			Node->MarkAsGarbage();
			Result.Message = Error;
			UE_LOG(LogMutableBridge, Warning, TEXT("AddNode refused: %s"), *Error);
			return Result;
		}
	}
	Graph->AddNode(Node, true, false);
	Node->CreateNewGuid();
	Node->PostPlacedNewNode();
	Node->ReconstructNode();   // the Mutable node lifecycle starts at ReconstructNode, which allocates the default pins
	Node->NodePosX = FMath::RoundToInt(Location.X);
	Node->NodePosY = FMath::RoundToInt(Location.Y);
	Graph->NotifyGraphChanged();
	CustomizableObject->MarkPackageDirty();

	Result.bOk = true;
	Result.Node = Node;
	Result.Message = FString::Printf(TEXT("added %s with %d pins"), *NodeClass->GetName(), Node->Pins.Num());
	return Result;
}

FMutableBridgeResult UMutableBridgeLibrary::SetNodeProperty(UEdGraphNode* Node, FName PropertyName, const FString& ValueText)
{
	if (!Node)
	{
		return Refuse(TEXT("the node is null"));
	}
	FProperty* Property = nullptr;
	FString Error;
	if (!ImportNodeProperty(Node, PropertyName, ValueText, Property, Error))
	{
		return Refuse(Error);
	}
	FPropertyChangedEvent Changed(Property);
	Node->PostEditChangeProperty(Changed);
	Node->ReconstructNode();
	Node->MarkPackageDirty();
	return Accept(FString::Printf(TEXT("set %s.%s"), *Node->GetClass()->GetName(), *PropertyName.ToString()));
}

FMutableBridgeResult UMutableBridgeLibrary::GetNodeProperty(UEdGraphNode* Node, FName PropertyName)
{
	if (!Node)
	{
		return Refuse(TEXT("the node is null"));
	}
	const FProperty* Property = Node->GetClass()->FindPropertyByName(PropertyName);
	if (!Property)
	{
		return Refuse(FString::Printf(TEXT("%s has no property '%s'"), *Node->GetClass()->GetName(), *PropertyName.ToString()));
	}
	FString Text;
	Property->ExportText_Direct(Text, Property->ContainerPtrToValuePtr<void>(Node), nullptr, Node, PPF_None);
	return Accept(Text);
}

FMutableBridgeResult UMutableBridgeLibrary::ReconstructNode(UEdGraphNode* Node)
{
	if (!Node)
	{
		return Refuse(TEXT("the node is null"));
	}
	Node->ReconstructNode();
	return Accept(FString::Printf(TEXT("%s now has %d pins"), *Node->GetClass()->GetName(), Node->Pins.Num()));
}

TArray<FMutableBridgePin> UMutableBridgeLibrary::GetNodePins(UEdGraphNode* Node)
{
	TArray<FMutableBridgePin> Out;
	if (!Node)
	{
		return Out;
	}
	for (const UEdGraphPin* Pin : Node->Pins)
	{
		if (!Pin)
		{
			continue;
		}
		FMutableBridgePin Entry;
		Entry.Name = Pin->PinName;
		Entry.Direction = Pin->Direction == EGPD_Input ? TEXT("Input") : TEXT("Output");
		Entry.Category = Pin->PinType.PinCategory;
		Entry.SubCategory = Pin->PinType.PinSubCategory;
		Entry.bIsArray = Pin->PinType.IsArray();
		Entry.bHidden = Pin->bHidden != 0;
		Entry.bOrphaned = Pin->bOrphanedPin != 0;
		Entry.LinkCount = Pin->LinkedTo.Num();
		Out.Add(Entry);
	}
	return Out;
}

FMutableBridgeResult UMutableBridgeLibrary::LinkPins(UEdGraphNode* OutputNode, FName OutputPin, UEdGraphNode* InputNode, FName InputPin)
{
	if (!OutputNode || !InputNode)
	{
		return Refuse(TEXT("a node is null"));
	}
	UEdGraphPin* Out = OutputNode->FindPin(OutputPin, EGPD_Output);
	if (!Out)
	{
		return Refuse(FString::Printf(TEXT("no output pin %s"), *PinLabel(OutputNode, OutputPin)));
	}
	UEdGraphPin* In = InputNode->FindPin(InputPin, EGPD_Input);
	if (!In)
	{
		return Refuse(FString::Printf(TEXT("no input pin %s"), *PinLabel(InputNode, InputPin)));
	}
	UEdGraph* Graph = OutputNode->GetGraph();
	if (!Graph || Graph != InputNode->GetGraph())
	{
		return Refuse(TEXT("the two nodes are not in one graph"));
	}
	const UEdGraphSchema* Schema = Graph->GetSchema();
	if (!Schema)
	{
		return Refuse(TEXT("the graph has no schema"));
	}
	const FPinConnectionResponse Response = Schema->CanCreateConnection(Out, In);
	if (Response.Response == CONNECT_RESPONSE_DISALLOW)
	{
		return Refuse(FString::Printf(TEXT("%s -> %s: %s"), *PinLabel(OutputNode, OutputPin), *PinLabel(InputNode, InputPin), *Response.Message.ToString()));
	}
	if (!Schema->TryCreateConnection(Out, In))
	{
		return Refuse(FString::Printf(TEXT("%s -> %s: the schema did not create the link"), *PinLabel(OutputNode, OutputPin), *PinLabel(InputNode, InputPin)));
	}
	// A link can rebuild a node (a switch grows one input per option), so the pins are looked up again to confirm the link.
	const UEdGraphPin* OutAfter = OutputNode->FindPin(OutputPin, EGPD_Output);
	const UEdGraphPin* InAfter = InputNode->FindPin(InputPin, EGPD_Input);
	if (!OutAfter || !InAfter || !OutAfter->LinkedTo.Contains(InAfter))
	{
		return Refuse(FString::Printf(TEXT("%s -> %s: the link is not in place after the schema accepted it"), *PinLabel(OutputNode, OutputPin), *PinLabel(InputNode, InputPin)));
	}
	return Accept(FString::Printf(TEXT("linked %s -> %s"), *PinLabel(OutputNode, OutputPin), *PinLabel(InputNode, InputPin)));
}

TArray<FMutableBridgeNodeInfo> UMutableBridgeLibrary::GetGraphNodes(UObject* CustomizableObject)
{
	TArray<FMutableBridgeNodeInfo> Out;
	FString Error;
	const UEdGraph* Graph = FindGraph(CustomizableObject, Error);
	if (!Graph)
	{
		UE_LOG(LogMutableBridge, Warning, TEXT("GetGraphNodes: %s"), *Error);
		return Out;
	}
	for (UEdGraphNode* Node : Graph->Nodes)
	{
		if (!Node)
		{
			continue;
		}
		FMutableBridgeNodeInfo Info;
		Info.Node = Node;
		Info.ClassName = Node->GetClass()->GetName();
		Info.NodeId = Node->NodeGuid.ToString();
		Info.PinCount = Node->Pins.Num();
		for (const UEdGraphPin* Pin : Node->Pins)
		{
			Info.LinkCount += Pin ? Pin->LinkedTo.Num() : 0;
		}
		Out.Add(Info);
	}
	return Out;
}

TArray<FMutableBridgeLink> UMutableBridgeLibrary::GetGraphLinks(UObject* CustomizableObject)
{
	TArray<FMutableBridgeLink> Out;
	FString Error;
	const UEdGraph* Graph = FindGraph(CustomizableObject, Error);
	if (!Graph)
	{
		UE_LOG(LogMutableBridge, Warning, TEXT("GetGraphLinks: %s"), *Error);
		return Out;
	}
	for (UEdGraphNode* Node : Graph->Nodes)
	{
		if (!Node)
		{
			continue;
		}
		for (const UEdGraphPin* Pin : Node->Pins)
		{
			if (!Pin || Pin->Direction != EGPD_Output)
			{
				continue;
			}
			for (const UEdGraphPin* Other : Pin->LinkedTo)
			{
				if (!Other || !Other->GetOwningNodeUnchecked())
				{
					continue;
				}
				FMutableBridgeLink Link;
				Link.FromNode = Node;
				Link.FromPin = Pin->PinName;
				Link.FromClass = Node->GetClass()->GetName();
				Link.ToNode = Other->GetOwningNodeUnchecked();
				Link.ToPin = Other->PinName;
				Link.ToClass = Link.ToNode->GetClass()->GetName();
				Out.Add(Link);
			}
		}
	}
	return Out;
}
