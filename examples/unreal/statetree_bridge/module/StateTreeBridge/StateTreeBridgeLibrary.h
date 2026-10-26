#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "StateTreeBridgeLibrary.generated.h"

class UStateTree;

/** What a compile returned: the result and one "Severity: text" line per compiler message. */
USTRUCT(BlueprintType)
struct FStateTreeBridgeCompileResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	bool bCompiled = false;

	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	TArray<FString> Messages;
};

/** What the tree's schema and root parameters are, read from the editor data. */
USTRUCT(BlueprintType)
struct FStateTreeBridgeTreeInfo
{
	GENERATED_BODY()

	/** Class name of the tree's schema, for example StateTreeComponentSchema. */
	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	FString SchemaClass;

	/** One "Name:Class" entry per context object the schema offers (the objects a Context property can bind to). */
	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	TArray<FString> ContextObjects;

	/** One "Name:Type=Value" entry per root parameter of the tree (the value is printed for integer parameters only). */
	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	TArray<FString> RootParameters;

	/** Whether the schema accepts a task struct that derives from FStateTreeAITaskBase (the base of Epic's AI move-to task). */
	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	bool bAllowsAiTaskBase = false;

	/** Whether the schema accepts the probe task struct (derives from FStateTreeTaskCommonBase). */
	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	bool bAllowsProbeTask = false;

	/** Whether the schema allows evaluators and global parameters in the tree. */
	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	bool bAllowsEvaluators = false;

	UPROPERTY(BlueprintReadOnly, Category = "StateTreeBridge")
	bool bAllowsGlobalParameters = false;
};

/** Builds, compiles and checks StateTree assets from C++. Python calls these (unreal.StateTreeBridgeLibrary). */
UCLASS()
class UStateTreeBridgeLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Creates a StateTree asset and builds this tree, without compiling it:
	 *   Root > Work   (task "Work", transition OnTick -> Done when WorkTicks >= MinTicks)
	 *        > Done   (enter condition WorkTicks >= MinTicks, task "Done" that does not count ticks)
	 * The schema is the AI component schema, or with bComponentSchema the component schema (for a pawn that owns a UStateTreeComponent).
	 * With bBroken the Work state also gets a task whose Context property no schema context object can satisfy.
	 * Returns null when the asset or its root state could not be made.
	 */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static UStateTree* CreateTree(const FString& PackagePath, const FString& AssetName, int32 MinTicks, bool bBroken, bool bComponentSchema);

	/**
	 * Creates an AI component schema tree like the one above without the Done enter condition, whose transition condition keeps its own
	 * threshold of 1000000 and is bound to a root parameter "Threshold" (an integer parameter whose default is the Threshold argument). Only the binding can make the
	 * transition fire.
	 */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static UStateTree* CreateParameterTree(const FString& PackagePath, const FString& AssetName, int32 Threshold);

	/** Compiles the tree and returns the result with the compiler messages; the messages are also dumped to the log. */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static FStateTreeBridgeCompileResult CompileTree(UStateTree* Tree);

	/** Reads the schema class, its context objects, what it allows and the root parameters from the tree's editor data. */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static FStateTreeBridgeTreeInfo DescribeTree(UStateTree* Tree);

	/** True when the tree is linked and can run (the compiled data is present). */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static bool IsReadyToRun(const UStateTree* Tree);

	/** True when the editor data changed since the last successful compile. */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static bool NeedsRecompile(const UStateTree* Tree);
};
