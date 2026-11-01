import { scenarios } from '../agent_verify/scenarios.mjs';

const tests = ['AgentVerify.A2.LiveNamesBeforeActions', 'AgentVerify.A2.RefusalReceiptHasZeroActions', 'AgentVerify.A2.StructuralPrevalidation', 'AgentVerify.A3.EligibilityAndUnavailableMetrics', 'AgentVerify.A3.NearestRankStatistics', 'AgentVerify.A4.FullPhaseAudioRequired', 'AgentVerify.A4.RealFrameHoldAndCompileRestart', 'ObservationSample.Domain.Travel.ReleasedAxisStopsMovement'];
export function fixture({ compiler, sdk }) {
  const selected = scenarios().filter(s => ['input', 'unknown-metric'].includes(s.id));
  const common = { required: true, timeout_seconds: 180 };
  const steps = [
    { ...common, id: 'build', kind: 'build', depends_on: [], timeout_seconds: 600, arguments: [`-CompilerVersion=${compiler}`, `-WindowsSDKVersion=${sdk}`, '-NoUBTMakefiles'], expected_count: 1 },
    { ...common, id: 'automation', kind: 'automation', depends_on: ['build'], arguments: ['-nullrhi', '-nosound', '-unattended', '-notraceserver', '-stdout', '-FullStdOutLogOutput'], filter: 'AgentVerify+ObservationSample.Domain', expected_tests: tests, expected_count: tests.length },
    ...selected.map(s => ({ ...common, id: s.id, kind: s.refusal ? 'rejected_replay' : 'replay', depends_on: [s.refusal ? 'input' : 'automation'], arguments: ['-RenderOffScreen', '-unattended', '-nosplash', '-notraceserver', '-NoGamepad', '-windowed', '-ResX=640', '-ResY=360', '-ForceRes', '-stdout', '-FullStdOutLogOutput', '-ExecCmds=t.MaxFPS 60', '-nosound'], input: `${s.id}.json`, expected_count: s.refusal ? 1 : 2, requested: s.refusal ? {} : { configuration: 'Development', resolution: { width: 640, height: 360 } }, ...(s.refusal ? { expected_refusal: [s.refusal], expected_exit_code: 0 } : {}) })),
  ];
  return { manifest: { schema_version: 1, steps, suites: { acceptance: steps.map(s => s.id) } }, inputs: Object.fromEntries(selected.map(s => [`${s.id}.json`, s.document])) };
}
