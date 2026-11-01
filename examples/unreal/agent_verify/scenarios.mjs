const check = (id, metric, min, max, aggregation = 'last') => ({ id, metric, aggregation, min, max });
const phase = (name, seconds, checks, actions = [], extra = {}) => ({ name, seconds, measure: true, actions, checks, ...extra });
const command = (at, value) => ({ at, type: 'command', token: 'sample.tone', args: [value] });
const document = (id, kind, phases) => ({ schema_version: 1, request_id: id, kind, warmup: { min_seconds: .1, max_seconds: 60 }, settle: { min_seconds: .1, max_seconds: 60 }, save_sandbox: false, cache: { requested: 'unclassified', preparation: 'No cache preparation requested; functional sample only' }, phases });

export function scenarios() {
  const movement = document('mapped-input', 'replay', [phase('move', 1, [check('travel', 'position_x', 20, 100), check('mark', 'marks', 1, 1)], [{ at: 0, type: 'axis', key: 'Gamepad_LeftX', value: .5 }, { at: 0, type: 'key', key: 'SpaceBar', down: true }])]);
  const smoke = document('smoke', 'observation', [phase('observe', .3, [check('scene', 'scene_ready', 1, 1)])]);
  const shot = document('shot', 'shot', [phase('observe', .3, [check('visible-scene', 'scene_ready', 1, 1)], [], { capture: { id: 'scene-shot', wait_seconds: .1 } })]);
  const audio = document('master-mix', 'observation', [
    phase('silence', 1, [], [], { audio: { id: 'silence', min_rms_db: -120, max_rms_db: -80 } }),
    phase('tone', 2, [], [command(0, '1')], { audio: { id: 'tone', min_rms_db: -45, max_rms_db: -5 } }),
  ]);
  const malformed = structuredClone(movement); malformed.request_id = 'invalid-version'; malformed.schema_version = 99;
  const metric = structuredClone(movement); metric.request_id = 'unknown-metric'; metric.phases[0].checks[0].metric = 'does_not_exist';
  const token = structuredClone(movement); token.request_id = 'unknown-command'; token.phases[0].actions.push({ at: .1, type: 'command', token: 'does.not.exist', args: [] });
  const unavailable = document('unavailable-metric', 'observation', [phase('observe', .3, [check('missing', 'unavailable', 0, 0)])]);
  const cancelled = structuredClone(movement); cancelled.request_id = 'cancelled-input'; cancelled.phases[0].seconds = 2;
  const absent = structuredClone(audio); absent.request_id = 'absent-audio';
  return [
    { id: 'input', document: movement, outcome: 'passed', audio: false, mapped: true },
    { id: 'smoke', document: smoke, outcome: 'passed', audio: false },
    { id: 'shot', document: shot, outcome: 'passed', audio: false },
    { id: 'audio', document: audio, outcome: 'passed', audio: true },
    { id: 'invalid-version', document: malformed, outcome: 'rejected', refusal: { code: 'schema.const', path: '$.schema_version' }, audio: false },
    { id: 'unknown-metric', document: metric, outcome: 'rejected', refusal: { code: 'unknown_metric', path: '$.phases[0].checks[0].metric' }, audio: false },
    { id: 'unknown-command', document: token, outcome: 'rejected', refusal: { code: 'unknown_command', path: '$.phases[0].actions[2].token' }, audio: false },
    { id: 'unavailable', document: unavailable, outcome: 'failed', audio: false },
    { id: 'cancelled', document: cancelled, outcome: 'failed', audio: false, cancelAfter: .65, mapped: true },
    { id: 'absent-audio', document: absent, outcome: 'failed', audio: false },
  ];
}
