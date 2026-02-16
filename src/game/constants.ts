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

export enum CellType {
  Empty = 0,
  Alive = 1,
  Dead = 2,
  Toxin = 3,
}

export enum MutationId {
  MycelialBloom = 'mycelialBloom',
  HomeostaticHarmony = 'homeostaticHarmony',
  MycotoxinTracer = 'mycotoxinTracer',
  MutatorPhenotype = 'mutatorPhenotype',
  Tendrils = 'tendrils',
  HyphalSurge = 'hyphalSurge',
  ChitinFortification = 'chitinFortification',
}

export interface MutationDef {
  id: MutationId;
  name: string;
  description: string;
  tier: 1 | 2;
  cost: number;
  maxLevel: number;
  icon: string;
}

export const MUTATIONS: MutationDef[] = [
  {
    id: MutationId.MycelialBloom,
    name: 'Mycelial Bloom',
    description: '+0.25% growth chance per level',
    tier: 1, cost: 1, maxLevel: 150, icon: '🌱',
  },
  {
    id: MutationId.HomeostaticHarmony,
    name: 'Homeostatic Harmony',
    description: '-0.3% decay chance per level',
    tier: 1, cost: 1, maxLevel: 100, icon: '🛡️',
  },
  {
    id: MutationId.MycotoxinTracer,
    name: 'Mycotoxin Tracer',
    description: 'Failed growth attempts may place toxins',
    tier: 1, cost: 1, maxLevel: 50, icon: '☠️',
  },
  {
    id: MutationId.MutatorPhenotype,
    name: 'Mutator Phenotype',
    description: '+0.1 mutation points earned per round per level',
    tier: 1, cost: 1, maxLevel: 10, icon: '🧬',
  },
  {
    id: MutationId.Tendrils,
    name: 'Tendrils',
    description: '+1% diagonal growth chance per level',
    tier: 2, cost: 2, maxLevel: 10, icon: '🕸️',
  },
  {
    id: MutationId.HyphalSurge,
    name: 'Hyphal Surge',
    description: '+0.9% growth boost per level (activates every 5 rounds)',
    tier: 2, cost: 2, maxLevel: 10, icon: '⚡',
  },
  {
    id: MutationId.ChitinFortification,
    name: 'Chitin Fortification',
    description: 'Some cells become resistant to decay for 3 rounds',
    tier: 2, cost: 2, maxLevel: 10, icon: '🏰',
  },
];

export const PLAYER_COLORS = [
  { name: 'Green Mold', base: [72, 140, 72], dark: [40, 80, 40] },
  { name: 'Blue Mold', base: [70, 100, 160], dark: [35, 55, 90] },
  { name: 'Gray Mold', base: [130, 130, 140], dark: [70, 70, 80] },
  { name: 'Yellow Mold', base: [170, 160, 60], dark: [100, 95, 30] },
];
