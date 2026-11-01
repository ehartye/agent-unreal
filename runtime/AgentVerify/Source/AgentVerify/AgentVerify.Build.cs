using UnrealBuildTool;
using System.IO;

public class AgentVerify : ModuleRules
{
    public AgentVerify(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "Json" });
        PrivateDependencyModuleNames.AddRange(new[] { "InputCore", "Projects", "RHI", "AudioMixer", "SignalProcessing", "PlatformCrypto", "PlatformCryptoContext" });
        // The receipt identifies the actual supplied source, also in a staged Development game.
        RuntimeDependencies.Add(Path.Combine(PluginDirectory, "source-version.json"), StagedFileType.NonUFS);
        RuntimeDependencies.Add(Path.Combine(PluginDirectory, "AgentVerify.uplugin"), StagedFileType.NonUFS);
        RuntimeDependencies.Add(Path.Combine(PluginDirectory, "Resources", "..."), StagedFileType.NonUFS);
        RuntimeDependencies.Add(Path.Combine(PluginDirectory, "Source", "..."), StagedFileType.NonUFS);
    }
}
