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

/** Builds, compiles and checks StateTree assets from C++. Python calls these (unreal.StateTreeBridgeLibrary). */
UCLASS()
class UStateTreeBridgeLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Creates a StateTree asset with the AI component schema and builds this tree, without compiling it:
	 *   Root > Work   (task "Work", transition OnTick -> Done when WorkTicks >= MinTicks)
	 *        > Done   (enter condition WorkTicks >= MinTicks, task "Done" that does not count ticks)
	 * With bBroken the Work state also gets a task whose Context property no schema context object can satisfy.
	 * Returns null when the asset or its root state could not be made.
	 */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static UStateTree* CreateTree(const FString& PackagePath, const FString& AssetName, int32 MinTicks, bool bBroken);

	/** Compiles the tree and returns the result with the compiler messages; the messages are also dumped to the log. */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static FStateTreeBridgeCompileResult CompileTree(UStateTree* Tree);

	/** True when the tree is linked and can run (the compiled data is present). */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static bool IsReadyToRun(const UStateTree* Tree);

	/** True when the editor data changed since the last successful compile. */
	UFUNCTION(BlueprintCallable, Category = "StateTreeBridge")
	static bool NeedsRecompile(const UStateTree* Tree);
};
