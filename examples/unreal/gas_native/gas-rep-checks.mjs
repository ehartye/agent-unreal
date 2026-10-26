// Judges what gas_rep.mjs collects for the replicated-play scenario (module/GasNative/GasNativeRep.cpp): the build, the two receipts (one
// per process) and the two logs. Pure functions, no Unreal, no dependencies; the node test feeds them receipts shaped like the ones the
// scenario writes. Run on Unreal 5.8.4: the asserted checks held on that run. The expectations come from engine source (cited per check) and a check
// whose outcome the source does not pin is `observe` (recorded and printed, never asserted).
//
//   server receipt: { role: "server", net_mode, client_joined, player_count, phases: { joined, after } }
//   client receipt: { role: "client", net_mode, phases: { before, after }, activation: { had_spec, try_activate_returned, predicted_count_right_after_call } }
//   a phase is AGasNativeRepPlayerState::Snapshot(): net_mode, local_role, remote_role, has_authority, replication_mode, ability_count,
//   rep_ability_present, effect_count, buff_tag, attribute_set_found, energy_current, energy_base, activations_authority, activations_predicted, ...

const GA = 'Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/';

/** Server game mode and map. The engine content map is used so the throwaway project needs no assets of its own. */
export const MAP = '/Engine/Maps/Entry';
export const GAME_MODE = '/Script/GasNative.GasNativeRepGameMode';

const COMMON = ['-unattended', '-nosplash', '-nosound', '-notraceserver', '-nopause'];

/**
 * The command line of the dedicated server. `-server` makes IsRunningDedicatedServer() true in an editor build and `-game` runs the
 * editor binary as a game (Engine/Source/Runtime/Core/Private/Misc/CoreMisc.cpp, StaticDedicatedServerCheck and StaticGameCheck);
 * `-Port=` overrides the URL port (FUrlConfig::Init in the same file); the map option `?game=` names the game mode class. `-log` is left
 * out: it only opens a console window, and `-abslog=` writes the log file either way.
 */
export function serverArguments({ uproject, port, receipt, log }) {
  return [uproject, `${MAP}?game=${GAME_MODE}`, '-server', '-game', `-Port=${port}`, '-nullrhi', `-RepReceipt=${receipt}`, `-abslog=${log}`, ...COMMON];
}

/** The command line of the client: the first plain token is the URL to connect to; `-nullrhi` unless `render` asks for an off-screen renderer. */
export function clientArguments({ uproject, port, receipt, log, render = false }) {
  return [uproject, `127.0.0.1:${port}`, '-game', render ? '-RenderOffScreen' : '-nullrhi', '-windowed', '-ResX=640', '-ResY=360', `-RepReceipt=${receipt}`, `-abslog=${log}`, ...COMMON];
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const phase = (receipt, name) => receipt?.phases?.[name];
const fatal = (log) => /Fatal error/.test(log ?? '');

/**
 * Observations the source predicts but does not pin; printed beside what the run saw.
 * `path` is read from the receipt of `side`.
 */
export const OBSERVATIONS = [
  { name: 'client activation had the granted spec', side: 'client', path: ['activation', 'had_spec'], expect: true, source: `${GA}Private/AbilitySystemComponent.cpp:1861`, why: 'ActivatableAbilities replicates to the owner (COND_ReplayOrOwner)' },
  { name: 'client TryActivateAbilityByClass returned', side: 'client', path: ['activation', 'try_activate_returned'], expect: true, source: `${GA}Public/Abilities/GameplayAbility.h:715`, why: 'NetExecutionPolicy LocalPredicted lets the client activate before the server answers' },
  { name: 'client actor info knows its controller before the call', side: 'client', path: ['phases', 'before', 'actor_info_locally_controlled'], expect: true, source: `${GA}Private/AbilitySystemComponent_Abilities.cpp:1645`, why: 'LocalPredicted activation needs IsLocallyControlled on the actor info' },
  { name: 'client TryActivateAbilityByClass returned after InitAbilityActorInfo with the pawn as avatar', side: 'client', path: ['activation', 'try_activate_after_reinit'], optional: true, expect: true, source: `${GA}Private/Abilities/GameplayAbility.cpp:463`, why: 'CanActivateAbility refuses when the avatar actor is a simulated proxy; a player state is one on its owning client, a pawn is an autonomous proxy' },
  { name: 'client prediction ran at the call', side: 'client', path: ['activation', 'predicted_count_right_after_call'], expect: 1, source: `${GA}Public/Abilities/GameplayAbility.h:715`, why: 'a locally predicted activation runs ActivateAbility on the client first' },
  { name: 'client predicted activations after settling', side: 'client', path: ['phases', 'after', 'activations_predicted'], expect: 1, source: `${GA}Public/Abilities/GameplayAbility.h:715`, why: 'the same count, read again after the settle time' },
  { name: 'server authority activations', side: 'server', path: ['phases', 'after', 'activations_authority'], expect: 1, source: `${GA}Public/Abilities/GameplayAbility.h:715`, why: 'the client asks the server, which runs the ability with authority' },
  { name: 'server Energy base after the cost', side: 'server', path: ['phases', 'after', 'energy_base'], expect: 90, source: 'module/GasNative/GasNativeRep.cpp (UGasNativeRepCostEffect)', why: '100 minus the 10 Energy cost' },
  { name: 'server Energy current after the cost', side: 'server', path: ['phases', 'after', 'energy_current'], expect: 95, source: 'module/GasNative/GasNativeRep.cpp (UGasNativeRepBuffEffect)', why: 'base 90 plus the infinite +5 buff' },
  { name: 'client Energy base after settling', side: 'client', path: ['phases', 'after', 'energy_base'], expect: 90, source: `${GA}Public/AttributeSet.h:402`, why: 'the replicated attribute data carries the base value' },
  { name: 'client Energy current after settling', side: 'client', path: ['phases', 'after', 'energy_current'], expect: 95, source: `${GA}Public/AttributeSet.h:402`, why: 'the replicated attribute data carries the current value' },
  { name: 'client activations with authority', side: 'client', path: ['phases', 'after', 'activations_authority'], expect: 0, source: `${GA}Public/Abilities/GameplayAbilityTypes.h:171`, why: 'IsNetAuthority is false on a client, so its activation counts as a prediction' },
  // Readings with no expectation: printed so the first run shows the roles, not asserted.
  { name: 'server player state local role', side: 'server', path: ['phases', 'after', 'local_role'] },
  { name: 'client player state local role', side: 'client', path: ['phases', 'before', 'local_role'] },
  { name: 'client player state remote role', side: 'client', path: ['phases', 'before', 'remote_role'] },
  { name: 'client avatar local role before', side: 'client', path: ['phases', 'before', 'avatar_local_role'] },
  { name: 'client pawn local role', side: 'client', path: ['phases', 'before', 'pawn_local_role'] },
  { name: 'client has a player controller', side: 'client', path: ['phases', 'before', 'has_player_controller'] },
  { name: 'client controller is local', side: 'client', path: ['phases', 'before', 'is_local_controller'] },
  { name: 'client avatar actor is the player state', side: 'client', path: ['phases', 'before', 'asc_avatar_is_player_state'] },
];

const dig = (obj, path) => path.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

/** Rows for the console: what each observation saw, with the source-derived expectation beside it. */
export function observationRows({ server, client }) {
  return OBSERVATIONS.map((o) => {
    const receipt = o.side === 'server' ? server : client;
    const observed = dig(receipt, o.path);
    return { name: o.name, side: o.side, optional: !!o.optional, observed, expect: o.expect, matches: 'expect' in o && !(o.optional && observed === undefined) ? observed === o.expect : undefined, source: o.source, why: o.why };
  });
}

/**
 * `pie` is the Python read-back of the Play In Editor settings (gas_rep_pie_readback.py), or undefined when it was not requested.
 * A server and a client that never started are reported by the `ran` checks; the replication checks then fail on the missing receipt.
 */
export function evaluate({ build, server, client, serverLog = '', clientLog = '', serverExit, clientExit, pie, pieRequested = false }) {
  const joined = phase(server, 'joined');
  const serverAfter = phase(server, 'after');
  const before = phase(client, 'before');
  const after = phase(client, 'after');
  const checks = [];
  const check = (name, claim, pass, detail) => checks.push({ name, claim, pass: !!pass, detail });

  check('module compiles', 'UBT builds the editor target with the replication code (GameplayAbilities, NetCore) in the module dependencies',
    build?.exit === 0 && /Result: Succeeded/.test(build?.log ?? ''), `exit ${build?.exit}`);
  // The exit codes are reported, not judged: a process that wrote its receipt and then hung is a shutdown problem, not a replication result.
  check('both processes ran', 'the dedicated server and the client each start, write a receipt and leave no fatal error in their logs',
    !!server && !!client && !fatal(serverLog) && !fatal(clientLog),
    `server exit ${serverExit ?? 'killed or running'}, receipt ${server ? 'written' : 'missing'}${fatal(serverLog) ? ', fatal error in the log' : ''}; client exit ${clientExit ?? 'killed or running'}, receipt ${client ? 'written' : 'missing'}${fatal(clientLog) ? ', fatal error in the log' : ''}`);
  check('server is a dedicated server and the client joined', 'the server receipt says DedicatedServer and a joined client; the client receipt says Client',
    server?.net_mode === 'DedicatedServer' && server?.client_joined === true && server?.player_count_at_after >= 1 && client?.net_mode === 'Client',
    `server ${server?.net_mode}, joined ${server?.client_joined}, players ${server?.player_count_at_after}; client ${client?.net_mode}`);
  check('server grants and applies', 'on the server the player state\'s component is in Mixed mode, owned by the player state, holds the granted ability and the active buff, and Energy reads 105 (100 base plus 5)',
    joined?.has_authority === true && joined?.replication_mode === 'Mixed' && joined?.asc_owner_is_player_state === true && joined?.rep_ability_present === true
    && joined?.ability_count === 1 && joined?.effect_count === 1 && joined?.buff_tag === true && joined?.energy_current === 105 && joined?.energy_base === 100,
    `mode ${joined?.replication_mode}; abilities ${joined?.ability_count}; effects ${joined?.effect_count}; buff ${joined?.buff_tag}; Energy ${joined?.energy_current}/${joined?.energy_base}`);
  check('Mixed mode on the client', 'the client\'s copy of the component is in Mixed mode and owned by its player state',
    before?.replication_mode === 'Mixed' && before?.asc_owner_is_player_state === true && before?.asc_replicates === true,
    `mode ${before?.replication_mode}; owner is player state ${before?.asc_owner_is_player_state}; replicates ${before?.asc_replicates}`);
  check('granted ability replicates to the owning client', 'the client\'s component lists the ability the server granted (ActivatableAbilities, COND_ReplayOrOwner)',
    before?.rep_ability_present === true && before?.ability_count === 1, `present ${before?.rep_ability_present}; count ${before?.ability_count}`);
  check('active effect replicates to the owning client', 'the client sees the infinite buff as an active effect and owns its granted tag (Mixed: full effect info to the owner)',
    before?.effect_count === 1 && before?.buff_tag === true, `effects ${before?.effect_count}; buff tag ${before?.buff_tag}`);
  check('attribute value replicates to the client', 'the client\'s attribute set exists and Energy reads 105 current and 100 base before the activation',
    before?.attribute_set_found === true && before?.energy_current === 105 && before?.energy_base === 100,
    `set ${before?.attribute_set_found}; Energy ${before?.energy_current}/${before?.energy_base}`);
  check('client and server agree after the activation', 'after the settle time the client reads the same Energy (current and base) as the server',
    isNumber(after?.energy_current) && isNumber(serverAfter?.energy_current) && after.energy_current === serverAfter.energy_current && after.energy_base === serverAfter.energy_base,
    `client ${after?.energy_current}/${after?.energy_base}; server ${serverAfter?.energy_current}/${serverAfter?.energy_base}`);
  const rows = observationRows({ server, client });
  check('client activation recorded (observe)', 'the receipts hold every reading of the client-side activation; the outcome is printed against the source-derived expectation and not asserted',
    rows.every((r) => r.observed !== undefined || r.optional), `${rows.filter((r) => r.observed !== undefined).length} of ${rows.length} readings present (the re-initialised activation is optional: it is recorded only when the first call is refused); ${rows.filter((r) => r.matches === true).length} of ${rows.filter((r) => r.matches !== undefined).length} match the expectation`);
  if (pieRequested) {
    check('PIE settings read back (observe)', 'Python reads LevelEditorPlaySettings without starting Play In Editor; every value is printed and none is asserted',
      !!pie && typeof pie.class_found === 'boolean' && typeof pie.reads === 'object' && pie.reads !== null, pie ? `class found ${pie.class_found}; ${Object.keys(pie.reads ?? {}).length} properties read` : 'no read-back report');
  }
  return checks;
}

export function summarize(checks) {
  return { passed: checks.filter((x) => x.pass).length, total: checks.length };
}
