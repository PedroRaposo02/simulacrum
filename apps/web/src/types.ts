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
  enablesTennokai?: boolean;
  unparsed?: string[];
  rarity?: string;
  image?: string;
}

export type MeleeRole = "light" | "heavy" | "tennokai" | "other";

export interface MeleeProfile {
  class: string;
  attackSpeed: number;
  rangeM: number;
  followThrough: number;
  comboDurationS: number;
  heavyDamage: number;
  windUpS: number;
  stances: string[];
}

export interface Evolution {
  name: string;
  text: string;
  forms?: "both" | "incarnon" | "normal";
  modifiers?: Modifier[];
  behaviour?: { kind: string; [k: string]: unknown };
  /** Effect text not turned into engine modifiers. */
  unparsed?: string[];
}
export interface EvolutionTier { tier: number; options: Evolution[] }

export interface WeaponMode {
  name: string;
  trigger?: string;
  incarnonForm?: boolean;
  coverage: Coverage;
  notes?: string[];
  headline?: boolean;
  meleeRole?: MeleeRole;
  stance?: string;
}

export interface Weapon {
  id: string;
  name: string;
  slot: Slot;
  class: string;
  family: string;
  modPool: ModPool;
  image?: string;
  melee?: MeleeProfile;
  evolutions?: EvolutionTier[];
  polarities?: string[];
  exilusPolarity?: string;
  stancePolarity?: string;
  modes: WeaponMode[];
}

export interface Arcane {
  id: string;
  name: string;
  slot: string;
  behaviour: string | null;
  modifiers: Modifier[];
  description: string;
  rarity?: string;
  image?: string;
}
export interface EnemyProfile { id: string; name: string; faction: string; armor: number; note?: string }

export interface RivenStatDef {
  key: string;
  label: string;
  stat: Stat | null;
  base: Partial<Record<RivenType, number>>;
  unit?: "m" | "s" | "count";
  spliced?: boolean;
  appliesTo?: string;
}
export interface RivenLayout { positives: number; negative: boolean; positiveMult: number; negativeMult: number }
export interface RivenTable { disposition: number; rollMin: number; rollMax: number; layouts: RivenLayout[]; stats: RivenStatDef[] }

export interface BuffDef {
  id: string;
  name: string;
  source: string;
  scalesWithStrength: boolean;
  modifiers: Modifier[];
  subsumedValue?: number;
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
  heavyComboMultiplier: number;
  headshotEffects: boolean;
}

/** What the engine receives. */
export interface EngineBuild {
  weapon: string;
  mods: string[];
  arcane: string | null;
  riven: Modifier[];
  buffs: Modifier[];
  evolutions: string[];
  conditions: Conditions;
}

export interface Target {
  enemy: string | null;
  armorStrip: number;
  /** Corrosive Projection auras in the squad (0-4). */
  corrosiveProjection: number;
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
  /** Chosen Incarnon evolution per tier (name or null). */
  evolutions: string[];
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
  attackSpeed?: number;
  rangeM?: number;
  comboMultiplier?: number;
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
  objective: Objective;
  score: number;
  fireRate: number;
  sustainedDps: number;
  perShot: number;
  perCharge: number | null;
  evolutions: string[];
  attackSpeed: number | null;
  rangeM: number | null;
  drain: number | null;
  rangeCost: number | null;
  belowAttackSpeedFloor: boolean;
}

export interface CapacityOptions { capacity: number; polarities: (string | null)[]; rivenDrain: number }
export type Objective = "balanced" | "burst" | "sustained" | "perShot" | "perCharge";

export interface OptimizeOptions {
  objective?: Objective;
  maxFireRate?: number | null;
  minCritChance?: number | null;
  mode?: number | null;
  riven?: boolean;
  arcane?: boolean;
  minAttackSpeed?: number | null;
  rangeTolerance?: number | null;
  capacity?: CapacityOptions | null;
  splicedRiven?: boolean;
  fixedRiven?: Modifier[];
  allowFaction?: boolean;
  evolutions?: boolean;
}

export interface SavedBuild { name: string; savedAt: number; build: EditorBuild }

export interface RivenRoll { stats: RivenPick[]; score: number; ratio: number; spliced: boolean }
export interface RivenRanking { weapon: string; mode: string; mods: string[]; arcane: string | null; rolls: RivenRoll[]; evaluations: number }

export interface BestEntry {
  modeIndex: number;
  burstDps: number;
  mods: string[];
  arcane: string | null;
  riven?: RivenPick[];
  rivenNegative?: RivenPick | null;
  evolutions?: string[];
}
export interface BestBuilds {
  dataVersion: string;
  generatedAtUnix: number;
  conditions: Conditions;
  targets: Record<string, Record<string, { plain?: BestEntry; riven?: BestEntry; error?: string }>>;
}
