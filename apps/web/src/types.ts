// Mirrors the Rust types in crates/wf-data, wf-calc and wf-opt (serde camelCase).
export type Coverage = "verified" | "computed" | "approximate" | "unsupported";
export type Slot = "primary" | "secondary" | "melee" | "archGun" | "companion";
export type ModPool = "primary" | "shotgun" | "secondary" | "melee" | "archGun" | "companion";
export type RivenType = "rifle" | "shotgun" | "pistol" | "archGun" | "melee";

export interface Stat { kind: string; of?: string }
export interface Modifier {
  source: string;
  stat: Stat;
  value: number;
  maxStacks?: number;
  condition?: string;
  per?: "statusType" | "comboMultiplier";
  appliesTo?: string;
}

export interface Mod {
  id: string;
  name: string;
  pool: ModPool;
  compat: string | null;
  polarity: string;
  baseDrain: number;
  maxRank: number;
  isExilus: boolean;
  exclusiveGroup?: string;
  modifiers: Modifier[];
  requiresTrigger?: string;
  locksFireRate?: boolean;
  unparsed?: string[];
}

export interface Weapon {
  id: string;
  name: string;
  slot: Slot;
  class: string;
  family: string;
  modPool: ModPool;
  image?: string;
  modes: { name: string; coverage: Coverage; notes?: string[] }[];
}

export interface Arcane { id: string; name: string; slot: string; behaviour: string | null; modifiers: Modifier[]; description: string }
export interface EnemyProfile { id: string; name: string; faction: string; armor: number; note?: string }

export interface RivenStatDef { key: string; label: string; stat: Stat | null; base: Partial<Record<RivenType, number>> }
export interface RivenLayout { positives: number; negative: boolean; positiveMult: number; negativeMult: number }
export interface RivenTable { disposition: number; rollMin: number; rollMax: number; layouts: RivenLayout[]; stats: RivenStatDef[] }

export interface BuffDef {
  id: string;
  name: string;
  source: string;
  scalesWithStrength: boolean;
  modifiers: Modifier[];
  note?: string;
}

export interface GameData {
  version: string;
  generatedAt: string;
  sources: Record<string, string>;
  weapons: Weapon[];
  mods: Mod[];
  arcanes: Arcane[];
  enemies: EnemyProfile[];
  riven?: RivenTable;
  buffs: BuffDef[];
}

export interface Conditions {
  conditionalUptime: number;
  headshotShare: number;
  statusTypes: number;
  comboMultiplier: number;
  headshotEffects: boolean;
}

/** What the engine receives. */
export interface EngineBuild {
  weapon: string;
  mods: string[];
  arcane: string | null;
  riven: Modifier[];
  buffs: Modifier[];
  conditions: Conditions;
}

export interface Target {
  enemy: string | null;
  armorStrip: number;
  viralStacks: number | null;
  corrosiveStacks: number | null;
  heatActive: boolean;
}

/** A riven stat as the editor holds it: roll position 0..1 within the stat's range. */
export interface RivenRow { key: string; roll: number }
export interface RivenState { positives: RivenRow[]; negative: RivenRow | null }

/** What the editor holds. */
export interface EditorBuild {
  weapon: string;
  /** 8 normal slots then the exilus slot; "" = empty. */
  slots: string[];
  arcane: string | null;
  riven: RivenState;
}

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

export interface RivenPick { key: string; label: string; value: number }
export interface Marginal { label: string; kind: string; loss: number }
export interface OptimizeResult {
  weaponId: string;
  weapon: string;
  mode: string;
  modeIndex: number;
  burstDps: number;
  mods: string[];
  arcane: string | null;
  riven: RivenPick[];
  rivenNegative: RivenPick | null;
  marginal: Marginal[];
  evaluations: number;
}

export interface BestEntry {
  modeIndex: number;
  burstDps: number;
  mods: string[];
  arcane: string | null;
  riven?: RivenPick[];
  rivenNegative?: RivenPick | null;
}
export interface BestBuilds {
  dataVersion: string;
  generatedAtUnix: number;
  conditions: Conditions;
  targets: Record<string, Record<string, { plain?: BestEntry; riven?: BestEntry; error?: string }>>;
}
