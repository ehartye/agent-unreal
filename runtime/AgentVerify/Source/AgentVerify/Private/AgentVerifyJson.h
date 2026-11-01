#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "AgentVerifyRunner.h"

namespace AgentVerify::Json
{
    using FObject = TSharedPtr<FJsonObject>;
    using FValue = TSharedPtr<FJsonValue>;
    using FArray = TArray<FValue>;
    inline FObject Object() { return MakeShared<FJsonObject>(); }
    inline FValue Value(const FObject& O) { return MakeShared<FJsonValueObject>(O); }
    inline FValue Null() { return MakeShared<FJsonValueNull>(); }
    inline FValue Text(const FString& S) { return MakeShared<FJsonValueString>(S); }
    inline FArray Strings(const TArray<FString>& Items) { FArray Out; for (const auto& Item : Items) Out.Add(Text(Item)); return Out; }
    inline FObject Issue(const FString& Code, const FString& Path, const FString& Message)
    {
        auto Out = Object(); Out->SetStringField(TEXT("code"), Code); Out->SetStringField(TEXT("path"), Path); Out->SetStringField(TEXT("message"), Message); return Out;
    }
    bool Parse(const FString& Text, FValue& Out);
    FString Serialize(const FValue& Value);
    FString Hash(const TArray<uint8>& Bytes);
    FString PluginRoot();
    bool ReadJson(const FString& Path, FValue& Out, TArray<uint8>* Bytes = nullptr);
    bool Save(const FString& Path, const FObject& Object);
    bool SafePath(const FString& Path);
    bool Token(const FString& Text);
    TArray<FAgentVerifyIssue> Schema(const FValue& Input, const FObject& Shape, const FString& Path = TEXT("$"));
    bool Source(FObject& Out, FString& Error);
}
