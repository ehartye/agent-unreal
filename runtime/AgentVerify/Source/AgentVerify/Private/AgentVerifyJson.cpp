#include "AgentVerifyJson.h"
#include "HAL/PlatformFileManager.h"
#include "IPlatformCrypto.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Internationalization/Regex.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace AgentVerify::Json
{
    bool Parse(const FString& InText, FValue& Out)
    {
        const auto Reader = TJsonReaderFactory<>::Create(InText);
        return FJsonSerializer::Deserialize(Reader, Out) && Out.IsValid();
    }
    FString Serialize(const FValue& InValue)
    {
        FString Out;
        auto Writer = TJsonWriterFactory<>::Create(&Out);
        FJsonSerializer::Serialize(InValue.ToSharedRef(), TEXT(""), Writer);
        return Out;
    }
    FString Hash(const TArray<uint8>& Bytes)
    {
        // The generic platform SHA256 entry point is a stub on some supported platforms.
        auto* Crypto = FModuleManager::LoadModulePtr<IPlatformCrypto>(TEXT("PlatformCrypto"));
        if (!Crypto) return FString();
        auto Context = Crypto->CreateContext();
        TArray<uint8> Digest;
        if (!Context || !Context->CalcSHA256(MakeArrayView(Bytes), Digest) || Digest.Num() != 32) return FString();
        return BytesToHex(Digest.GetData(), Digest.Num()).ToLower();
    }
    FString PluginRoot()
    {
        auto Plugin = IPluginManager::Get().FindPlugin(TEXT("AgentVerify"));
        return Plugin.IsValid() ? FPaths::ConvertRelativePathToFull(Plugin->GetBaseDir()) : FString();
    }
    bool ReadJson(const FString& Path, FValue& Out, TArray<uint8>* SuppliedBytes)
    {
        TArray<uint8> Bytes;
        if (!FFileHelper::LoadFileToArray(Bytes, *Path)) return false;
        if (SuppliedBytes) *SuppliedBytes = Bytes;
        FString TextData;
        FFileHelper::BufferToString(TextData, Bytes.GetData(), Bytes.Num());
        return Parse(TextData, Out);
    }
    bool Save(const FString& Path, const FObject& InObject)
    {
        FString Data;
        auto Writer = TJsonWriterFactory<>::Create(&Data);
        return FJsonSerializer::Serialize(InObject.ToSharedRef(), Writer) && FFileHelper::SaveStringToFile(Data, *Path, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
    }
    bool Token(const FString& TextData)
    {
        FRegexMatcher Match(FRegexPattern(TEXT("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")), TextData);
        return Match.FindNext();
    }
    bool SafePath(const FString& Path)
    {
        if (Path.IsEmpty() || Path.StartsWith(TEXT("/")) || Path.Contains(TEXT("\\")) || Path.Contains(TEXT(":"))) return false;
        for (TCHAR C : Path) if (C < 32) return false;
        TArray<FString> Parts; Path.ParseIntoArray(Parts, TEXT("/"), false);
        for (const auto& Part : Parts) if (Part.IsEmpty() || Part == TEXT(".") || Part == TEXT("..") || Part.EndsWith(TEXT(".")) || Part.EndsWith(TEXT(" "))) return false;
        return true;
    }
    TArray<FAgentVerifyIssue> Schema(const FValue& Input, const FObject& Shape, const FString& Path)
    {
        TArray<FAgentVerifyIssue> Issues;
        auto Add = [&](const FString& Code, const FString& Message) { Issues.Add({Code, Path, Message}); };
        const FValue V = Input.IsValid() ? Input : Null();
        const FArray* Alternatives = nullptr;
        if (Shape->TryGetArrayField(TEXT("oneOf"), Alternatives))
        {
            int Matches = 0;
            for (const auto& Alternative : *Alternatives) if (Schema(V, Alternative->AsObject(), Path).IsEmpty()) ++Matches;
            if (Matches != 1) Add(TEXT("schema.union"), TEXT("Must match exactly one documented variant"));
            return Issues;
        }
        FString Type;
        if (Shape->TryGetStringField(TEXT("type"), Type))
        {
            bool Match = (Type == TEXT("null") && V->Type == EJson::Null) || (Type == TEXT("object") && V->Type == EJson::Object) ||
                (Type == TEXT("array") && V->Type == EJson::Array) || (Type == TEXT("string") && V->Type == EJson::String) ||
                (Type == TEXT("boolean") && V->Type == EJson::Boolean) ||
                ((Type == TEXT("number") || Type == TEXT("integer")) && V->Type == EJson::Number && FMath::IsFinite(V->AsNumber()));
            if (Match && Type == TEXT("integer")) Match = FMath::FloorToDouble(V->AsNumber()) == V->AsNumber() && FMath::Abs(V->AsNumber()) <= 9007199254740991.0;
            if (!Match) { Add(TEXT("schema.type"), TEXT("Expected ") + Type); return Issues; }
        }
        if (const FValue Constant = Shape->TryGetField(TEXT("const")); Constant.IsValid())
            if (!FJsonValue::CompareEqual(*V, *Constant)) Add(TEXT("schema.const"), TEXT("Constant differs"));
        const FArray* Allowed = nullptr;
        if (Shape->TryGetArrayField(TEXT("enum"), Allowed))
        {
            bool Found = false;
            for (const auto& Candidate : *Allowed) Found |= FJsonValue::CompareEqual(*V, *Candidate);
            if (!Found) Add(TEXT("schema.enum"), TEXT("Not a documented enumeration value"));
        }
        if (V->Type == EJson::Number)
        {
            double Bound;
            if (Shape->TryGetNumberField(TEXT("minimum"), Bound) && V->AsNumber() < Bound) Add(TEXT("schema.minimum"), TEXT("Below minimum"));
            if (Shape->TryGetNumberField(TEXT("exclusiveMinimum"), Bound) && V->AsNumber() <= Bound) Add(TEXT("schema.minimum"), TEXT("Must exceed minimum"));
            if (Shape->TryGetNumberField(TEXT("maximum"), Bound) && V->AsNumber() > Bound) Add(TEXT("schema.maximum"), TEXT("Above maximum"));
        }
        if (V->Type == EJson::String)
        {
            const FString S = V->AsString(); double Length;
            if (Shape->TryGetNumberField(TEXT("minLength"), Length) && S.Len() < Length) Add(TEXT("schema.length"), TEXT("String too short"));
            if (Shape->TryGetNumberField(TEXT("maxLength"), Length) && S.Len() > Length) Add(TEXT("schema.length"), TEXT("String too long"));
            FString Pattern;
            if (Shape->TryGetStringField(TEXT("pattern"), Pattern)) { FRegexMatcher Match(FRegexPattern(Pattern), S); if (!Match.FindNext()) Add(TEXT("schema.pattern"), TEXT("String does not match pattern")); }
        }
        if (V->Type == EJson::Array)
        {
            const auto& Items = V->AsArray(); double Count;
            if (Shape->TryGetNumberField(TEXT("minItems"), Count) && Items.Num() < Count) Add(TEXT("schema.count"), TEXT("Too few items"));
            if (Shape->TryGetNumberField(TEXT("maxItems"), Count) && Items.Num() > Count) Add(TEXT("schema.count"), TEXT("Too many items"));
            const FObject* ItemShape = nullptr;
            if (Shape->TryGetObjectField(TEXT("items"), ItemShape)) for (int Index = 0; Index < Items.Num(); ++Index) Issues.Append(Schema(Items[Index], *ItemShape, FString::Printf(TEXT("%s[%d]"), *Path, Index)));
        }
        if (V->Type == EJson::Object)
        {
            const auto O = V->AsObject(); const FArray* Required = nullptr;
            if (Shape->TryGetArrayField(TEXT("required"), Required)) for (const auto& Key : *Required) if (!O->HasField(Key->AsString())) Issues.Add({TEXT("schema.required"), Path + TEXT(".") + Key->AsString(), TEXT("Required field is missing")});
            const FObject* Properties = nullptr; Shape->TryGetObjectField(TEXT("properties"), Properties);
            bool Additional = true; Shape->TryGetBoolField(TEXT("additionalProperties"), Additional);
            for (const auto& Field : O->Values)
            {
                const FValue Child = Properties ? (*Properties)->TryGetField(Field.Key) : nullptr;
                if (Child.IsValid()) Issues.Append(Schema(Field.Value, Child->AsObject(), Path + TEXT(".") + Field.Key));
                else if (!Additional) Issues.Add({TEXT("schema.unknown"), Path + TEXT(".") + Field.Key, TEXT("Unknown field")});
            }
        }
        return Issues;
    }
    bool Source(FObject& Out, FString& Error)
    {
        const FString Root = PluginRoot(); FValue Manifest, Shape; TArray<uint8> ManifestBytes;
        if (Root.IsEmpty() || !ReadJson(Root / TEXT("source-version.json"), Manifest, &ManifestBytes) || !ReadJson(Root / TEXT("Resources/source-v1.schema.json"), Shape) || Shape->Type != EJson::Object || !Schema(Manifest, Shape->AsObject()).IsEmpty()) { Error = TEXT("source_manifest_invalid"); return false; }
        TSet<FString> Expected, Lower; TArray<FString> Modified;
        for (const auto& Row : Manifest->AsObject()->GetArrayField(TEXT("files")))
        {
            const auto File = Row->AsObject(); const auto Path = File->GetStringField(TEXT("path"));
            if (!SafePath(Path) || Path.Equals(TEXT("source-version.json"), ESearchCase::IgnoreCase) || Lower.Contains(Path.ToLower())) { Error = TEXT("source_manifest_path"); return false; }
            Lower.Add(Path.ToLower()); Expected.Add(Path); TArray<uint8> Bytes;
            if (!FFileHelper::LoadFileToArray(Bytes, *(Root / Path))) { Modified.Add(Path); continue; }
            const FString Digest = Hash(Bytes);
            if (Digest.Len() != 64) { Error = TEXT("source_hash_unavailable"); return false; }
            if (Digest != File->GetStringField(TEXT("sha256"))) Modified.Add(Path);
        }
        TArray<FString> Actual;
        for (const FString Folder : {TEXT("Source"), TEXT("Config"), TEXT("Resources"), TEXT("Content")}) IFileManager::Get().FindFilesRecursive(Actual, *(Root / Folder), TEXT("*"), true, false);
        TArray<FString> Descriptors; IFileManager::Get().FindFiles(Descriptors, *(Root / TEXT("*.uplugin")), true, false);
        for (const auto& Path : Descriptors) Actual.Add(Root / Path);
        for (auto Path : Actual)
        {
            FPaths::MakePathRelativeTo(Path, *(Root + TEXT("/"))); FPaths::NormalizeFilename(Path);
            if (!Expected.Contains(Path)) Modified.AddUnique(Path);
        }
        Modified.Sort();
        Out = Object(); Out->SetStringField(TEXT("plugin_version"), Manifest->AsObject()->GetStringField(TEXT("plugin_version")));
        Out->SetStringField(TEXT("manifest_sha256"), Hash(ManifestBytes)); Out->SetStringField(TEXT("state"), Modified.IsEmpty() ? TEXT("pristine") : TEXT("modified")); Out->SetArrayField(TEXT("modified_files"), Strings(Modified));
        if (Out->GetStringField(TEXT("manifest_sha256")).Len() != 64) { Error = TEXT("source_hash_unavailable"); return false; }
        return true;
    }
}
