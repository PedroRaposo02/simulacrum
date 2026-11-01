// Mirrors the Rust types in crates/wf-data and crates/wf-calc (serde camelCase).
export type Coverage = "verified" | "computed" | "approximate" | "unsupported";
export type Slot = "primary" | "secondary" | "melee" | "archGun" | "companion";

export interface Stat { kind: string; of?: string }
export interface Modifier {
  source: string;
  stat: Stat;
  value: number;
  maxStacks?: number;
  condition?: string;
}

export interface Mod {
  id: string;
  name: string;
  pool: string;
  compat: string | null;
  polarity: string;
  baseDrain: number;
  maxRank: number;
  isExilus: boolean;
  exclusiveGroup?: string;
  modifiers: Modifier[];
  unparsed?: string[];
}

export interface Weapon {
  id: string;
  name: string;
  slot: Slot;
  class: string;
  family: string;
  image?: string;
  modes: { name: string; coverage: Coverage; notes?: string[] }[];
}

export interface Arcane { id: string; name: string; slot: string; behaviour: string | null; modifiers: Modifier[]; description: string }
export interface EnemyProfile { id: string; name: string; faction: string; armor: number; note?: string }

export interface GameData {
  version: string;
  generatedAt: string;
  sources: Record<string, string>;
  weapons: Weapon[];
  mods: Mod[];
  arcanes: Arcane[];
  enemies: EnemyProfile[];
}

export interface Conditions { conditionalUptime: number; headshotShare: number }
export interface Build {
  weapon: string;
  mods: string[];
  arcane: string | null;
  riven: Modifier[];
  buffs: Modifier[];
  conditions: Conditions;
}
export interface Target { enemy: string | null; armorStrip: number }

export interface Explain { label: string; value: number; detail?: string; children?: Explain[] }

export interface ComponentResult {
  name: string;
  damage: Record<string, number>;
  perProjectileRaw: number;
  perProjectileTarget: number;
  projectiles: number;
  critChance: number;
  critMult: number;
  statusChance: number;
}

export interface ModeResult {
  mode: string;
  modeIndex: number;
  coverage: Coverage;
  approximations: string[];
  fireRate: number;
  magazine: number | null;
  reloadS: number;
  perShotRaw: number;
  perShot: number;
  burstDpsRaw: number;
  burstDps: number;
  sustainedDps: number;
  perCharge: number | null;
  statusDps: number;
  viralStacks: number;
  corrosiveStacks: number;
  components: ComponentResult[];
  explain: Explain;
}

export interface CalcError { code: string; message: string }
export interface BuildResult {
  weapon: string;
  weaponId: string;
  target: string;
  modes: ModeResult[];
  failedModes: { mode: string; modeIndex: number; error: CalcError }[];
  warnings: string[];
}

export interface RankRow {
  weaponId: string;
  name: string;
  slot: Slot;
  class: string;
  mode: string;
  burstDps: number;
  sustainedDps: number;
  perShot: number;
  coverage: Coverage;
  failed: string | null;
}
