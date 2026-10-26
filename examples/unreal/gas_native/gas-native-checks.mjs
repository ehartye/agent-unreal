// Judges what gas_native.mjs collects: the build result, the JSON report that the GasNativeProbe commandlet writes, and its log. Pure
// functions, no Unreal and no dependencies; the node test feeds them reports shaped like the one written on Unreal 5.8.2.
//   report.classes = what the constructors produced (read from class default objects)
//   report.steps   = snapshots of the actor while the scenario ran: { sim_time, charge, cooldown_tag, ability_active, ... }
//   report.component_cases = one row per effect-component case: { id, component, role, observed }; the expectations are in gas-native-cases.mjs
import { COMPONENTS, CASES, judgeCases, unknownCaseIds } from './gas-native-cases.mjs';

const COOLDOWN_TAG = 'GasNative.Cooldown.Pulse';
const ABILITY_TAG = 'GasNative.Ability.Pulse';
const same = (a, b) => Array.isArray(a) && a.length === b.length && b.every((v) => a.includes(v));
const near = (value, expected, tolerance) => typeof value === 'number' && Math.abs(value - expected) <= tolerance;

export function evaluate({ build, report, log = '', exit }) {
  const c = report?.classes;
  const s = report?.steps ?? {};
  const checks = [];
  checks.push({ name: 'module compiles', claim: 'UBT builds the editor target with GameplayAbilities, GameplayTags and GameplayTasks in the module dependencies',
    pass: build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), detail: `exit ${build?.exit}` });
  checks.push({ name: 'probe ran', claim: 'the commandlet loads the module, runs the scenario and writes a report; the log has no fatal error',
    pass: exit === 0 && !!report && !/Fatal error/.test(log), detail: `exit ${exit}; report ${report ? 'written' : 'missing'}` });
  checks.push({ name: 'effect component from the constructor', claim: 'CreateDefaultSubobject plus GEComponents.Add plus SetAndApplyTargetTagChanges in the constructor leaves the effect with one target-tags component that grants the native tag',
    pass: c?.cooldown_component_present === true && same(c?.cooldown_granted_tags, [COOLDOWN_TAG]) && c?.cooldown_has_duration === true,
    detail: `component ${c?.cooldown_component_present}; granted ${JSON.stringify(c?.cooldown_granted_tags)}` });
  checks.push({ name: 'engine raises no constructor warning', claim: 'the log has no "should be added to GEComponents" ensure, no error from the effect classes, and no complaint about SetAssetTags',
    pass: !!report && !/should be added to GEComponents/.test(log) && !/LogGameplayEffects: Error/.test(log) && !/should only be used during construction/.test(log), detail: 'searched the log' });
  checks.push({ name: 'ability tags and wiring', claim: 'SetAssetTags in the constructor sets the asset tag, and the cost and cooldown effect classes resolve; the ability reports the cooldown effect\'s granted tag as its cooldown tag',
    pass: same(c?.ability_asset_tags, [ABILITY_TAG]) && c?.cost_effect_set === true && c?.cooldown_effect_set === true && same(c?.ability_cooldown_tags, [COOLDOWN_TAG]),
    detail: `asset tags ${JSON.stringify(c?.ability_asset_tags)}; cooldown tags ${JSON.stringify(c?.ability_cooldown_tags)}` });
  const first = s.first;
  checks.push({ name: 'ability activates and pays the cost', claim: 'TryActivateAbilityByClass activates the ability and the attribute drops by the cost (100 to 90)',
    pass: s.start?.charge === 100 && first?.activated === true && first?.charge === 90 && first?.ability_active === true, detail: `charge ${s.start?.charge} to ${first?.charge}; activated ${first?.activated}` });
  checks.push({ name: 'cooldown tag present', claim: 'right after activation the target owns the cooldown tag',
    pass: first?.cooldown_tag === true && s.start?.cooldown_tag === false, detail: `before ${s.start?.cooldown_tag}; after ${first?.cooldown_tag}` });
  const refused = s.refused;
  checks.push({ name: 'activation refused during cooldown', claim: 'while the tag is present the ability cannot activate and no second cost is paid',
    pass: refused?.activated === false && refused?.can_activate === false && refused?.charge === 90, detail: `activated ${refused?.activated}; can_activate ${refused?.can_activate}; charge ${refused?.charge}; relevant ${JSON.stringify(refused?.relevant_tags)}` });
  const mid = s.mid_cooldown; const expired = s.expired;
  checks.push({ name: 'tag lasts the cooldown', claim: 'the tag is still present after one second and is gone after two (world time)',
    pass: mid?.cooldown_tag === true && mid?.charge === 90 && expired?.cooldown_tag === false && near(expired?.tag_gone_at, 2.0, 0.15),
    detail: `at ${mid?.sim_time}: ${mid?.cooldown_tag}; gone at ${expired?.tag_gone_at}` });
  checks.push({ name: 'ability task ends the ability', claim: 'the WaitDelay task ends the ability after half a second, long before the cooldown ends',
    pass: near(expired?.ability_ended_at, 0.5, 0.15), detail: `ended at ${expired?.ability_ended_at}` });
  const again = s.again;
  checks.push({ name: 'activates again after the cooldown', claim: 'once the tag has expired the ability activates again and pays the cost again (90 to 80)',
    pass: again?.activated === true && again?.charge === 80 && again?.cooldown_tag === true, detail: `activated ${again?.activated}; charge ${again?.charge}` });
  const dyn = s.runtime_add_component;
  checks.push({ name: 'AddComponent outside a constructor', claim: 'an effect made with NewObject at run time can use AddComponent, and its tag reaches the target',
    pass: dyn?.applied === true && dyn?.tag_present === true, detail: `applied ${dyn?.applied}; tag ${dyn?.tag_present}` });

  // Effect components other than target tags: one check to say every case was recorded, one per component, and one for the log.
  const judged = judgeCases(report);
  const missing = judged.filter((r) => !r.recorded).map((r) => r.id);
  const twice = judged.filter((r) => r.duplicate).map((r) => r.id);
  const unknown = unknownCaseIds(report);
  checks.push({ name: 'component cases recorded', claim: 'the probe recorded every effect-component case in the table, once each, and no case the judge does not know',
    pass: !!report && missing.length === 0 && twice.length === 0 && unknown.length === 0,
    detail: `${judged.length - missing.length} of ${CASES.length} recorded${missing.length ? `; missing ${missing.join(', ')}` : ''}${twice.length ? `; twice ${twice.join(', ')}` : ''}${unknown.length ? `; unknown ${unknown.join(', ')}` : ''}` });
  for (const component of COMPONENTS) {
    const mine = judged.filter((r) => r.component === component.name);
    const asserted = mine.filter((r) => r.mode === 'assert');
    const bad = mine.filter((r) => !r.ok);
    checks.push({ name: `effect component: ${component.name}`, claim: component.claim, pass: !!report && bad.length === 0,
      detail: `${asserted.length - asserted.filter((r) => !r.ok).length} of ${asserted.length} asserted cases held${mine.length > asserted.length ? `, ${mine.length - asserted.length} observed only` : ''}${bad.length ? `; ${bad.map((r) => r.id).join(', ')}` : ''}` });
  }
  checks.push({ name: 'component cases raise no ensure', claim: 'the log has no failed ensure while the component cases run',
    pass: !!report && !/Ensure condition failed/.test(log), detail: 'searched the log for "Ensure condition failed"' });
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((x) => x.pass).length, total: checks.length };
}
