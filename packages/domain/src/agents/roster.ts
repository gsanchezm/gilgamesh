export type AgentSlot =
  | 'lead'
  | 'arch'
  | 'manual'
  | 'web'
  | 'api'
  | 'android'
  | 'ios'
  | 'perf'
  | 'visual'
  | 'sec'
  | 'a11y';

export type AgentFamily = 'proceso' | 'ui' | 'backend' | 'guardian';

export interface RosterEntry {
  readonly slot: AgentSlot;
  readonly deityName: string;
  readonly role: string;
  readonly family: AgentFamily;
  readonly glyph: string;
  readonly culture: string;
  readonly toolOptions: readonly string[];
}

export const FAMILY_COLORS: Record<AgentFamily, string> = {
  proceso: '#A07D2C',
  ui: '#3F6FA3',
  backend: '#7E63A6',
  guardian: '#2F8F78',
};

/** Canonical roster (desktop prototype — decided 2026-06-29). First tool = default. */
export const AGENT_ROSTER: readonly RosterEntry[] = [
  { slot: 'lead', deityName: 'Zeus', role: 'QA Lead', family: 'proceso', glyph: 'ZE', culture: 'Grecia', toolOptions: ['Helix Core'] },
  { slot: 'arch', deityName: 'Athena', role: 'QA Architect', family: 'proceso', glyph: 'AT', culture: 'Grecia', toolOptions: ['Strategy'] },
  { slot: 'manual', deityName: 'Anubis', role: 'QA Manual', family: 'proceso', glyph: 'AN', culture: 'Egipto', toolOptions: ['Suites · Steps'] },
  { slot: 'web', deityName: 'Quetzalcóatl', role: 'Web Automation', family: 'ui', glyph: 'QC', culture: 'Azteca', toolOptions: ['Playwright', 'Cypress'] },
  { slot: 'api', deityName: 'Iris', role: 'API Automation', family: 'backend', glyph: 'IR', culture: 'Grecia', toolOptions: ['Postman', 'REST Assured', 'Karate'] },
  { slot: 'android', deityName: 'Freya', role: 'Android Automation', family: 'ui', glyph: 'FR', culture: 'Escandinavia', toolOptions: ['Appium', 'Mobilewright'] },
  { slot: 'ios', deityName: 'Isis', role: 'iOS Automation', family: 'ui', glyph: 'IS', culture: 'Egipto', toolOptions: ['Appium', 'Mobilewright'] },
  { slot: 'perf', deityName: 'Thor', role: 'Performance', family: 'backend', glyph: 'TH', culture: 'Escandinavia', toolOptions: ['k6', 'Gatling', 'JMeter'] },
  { slot: 'visual', deityName: 'Xochiquetzal', role: 'Visual', family: 'ui', glyph: 'XO', culture: 'Azteca', toolOptions: ['Pixelmatch', 'Applitools'] },
  { slot: 'sec', deityName: 'Odin', role: 'Security', family: 'guardian', glyph: 'OD', culture: 'Escandinavia', toolOptions: ['OWASP ZAP', 'Burp Suite'] },
  { slot: 'a11y', deityName: 'Ra', role: 'Accessibility', family: 'guardian', glyph: 'RA', culture: 'Egipto', toolOptions: ['axe-core', 'Pa11y'] },
];

export function defaultToolFor(slot: AgentSlot): string {
  const entry = AGENT_ROSTER.find((e) => e.slot === slot);
  if (!entry) throw new Error(`Unknown agent slot: ${slot}`);
  return entry.toolOptions[0]!;
}
