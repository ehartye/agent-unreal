import { scenarios } from '../agent_verify/scenarios.mjs';

export function fixture({ compiler, sdk }) {
  const wait = structuredClone(scenarios().find(s => s.id === 'smoke').document);
  wait.request_id = 'remote-bounded-wait'; wait.phases[0].seconds = 60;
  return {
    inputs: { 'wait.json': wait },
    manifest: {
      schema_version: 1,
      steps: [
        { id: 'build', kind: 'build', required: true, depends_on: [], timeout_seconds: 600, arguments: [`-CompilerVersion=${compiler}`, `-WindowsSDKVersion=${sdk}`, '-NoUBTMakefiles'], expected_count: 1 },
        { id: 'rules', kind: 'automation', required: true, depends_on: ['build'], timeout_seconds: 180, arguments: ['-nullrhi', '-nosound', '-unattended', '-notraceserver', '-stdout', '-FullStdOutLogOutput'], filter: 'ObservationSample.Domain', expected_tests: ['ObservationSample.Domain.Travel.ReleasedAxisStopsMovement'], expected_count: 1 },
        { id: 'wait', kind: 'smoke', required: true, depends_on: ['build'], timeout_seconds: 180, arguments: ['-RenderOffScreen', '-unattended', '-nosplash', '-notraceserver', '-NoGamepad', '-windowed', '-ResX=640', '-ResY=360', '-ForceRes', '-stdout', '-FullStdOutLogOutput', '-nosound'], input: 'wait.json', expected_count: 1, requested: { configuration: 'Development', resolution: { width: 640, height: 360 } } },
      ],
      suites: { small: ['rules'], cancel: ['wait'] },
    },
  };
}
