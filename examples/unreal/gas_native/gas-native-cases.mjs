// The effect-component cases of the GasNativeProbe commandlet (module/GasNative/GasNativeCases.cpp): what each case is expected to
// show, written from engine source before any engine run, and the pure judge that compares it with the report. No Unreal, no
// dependencies. The probe records only what it observed; the expectation lives here so a run cannot grade itself.
//
// A case has:
//   id, component, role   as the probe writes them ("effect" for the component under test, "control" for the same effect without it)
//   mode "assert"         every key in `expect` must equal the observed value
//   mode "observe"        the case must be recorded; `expect` is what source reading suggests, printed beside the observation but
//                         not asserted (the header or source does not pin the outcome, or the route to it is a guess)
//   source                install-relative path:line of the engine text the expectation comes from
// Keys the probe records that are not in `expect` are shown in the case table and not judged.

const GA = 'Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/';
const H = `${GA}Public/GameplayEffectComponents/`;
const C = `${GA}Private/GameplayEffectComponents/`;
const E = `${GA}Private/GameplayEffect.cpp`;
const ASC = `${GA}Private/AbilitySystemComponent.cpp`;

export const COMPONENTS = [
  { name: 'AssetTags', claim: 'Asset Tags stay on the effect definition and are not granted to the target' },
  { name: 'Immunity', claim: 'an active Immunity component refuses an effect whose asset tags match its query, calls the block delegate, lets other effects through and stops blocking when it is removed' },
  { name: 'AdditionalEffects', claim: 'Additional Effects applies its extra effects on application (unless a required source tag is missing) and on completion by list: Normal only on expiry, Prematurely only on early removal, Always on both' },
  { name: 'BlockAbilityTags', claim: 'Block Abilities with Tags puts its tags on the effect definition and refuses the activation of an ability with a matching asset tag while the effect lasts' },
  { name: 'CancelAbilityTags', claim: 'Cancel Abilities with Tags ends an active ability whose asset tags match when the effect is applied and leaves other abilities alone' },
  { name: 'ChanceToApply', claim: 'Chance To Apply with chance 0 never lets the effect apply and with chance 1 always does' },
  { name: 'CustomCanApply', claim: 'Custom Can Apply refuses the effect until its requirement class returns true' },
  { name: 'RemoveOther', claim: 'Remove Other Effects removes the active effects its query matches when the owning effect applies and leaves the others' },
  { name: 'TargetTagRequirements', claim: 'Require Tags refuses an effect without the tag at application, inhibits and un-inhibits it as the tag comes and goes (ongoing), and removes it and refuses it again when the removal tag is present' },
  { name: 'Abilities', claim: 'Grant Gameplay Abilities gives the target the ability while the effect lasts and takes it away with the effect' },
];

const assertCase = (id, component, role, expect, source, why) => ({ id, component, role, mode: 'assert', expect, source, why });
const observeCase = (id, component, role, expect, source, why) => ({ id, component, role, mode: 'observe', expect, source, why });

export const CASES = [
  // ---- Asset Tags
  assertCase('asset_tags', 'AssetTags', 'effect', { applied: true, tag_on_definition: true, target_owns_tag: false }, `${H}AssetTagsGameplayEffectComponent.h:11`, 'asset tags are the effect\'s own and do not transfer to any actor'),
  assertCase('asset_tags_control', 'AssetTags', 'control', { applied: true, tag_on_definition: false, target_owns_tag: false }, `${H}AssetTagsGameplayEffectComponent.h:11`, 'no component, no asset tag'),

  // ---- Immunity
  assertCase('immunity_blocks', 'Immunity', 'effect', { immunity_applied: true, victim_applied: false, victim_tag_owned: false, block_delegate_count: 1 }, `${C}ImmunityGameplayEffectComponent.cpp:48`, 'the registered application query returns false for a spec whose asset tags match, and broadcasts the delegate'),
  assertCase('immunity_control', 'Immunity', 'control', { victim_applied: true, victim_tag_owned: true, block_delegate_count: 0 }, `${ASC}:1037`, 'with no immunity effect the application queries are empty'),
  assertCase('immunity_unrelated_effect', 'Immunity', 'effect', { other_applied: true, other_tag_owned: true, block_delegate_count: 0 }, `${C}ImmunityGameplayEffectComponent.cpp:65`, 'only a spec the query matches is refused'),
  assertCase('immunity_removed', 'Immunity', 'effect', { blocked_while_active: true, victim_applied_after_removal: true, victim_tag_owned: true }, `${C}ImmunityGameplayEffectComponent.cpp:30`, 'the removal callback takes the query out of the component\'s list'),

  // ---- Additional Effects
  assertCase('additional_on_application', 'AdditionalEffects', 'effect', { main_applied: true, extra_tag_owned: true }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:24`, 'OnApplication entries are applied to the target when the owner applies'),
  assertCase('additional_on_application_control', 'AdditionalEffects', 'control', { main_applied: true, extra_tag_owned: false }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:24`, 'no component, no extra effect'),
  observeCase('additional_source_tag_met', 'AdditionalEffects', 'effect', { extra_tag_owned: true }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:44`, 'the source tags are captured from the instigator component, here the target itself; the capture path was not read to the end'),
  assertCase('additional_source_tag_unmet', 'AdditionalEffects', 'effect', { extra_tag_owned: false }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:44`, 'RequiredSourceTags the source does not own: CanApply is false'),
  assertCase('additional_complete_normal_expired', 'AdditionalEffects', 'effect', { main_active_at_0_2s: true, extra_tag_at_0_2s: false, main_active_at_end: false, extra_tag_at_end: true }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:100`, 'OnCompleteNormal runs when the effect expires (not a premature removal)'),
  assertCase('additional_complete_normal_removed', 'AdditionalEffects', 'effect', { removed_early: true, extra_tag_at_end: false }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:100`, 'a removal by handle is premature (GameplayEffect.cpp:4753), so OnCompleteNormal is not used'),
  assertCase('additional_complete_premature_removed', 'AdditionalEffects', 'effect', { removed_early: true, extra_tag_at_end: true }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:100`, 'OnCompletePrematurely runs on a removal by handle'),
  assertCase('additional_complete_premature_expired', 'AdditionalEffects', 'effect', { main_active_at_end: false, extra_tag_at_end: false }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:100`, 'a natural expiry is not premature'),
  assertCase('additional_complete_always_expired', 'AdditionalEffects', 'effect', { extra_tag_at_end: true }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:104`, 'OnCompleteAlways is appended to either list'),
  assertCase('additional_complete_always_removed', 'AdditionalEffects', 'effect', { removed_early: true, extra_tag_at_end: true }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:104`, 'OnCompleteAlways is appended to either list'),
  assertCase('additional_complete_control', 'AdditionalEffects', 'control', { main_active_at_end: false, extra_tag_at_end: false }, `${C}AdditionalEffectsGameplayEffectComponent.cpp:100`, 'no component, no extra effect on expiry'),

  // ---- Block Abilities with Tags
  assertCase('block_blocks', 'BlockAbilityTags', 'effect', { applied: true, tag_on_definition: true, activation_returned: false, ability_active: false }, `${GA}Private/Abilities/GameplayAbility.cpp:432`, 'the effect blocks its tags on the target (GameplayEffect.cpp:4683) and CanActivateAbility checks the ability\'s asset tags against them'),
  assertCase('block_control', 'BlockAbilityTags', 'control', { applied: true, tag_on_definition: false, activation_returned: true, ability_active: true }, `${GA}Private/Abilities/GameplayAbility.cpp:432`, 'no component, nothing blocked'),
  assertCase('block_removed', 'BlockAbilityTags', 'effect', { blocked_while_active: true, activation_returned_after_removal: true, ability_active: true }, `${E}:4991`, 'removing the effect unblocks the tags'),

  // ---- Cancel Abilities with Tags
  assertCase('cancel_cancels', 'CancelAbilityTags', 'effect', { active_before: true, effect_applied: true, active_after: false }, `${C}CancelAbilityTagsGameplayEffectComponent.cpp:35`, 'OnApplication mode (the default) cancels abilities whose asset tags match; an instant effect is also "applied" (AbilitySystemComponent.cpp:1165)'),
  assertCase('cancel_control', 'CancelAbilityTags', 'control', { active_before: true, active_after: true }, `${C}CancelAbilityTagsGameplayEffectComponent.cpp:35`, 'no component, nothing cancelled'),
  assertCase('cancel_other_tag', 'CancelAbilityTags', 'effect', { active_before: true, active_after: true }, `${GA}Private/AbilitySystemComponent_Abilities.cpp:1340`, 'CancelAbilities matches the ability\'s asset tags against the list'),
  assertCase('cancel_on_application_infinite', 'CancelAbilityTags', 'effect', { active_before: true, active_after: false }, `${H}CancelAbilityTagsGameplayEffectComponent.h:17`, 'OnApplication cancels "regardless of GE duration type"'),
  observeCase('cancel_on_execution_infinite', 'CancelAbilityTags', 'effect', { mode_written: true, active_after: true }, `${C}CancelAbilityTagsGameplayEffectComponent.cpp:47`, 'ComponentMode is private and is written by reflection, a route nobody ran; an infinite effect without a period never executes'),
  observeCase('cancel_on_execution_instant', 'CancelAbilityTags', 'effect', { mode_written: true, active_after: false }, `${E}:3369`, 'ComponentMode is written by reflection; an instant effect executes once'),

  // ---- Chance To Apply
  assertCase('chance_zero', 'ChanceToApply', 'effect', { attempts: 20, applied_count: 0, charge_gained: 0 }, `${C}ChanceToApplyGameplayEffectComponent.cpp:29`, 'chance 0 fails whenever FRand() > 0, which is every roll but an exact 0'),
  assertCase('chance_one', 'ChanceToApply', 'effect', { attempts: 20, applied_count: 20, charge_gained: 20 }, `${C}ChanceToApplyGameplayEffectComponent.cpp:29`, 'a chance within SMALL_NUMBER of 1 skips the roll'),
  assertCase('chance_control', 'ChanceToApply', 'control', { attempts: 20, applied_count: 20, charge_gained: 20 }, `${C}ChanceToApplyGameplayEffectComponent.cpp:29`, 'no component, always applies'),
  observeCase('chance_half', 'ChanceToApply', 'effect', {}, `${C}ChanceToApplyGameplayEffectComponent.cpp:29`, 'random: about 100 of 200 should apply; the count is recorded, not asserted'),

  // ---- Custom Can Apply
  assertCase('custom_refused', 'CustomCanApply', 'effect', { gate_tag_present: false, applied: false, tag_owned: false }, `${C}CustomCanApplyGameplayEffectComponent.cpp:15`, 'the requirement class default object returns false without the gate tag'),
  assertCase('custom_allowed', 'CustomCanApply', 'effect', { gate_tag_present: true, applied: true, tag_owned: true }, `${C}CustomCanApplyGameplayEffectComponent.cpp:15`, 'with the gate tag the requirement returns true'),
  assertCase('custom_control', 'CustomCanApply', 'control', { applied: true, tag_owned: true }, `${C}CustomCanApplyGameplayEffectComponent.cpp:15`, 'no component, applies'),

  // ---- Remove Other Effects
  assertCase('remove_other_removes', 'RemoveOther', 'effect', { remover_applied: true, victim_tag_before: true, victim_tag_after: false, bystander_tag_after: true }, `${C}RemoveOtherGameplayEffectComponent.cpp:18`, 'the owner\'s application removes active effects the query matches (the target must be the authority); a runtime-built owner is not the class default object, so its ignore list is empty (GameplayEffect.cpp:6202)'),
  assertCase('remove_other_control', 'RemoveOther', 'control', { remover_applied: true, victim_tag_before: true, victim_tag_after: true, bystander_tag_after: true }, `${C}RemoveOtherGameplayEffectComponent.cpp:18`, 'no component, nothing removed'),
  observeCase('remove_other_matches_itself', 'RemoveOther', 'effect', { remover_still_active: false, tag_owned: false }, `${C}RemoveOtherGameplayEffectComponent.cpp:28`, 'an infinite remover whose own granted tag matches its query; the ignore list holds only effects of the owner\'s class default object, so a runtime-built remover is probably removed too'),

  // ---- Require Tags to Apply/Continue This Effect
  assertCase('requirements_application_unmet', 'TargetTagRequirements', 'effect', { gate_tag_present: false, applied: false, tag_owned: false }, `${C}TargetTagRequirementsGameplayEffectComponent.cpp:21`, 'ApplicationTagRequirements not met: CanGameplayEffectApply is false'),
  assertCase('requirements_application_met', 'TargetTagRequirements', 'effect', { gate_tag_present: true, applied: true, tag_owned: true }, `${C}TargetTagRequirementsGameplayEffectComponent.cpp:21`, 'requirements met: applies'),
  assertCase('requirements_control', 'TargetTagRequirements', 'control', { applied: true, tag_owned: true }, `${C}TargetTagRequirementsGameplayEffectComponent.cpp:21`, 'no component, applies'),
  assertCase('requirements_ongoing', 'TargetTagRequirements', 'effect', {
    applied: true, tag_owned_without_gate: false, inhibited_without_gate: true, tag_owned_with_gate: true, inhibited_with_gate: false, tag_owned_gate_removed: false, inhibited_gate_removed: true,
  }, `${C}TargetTagRequirementsGameplayEffectComponent.cpp:120`, 'OngoingTagRequirements switch the applied effect off and on as the tag count changes ("can be off and do nothing, but still applied")'),
  assertCase('requirements_removal', 'TargetTagRequirements', 'effect', {
    applied: true, tag_owned_without_gate: true, still_active_with_gate: false, tag_owned_with_gate: false, reapplied_with_gate: false,
  }, `${H}TargetTagRequirementsGameplayEffectComponent.h:55`, 'RemovalTagRequirements removes the effect when met "and also prevents effect application"'),

  // ---- Grant Gameplay Abilities
  assertCase('abilities_granted', 'Abilities', 'effect', { applied: true, spec_before: false, spec_after_apply: true, activation_returned: true }, `${C}AbilitiesGameplayEffectComponent.cpp:60`, 'GrantAbilities gives the target a spec when the effect becomes active'),
  assertCase('abilities_control', 'Abilities', 'control', { applied: true, spec_before: false, spec_after_apply: false, activation_returned: false }, `${C}AbilitiesGameplayEffectComponent.cpp:60`, 'no component, no spec'),
  assertCase('abilities_removed', 'Abilities', 'effect', { spec_after_apply: true, spec_after_removal: false }, `${C}AbilitiesGameplayEffectComponent.cpp:127`, 'the default removal policy CancelAbilityImmediately clears the spec when the effect is removed'),
];

const same = (a, b) => a === b;

/** Compares the probe's `component_cases` rows with CASES. Returns one result per case, in table order. */
export function judgeCases(report) {
  const rows = Array.isArray(report?.component_cases) ? report.component_cases : [];
  const results = [];
  for (const c of CASES) {
    const found = rows.filter((r) => r?.id === c.id);
    const row = found[0];
    const observed = row?.observed && typeof row.observed === 'object' ? row.observed : undefined;
    const result = { id: c.id, component: c.component, role: c.role, mode: c.mode, expect: c.expect, source: c.source, why: c.why, observed, recorded: !!observed, duplicate: found.length > 1, mismatches: [] };
    if (observed && row.component !== c.component) result.mismatches.push({ key: 'component', expected: c.component, observed: row.component });
    if (observed && row.role !== c.role) result.mismatches.push({ key: 'role', expected: c.role, observed: row.role });
    if (observed && c.mode === 'assert') {
      for (const [key, expected] of Object.entries(c.expect)) {
        if (!(key in observed)) result.mismatches.push({ key, expected, observed: undefined });
        else if (!same(observed[key], expected)) result.mismatches.push({ key, expected, observed: observed[key] });
      }
    }
    result.ok = result.recorded && !result.duplicate && result.mismatches.length === 0;
    results.push(result);
  }
  return results;
}

/** Rows in the report whose id is not in the table (a probe that grew a case the judge does not know). */
export function unknownCaseIds(report) {
  const known = new Set(CASES.map((c) => c.id));
  return (Array.isArray(report?.component_cases) ? report.component_cases : []).map((r) => r?.id).filter((id) => !known.has(id));
}

const show = (v) => (v === undefined ? 'missing' : JSON.stringify(v));

/** One line per case for the runner's console table. */
export function describeCase(r) {
  if (!r.recorded) return `${r.id}: not recorded`;
  if (r.mode === 'observe') return `${r.id} [observe]: observed ${show(r.observed)}; expected from source ${show(r.expect)}`;
  if (r.ok) return `${r.id}: ok`;
  return `${r.id}: ${r.duplicate ? 'recorded twice; ' : ''}${r.mismatches.map((m) => `${m.key} expected ${show(m.expected)}, observed ${show(m.observed)}`).join('; ')}`;
}
