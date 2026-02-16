export const BOARD_SIZE = 160;
export const TOTAL_TILES = BOARD_SIZE * BOARD_SIZE;
export const BASE_GROWTH_CHANCE = 0.015;
export const BASE_RANDOM_DECAY_CHANCE = 0.032;
export const AGE_DECAY_START = 10;
export const AGE_DEATH_FACTOR_PER_CYCLE = 0.008;
export const TOTAL_GROWTH_CYCLES = 5;
export const GAME_END_OCCUPANCY = 0.90;
export const STARTING_MUTATION_POINTS = 5;
export const MAX_ROUNDS = 75;
export const TOXIN_DURATION = 6;
export const DECAY_SCALING_START_ROUND = 10;
export const DECAY_ADDITIONAL_PER_ROUND = 0.001;
export const SPORICIDAL_TOXIN_DURATION = 12;

export enum CellType {
  Empty = 0,
  Alive = 1,
  Dead = 2,
  Toxin = 3,
}

export enum MutationId {
  // Tier 1
  MycelialBloom = 'mycelialBloom',
  HomeostaticHarmony = 'homeostaticHarmony',
  MycotoxinTracer = 'mycotoxinTracer',
  MutatorPhenotype = 'mutatorPhenotype',
  // Tier 2
  Tendrils = 'tendrils',
  HyphalSurge = 'hyphalSurge',
  ChitinFortification = 'chitinFortification',
  ChronoresilientCytoplasm = 'chronoresilientCytoplasm',
  AdaptiveExpression = 'adaptiveExpression',
  MycotoxinPotentiation = 'mycotoxinPotentiation',
  MycotoxinCatabolism = 'mycotoxinCatabolism',
  HyphalVectoring = 'hyphalVectoring',
  // Tier 3
  Necrosporulation = 'necrosporulation',
  MycotropicInduction = 'mycotropicInduction',
  PutrefactiveMycotoxin = 'putrefactiveMycotoxin',
  AnabolicInversion = 'anabolicInversion',
  MimeticResilience = 'mimeticResilience',
  CompetitiveAntagonism = 'competitiveAntagonism',
  // Tier 4
  RegenerativeHyphae = 'regenerativeHyphae',
  CreepingMold = 'creepingMold',
  SporicidalBloom = 'sporicidalBloom',
  NecrophyticBloom = 'necrophyticBloom',
  // Tier 5
  NecrohyphalInfiltration = 'necrohyphalInfiltration',
  NecrotoxicConversion = 'necrotoxicConversion',
  PutrefactiveRejuvenation = 'putrefactiveRejuvenation',
  HyperadaptiveDrift = 'hyperadaptiveDrift',
  // Tier 6
  CatabolicRebirth = 'catabolicRebirth',
  PutrefactiveCascade = 'putrefactiveCascade',
  OntogenicRegression = 'ontogenicRegression',
  // Tier 7
  HypersystemicRegeneration = 'hypersystemicRegeneration',
}

export type MutationTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type MutationCategory = 'growth' | 'cellularResilience' | 'fungicide' | 'geneticDrift' | 'mycelialSurges';

export interface MutationDef {
  id: MutationId;
  name: string;
  description: string;
  tier: MutationTier;
  cost: number;
  maxLevel: number;
  icon: string;
  category: MutationCategory;
  isSurge?: boolean;
  surgePointCost?: number;
  surgeDuration?: number;
  surgePointIncreasePerLevel?: number;
}

export const TIER_COSTS: Record<number, number> = {
  1: 1, 2: 2, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8,
};

// Tier unlocks at round >= tier * 3 (tier 1-2 always available)
export function isTierUnlocked(tier: MutationTier, round: number): boolean {
  if (tier <= 2) return true;
  return round >= tier * 3;
}

export const MUTATIONS: MutationDef[] = [
  // === Tier 1 ===
  {
    id: MutationId.MycelialBloom,
    name: 'Mycelial Bloom',
    description: '+0.25% growth chance per level',
    tier: 1, cost: 1, maxLevel: 150, icon: '🌱',
    category: 'growth',
  },
  {
    id: MutationId.HomeostaticHarmony,
    name: 'Homeostatic Harmony',
    description: '-0.3% decay chance per level',
    tier: 1, cost: 1, maxLevel: 100, icon: '🛡️',
    category: 'cellularResilience',
  },
  {
    id: MutationId.MycotoxinTracer,
    name: 'Mycotoxin Tracer',
    description: 'Failed growth attempts may place toxins',
    tier: 1, cost: 1, maxLevel: 50, icon: '☠️',
    category: 'fungicide',
  },
  {
    id: MutationId.MutatorPhenotype,
    name: 'Mutator Phenotype',
    description: '+0.1 mutation points earned per round per level',
    tier: 1, cost: 1, maxLevel: 10, icon: '🧬',
    category: 'geneticDrift',
  },
  // === Tier 2 ===
  {
    id: MutationId.Tendrils,
    name: 'Tendrils',
    description: '+1% diagonal growth chance per level',
    tier: 2, cost: 2, maxLevel: 10, icon: '🕸️',
    category: 'growth',
  },
  {
    id: MutationId.HyphalSurge,
    name: 'Hyphal Surge',
    description: '+0.9% growth boost per level (surge: 7 pts, 2 rounds)',
    tier: 2, cost: 2, maxLevel: 10, icon: '⚡',
    category: 'mycelialSurges',
    isSurge: true,
    surgePointCost: 7,
    surgeDuration: 2,
    surgePointIncreasePerLevel: 1,
  },
  {
    id: MutationId.ChitinFortification,
    name: 'Chitin Fortification',
    description: 'Surge: fortify cells with resistance (2 pts, 3 rounds)',
    tier: 2, cost: 2, maxLevel: 10, icon: '🏰',
    category: 'mycelialSurges',
    isSurge: true,
    surgePointCost: 2,
    surgeDuration: 3,
    surgePointIncreasePerLevel: 1,
  },
  {
    id: MutationId.ChronoresilientCytoplasm,
    name: 'Chronoresilient Cytoplasm',
    description: '+4 growth cycles before age decay per level',
    tier: 2, cost: 2, maxLevel: 15, icon: '⏳',
    category: 'cellularResilience',
  },
  {
    id: MutationId.AdaptiveExpression,
    name: 'Adaptive Expression',
    description: '19% chance per level to earn bonus MP (14%/lvl for 2nd point)',
    tier: 2, cost: 2, maxLevel: 5, icon: '🎯',
    category: 'geneticDrift',
  },
  {
    id: MutationId.MycotoxinPotentiation,
    name: 'Mycotoxin Potentiation',
    description: '+1 toxin duration/level & 1.6% kill chance/level',
    tier: 2, cost: 2, maxLevel: 10, icon: '🧪',
    category: 'fungicide',
  },
  {
    id: MutationId.MycotoxinCatabolism,
    name: 'Mycotoxin Catabolism',
    description: 'Clean enemy toxins (3.2%/lvl), earn MP (8%/lvl, max 3/round)',
    tier: 2, cost: 2, maxLevel: 8, icon: '🔬',
    category: 'geneticDrift',
  },
  {
    id: MutationId.HyphalVectoring,
    name: 'Hyphal Vectoring',
    description: 'Surge: grow line of cells toward center (9 pts, 4 rounds)',
    tier: 2, cost: 2, maxLevel: 5, icon: '➡️',
    category: 'mycelialSurges',
    isSurge: true,
    surgePointCost: 9,
    surgeDuration: 4,
    surgePointIncreasePerLevel: 1,
  },
  // === Tier 3 ===
  {
    id: MutationId.Necrosporulation,
    name: 'Necrosporulation',
    description: '4% chance per level to spawn a spore on a random empty tile when a cell dies',
    tier: 3, cost: 4, maxLevel: 5, icon: '🌀',
    category: 'cellularResilience',
  },
  {
    id: MutationId.MycotropicInduction,
    name: 'Mycotropic Induction',
    description: '+25% growth bonus per level near enemy cells',
    tier: 3, cost: 4, maxLevel: 5, icon: '🧲',
    category: 'growth',
  },
  {
    id: MutationId.PutrefactiveMycotoxin,
    name: 'Putrefactive Mycotoxin',
    description: '1.5% chance per level for living cells to kill adjacent enemies',
    tier: 3, cost: 4, maxLevel: 5, icon: '💀',
    category: 'fungicide',
  },
  {
    id: MutationId.AnabolicInversion,
    name: 'Anabolic Inversion',
    description: 'Earn bonus MP when your colony is smaller than others',
    tier: 3, cost: 4, maxLevel: 3, icon: '📈',
    category: 'geneticDrift',
  },
  {
    id: MutationId.MimeticResilience,
    name: 'Mimetic Resilience',
    description: 'Surge: place resistant cells near enemies (8 pts, 4 rounds)',
    tier: 3, cost: 4, maxLevel: 3, icon: '🪞',
    category: 'mycelialSurges',
    isSurge: true,
    surgePointCost: 8,
    surgeDuration: 4,
    surgePointIncreasePerLevel: 2,
  },
  {
    id: MutationId.CompetitiveAntagonism,
    name: 'Competitive Antagonism',
    description: 'Surge: toxins/blooms target larger colonies (7 pts, 4 rounds)',
    tier: 3, cost: 4, maxLevel: 5, icon: '⚔️',
    category: 'mycelialSurges',
    isSurge: true,
    surgePointCost: 7,
    surgeDuration: 4,
    surgePointIncreasePerLevel: 1,
  },
  // === Tier 4 ===
  {
    id: MutationId.RegenerativeHyphae,
    name: 'Regenerative Hyphae',
    description: '3% chance per level to reclaim your own dead cells',
    tier: 4, cost: 5, maxLevel: 5, icon: '♻️',
    category: 'growth',
  },
  {
    id: MutationId.CreepingMold,
    name: 'Creeping Mold',
    description: '3.5% chance per level for cells to move to more open adjacent tiles',
    tier: 4, cost: 5, maxLevel: 4, icon: '🐛',
    category: 'growth',
  },
  {
    id: MutationId.SporicidalBloom,
    name: 'Sporicidal Bloom',
    description: '8% of living cells per level drop toxins near enemies each round',
    tier: 4, cost: 5, maxLevel: 5, icon: '💣',
    category: 'fungicide',
  },
  {
    id: MutationId.NecrophyticBloom,
    name: 'Necrophytic Bloom',
    description: 'When 20%+ board occupied, cell deaths spawn spores on random tiles',
    tier: 4, cost: 5, maxLevel: 5, icon: '🍄',
    category: 'geneticDrift',
  },
  // === Tier 5 ===
  {
    id: MutationId.NecrohyphalInfiltration,
    name: 'Necrohyphal Infiltration',
    description: '0.4% chance per level to convert adjacent dead enemy cells (cascades at 1.9%)',
    tier: 5, cost: 6, maxLevel: 5, icon: '🕳️',
    category: 'cellularResilience',
  },
  {
    id: MutationId.NecrotoxicConversion,
    name: 'Necrotoxic Conversion',
    description: '4% chance per level to reclaim cells killed by your toxins',
    tier: 5, cost: 6, maxLevel: 5, icon: '🔄',
    category: 'fungicide',
  },
  {
    id: MutationId.PutrefactiveRejuvenation,
    name: 'Putrefactive Rejuvenation',
    description: 'Toxin kills reduce age of nearby friendly cells by 4 cycles per level',
    tier: 5, cost: 6, maxLevel: 4, icon: '💚',
    category: 'fungicide',
  },
  {
    id: MutationId.HyperadaptiveDrift,
    name: 'Hyperadaptive Drift',
    description: '28% chance per level for free higher-tier mutation upgrades',
    tier: 5, cost: 6, maxLevel: 3, icon: '🎲',
    category: 'geneticDrift',
  },
  // === Tier 6 ===
  {
    id: MutationId.CatabolicRebirth,
    name: 'Catabolic Rebirth',
    description: '12% chance per level to resurrect dead cells when nearby toxins expire',
    tier: 6, cost: 7, maxLevel: 3, icon: '🔥',
    category: 'cellularResilience',
  },
  {
    id: MutationId.PutrefactiveCascade,
    name: 'Putrefactive Cascade',
    description: '22% chance per level for toxin kills to chain to adjacent enemies (max depth 10)',
    tier: 6, cost: 7, maxLevel: 3, icon: '⛓️',
    category: 'fungicide',
  },
  {
    id: MutationId.OntogenicRegression,
    name: 'Ontogenic Regression',
    description: '30% chance per level to consume 3 Tier 1 levels for a free Tier 5-6 upgrade',
    tier: 6, cost: 7, maxLevel: 3, icon: '🧪',
    category: 'geneticDrift',
  },
  // === Tier 7 ===
  {
    id: MutationId.HypersystemicRegeneration,
    name: 'Hypersystemic Regeneration',
    description: '+1% per level boost to Regenerative Hyphae + 15% chance for resistant reclaimed cells',
    tier: 7, cost: 8, maxLevel: 3, icon: '💎',
    category: 'cellularResilience',
  },
];

export const PLAYER_COLORS = [
  { name: 'Green Mold', base: [72, 140, 72], dark: [40, 80, 40] },
  { name: 'Blue Mold', base: [70, 100, 160], dark: [35, 55, 90] },
  { name: 'Gray Mold', base: [130, 130, 140], dark: [70, 70, 80] },
  { name: 'Yellow Mold', base: [170, 160, 60], dark: [100, 95, 30] },
];

export const CATEGORY_LABELS: Record<MutationCategory, string> = {
  growth: '🌱 Growth',
  cellularResilience: '🛡️ Cellular Resilience',
  fungicide: '☠️ Fungicide',
  geneticDrift: '🧬 Genetic Drift',
  mycelialSurges: '⚡ Mycelial Surges',
};

export const TIER_COLORS: Record<MutationTier, string> = {
  1: '#9CA3AF',
  2: '#60A5FA',
  3: '#34D399',
  4: '#FBBF24',
  5: '#F472B6',
  6: '#C084FC',
  7: '#F97316',
};
