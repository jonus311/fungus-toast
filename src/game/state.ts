import {
  BOARD_SIZE, TOTAL_TILES, CellType, MutationId, MUTATIONS, MutationTier,
  BASE_GROWTH_CHANCE, BASE_RANDOM_DECAY_CHANCE, AGE_DECAY_START,
  AGE_DEATH_FACTOR_PER_CYCLE, TOTAL_GROWTH_CYCLES, GAME_END_OCCUPANCY,
  STARTING_MUTATION_POINTS, MAX_ROUNDS, TOXIN_DURATION,
  DECAY_SCALING_START_ROUND, DECAY_ADDITIONAL_PER_ROUND,
  SPORICIDAL_TOXIN_DURATION, isTierUnlocked, TIER_COSTS,
} from './constants';

// ===================== TYPES =====================

export interface Cell {
  type: CellType;
  owner: number;       // -1 = none
  lastOwner: number;   // -1 = none; tracks original owner for dead cells (reclaiming)
  age: number;         // growth cycles alive
  resistant: boolean;
  toxinAge: number;    // when toxin expires (growth cycles)
  birthRound: number;
}

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  mutations: Map<MutationId, number>;
  mutationPoints: number;
  fractionalPoints: number;
  territory: number;
  aiStrategy?: 'growth' | 'toxin' | 'balanced';
  surgeActive: number;                // Hyphal Surge rounds remaining
  mimeticSurgeActive: number;         // Mimetic Resilience rounds remaining
  competitiveSurgeActive: number;     // Competitive Antagonism rounds remaining
}

export interface GameState {
  board: Cell[];
  players: Player[];
  round: number;
  growthCycle: number;
  phase: 'setup' | 'mutation' | 'growth' | 'decay' | 'ended';
  speed: number;
  endgameCountdown: number;
  winner: number;
  log: string[];
  necrophyticBloomActivated: boolean;
}

// ===================== HELPERS =====================

export function createEmptyCell(): Cell {
  return { type: CellType.Empty, owner: -1, lastOwner: -1, age: 0, resistant: false, toxinAge: 0, birthRound: 0 };
}

function idx(x: number, y: number): number { return y * BOARD_SIZE + x; }
function idxX(i: number): number { return i % BOARD_SIZE; }
function idxY(i: number): number { return (i / BOARD_SIZE) | 0; }

const ORTHO_DIRS: [number, number][] = [[-1,0],[1,0],[0,-1],[0,1]];
const DIAG_DIRS: [number, number][] = [[-1,-1],[-1,1],[1,-1],[1,1]];
const ALL_DIRS: [number, number][] = [...ORTHO_DIRS, ...DIAG_DIRS];

function getNeighborIndices(i: number, diagonal: boolean): number[] {
  const x = idxX(i), y = idxY(i);
  const dirs = diagonal ? ALL_DIRS : ORTHO_DIRS;
  const result: number[] = [];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE)
      result.push(idx(nx, ny));
  }
  return result;
}

function getOrthoNeighbors(i: number): number[] { return getNeighborIndices(i, false); }
function getDiagOnlyNeighbors(i: number): number[] {
  const x = idxX(i), y = idxY(i);
  const result: number[] = [];
  for (const [dx, dy] of DIAG_DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE)
      result.push(idx(nx, ny));
  }
  return result;
}

function getMutLevel(player: Player, id: MutationId): number {
  return player.mutations.get(id) ?? 0;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===================== INIT =====================

export function createInitialState(): GameState {
  const board: Cell[] = new Array(TOTAL_TILES);
  for (let i = 0; i < TOTAL_TILES; i++) board[i] = createEmptyCell();
  return {
    board, players: [], round: 1, growthCycle: 0,
    phase: 'setup', speed: 1, endgameCountdown: -1, winner: -1, log: [],
    necrophyticBloomActivated: false,
  };
}

export function addPlayer(state: GameState, name: string, isHuman: boolean, strategy?: 'growth' | 'toxin' | 'balanced'): Player {
  const p: Player = {
    id: state.players.length, name, isHuman,
    mutations: new Map(), mutationPoints: STARTING_MUTATION_POINTS, fractionalPoints: 0,
    territory: 0, aiStrategy: strategy, surgeActive: 0,
    mimeticSurgeActive: 0, competitiveSurgeActive: 0,
  };
  state.players.push(p);
  return p;
}

export function placeStartingSpore(state: GameState, playerId: number, x: number, y: number) {
  const i = idx(x, y);
  if (state.board[i].type !== CellType.Empty) return false;
  state.board[i] = {
    type: CellType.Alive, owner: playerId, lastOwner: playerId,
    age: 0, resistant: true, toxinAge: 0, birthRound: state.round,
  };
  return true;
}

// ===================== GROWTH MECHANICS =====================

function getGrowthChance(player: Player): number {
  let chance = BASE_GROWTH_CHANCE;
  chance += getMutLevel(player, MutationId.MycelialBloom) * 0.0025;
  if (player.surgeActive > 0)
    chance += getMutLevel(player, MutationId.HyphalSurge) * 0.009;
  return chance;
}

function getDiagonalChance(player: Player): number {
  return getMutLevel(player, MutationId.Tendrils) * 0.01;
}

function getDecayResistance(player: Player): number {
  return getMutLevel(player, MutationId.HomeostaticHarmony) * 0.003;
}

/** Mycotropic Induction: bonus growth chance when adjacent to enemy cells */
function getMycotropicBonus(player: Player, cellIdx: number, board: Cell[]): number {
  const level = getMutLevel(player, MutationId.MycotropicInduction);
  if (level <= 0) return 0;
  const neighbors = getOrthoNeighbors(cellIdx);
  for (const ni of neighbors) {
    const nc = board[ni];
    if (nc.type === CellType.Alive && nc.owner !== player.id) {
      // Has at least one enemy neighbor — apply bonus multiplier to base growth
      return level * 0.25; // multiplicative fraction applied to growth chance
    }
  }
  return 0;
}

export function runGrowthCycle(state: GameState) {
  const { board, players } = state;
  const newCells: { idx: number; owner: number }[] = [];

  // Collect living cells per player
  const livingByPlayer = new Map<number, number[]>();
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (board[i].type === CellType.Alive) {
      const o = board[i].owner;
      if (!livingByPlayer.has(o)) livingByPlayer.set(o, []);
      livingByPlayer.get(o)!.push(i);
    }
  }

  for (const [playerId, cells] of livingByPlayer) {
    const player = players[playerId];
    const baseGrowth = getGrowthChance(player);
    const diagChance = getDiagonalChance(player);
    const toxinLevel = getMutLevel(player, MutationId.MycotoxinTracer);
    const creepingLevel = getMutLevel(player, MutationId.CreepingMold);
    const moveChance = creepingLevel * 0.035;

    for (const ci of cells) {
      const mycotropicMult = 1 + getMycotropicBonus(player, ci, board);
      const growthChance = baseGrowth * mycotropicMult;

      // Orthogonal growth
      const ortho = getOrthoNeighbors(ci);
      let grew = false;
      for (const ni of ortho) {
        const nc = board[ni];
        if (nc.type === CellType.Empty) {
          if (Math.random() < growthChance) {
            newCells.push({ idx: ni, owner: playerId });
            grew = true;
          } else if (toxinLevel > 0) {
            const toxinChance = toxinLevel * 0.013 * 0.1;
            if (Math.random() < toxinChance) {
              board[ni] = {
                type: CellType.Toxin, owner: playerId, lastOwner: -1,
                age: 0, resistant: false, toxinAge: TOXIN_DURATION, birthRound: state.round,
              };
            }
          }
        }
      }

      // Diagonal growth (Tendrils)
      if (diagChance > 0) {
        const diags = getDiagOnlyNeighbors(ci);
        for (const ni of diags) {
          if (board[ni].type === CellType.Empty && Math.random() < diagChance * mycotropicMult) {
            newCells.push({ idx: ni, owner: playerId });
          }
        }
      }

      // Creeping Mold: try to move cell to a better position
      if (creepingLevel > 0 && !grew && Math.random() < moveChance) {
        tryCreepingMoldMove(board, ci, player, creepingLevel);
      }

      // Necrohyphal Infiltration: try to convert adjacent dead enemy cells
      if (!grew) {
        tryNecrohyphalInfiltration(board, ci, player);
      }
    }
  }

  // Apply new cells (shuffle for fairness)
  shuffle(newCells);
  for (const { idx: ni, owner } of newCells) {
    if (board[ni].type === CellType.Empty) {
      board[ni] = {
        type: CellType.Alive, owner, lastOwner: owner,
        age: 0, resistant: false, toxinAge: 0, birthRound: state.round,
      };
    }
  }

  // Age all cells
  for (let i = 0; i < TOTAL_TILES; i++) {
    const c = board[i];
    if (c.type === CellType.Alive || c.type === CellType.Toxin) c.age++;
  }

  state.growthCycle++;
}

/** Creeping Mold: move cell to adjacent empty tile with more open neighbors */
function tryCreepingMoldMove(board: Cell[], ci: number, player: Player, level: number) {
  const ortho = getOrthoNeighbors(ci);
  const sourceOpen = ortho.filter(n => board[n].type === CellType.Empty).length;
  
  // At max level, can jump over toxins
  const maxLevel = level >= 4;

  const candidates: number[] = [];
  for (const ni of ortho) {
    if (board[ni].type === CellType.Empty) {
      const targetOrtho = getOrthoNeighbors(ni);
      const targetOpen = targetOrtho.filter(n => board[n].type === CellType.Empty).length;
      if (targetOpen >= sourceOpen && targetOpen >= 2) {
        candidates.push(ni);
      }
    } else if (maxLevel && board[ni].type === CellType.Toxin) {
      // Jump over toxin
      const dx = idxX(ni) - idxX(ci);
      const dy = idxY(ni) - idxY(ci);
      const jx = idxX(ni) + dx, jy = idxY(ni) + dy;
      if (jx >= 0 && jx < BOARD_SIZE && jy >= 0 && jy < BOARD_SIZE) {
        const ji = idx(jx, jy);
        if (board[ji].type === CellType.Empty) {
          const jumpOrtho = getOrthoNeighbors(ji);
          const jumpOpen = jumpOrtho.filter(n => board[n].type === CellType.Empty).length;
          if (jumpOpen >= sourceOpen && jumpOpen >= 2) {
            candidates.push(ji);
          }
        }
      }
    }
  }
  if (candidates.length === 0) return;

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  // Move: copy cell to target, clear source
  const src = board[ci];
  board[target] = {
    type: CellType.Alive, owner: src.owner, lastOwner: src.owner,
    age: src.age, resistant: src.resistant, toxinAge: 0, birthRound: src.birthRound,
  };
  board[ci] = createEmptyCell();
}

/** Necrohyphal Infiltration: convert adjacent dead enemy cells */
function tryNecrohyphalInfiltration(board: Cell[], ci: number, player: Player) {
  const level = getMutLevel(player, MutationId.NecrohyphalInfiltration);
  if (level <= 0) return;

  const baseChance = level * 0.004;
  const cascadeChance = level * 0.019;
  const ortho = getOrthoNeighbors(ci);

  for (const ni of shuffle([...ortho])) {
    const nc = board[ni];
    if (nc.type === CellType.Dead && nc.lastOwner !== -1 && nc.lastOwner !== player.id) {
      if (Math.random() < baseChance) {
        // Convert to player's living cell
        reclaimCell(board, ni, player.id);
        // Cascade
        cascadeInfiltration(board, ni, player.id, cascadeChance, new Set([ni]));
        return;
      }
    }
  }
}

function cascadeInfiltration(board: Cell[], fromIdx: number, playerId: number, chance: number, visited: Set<number>) {
  const queue = [fromIdx];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const ni of getOrthoNeighbors(curr)) {
      if (visited.has(ni)) continue;
      const nc = board[ni];
      if (nc.type === CellType.Dead && nc.lastOwner !== -1 && nc.lastOwner !== playerId) {
        if (Math.random() < chance) {
          visited.add(ni);
          reclaimCell(board, ni, playerId);
          queue.push(ni);
        }
      }
    }
  }
}

function reclaimCell(board: Cell[], i: number, playerId: number) {
  board[i] = {
    type: CellType.Alive, owner: playerId, lastOwner: playerId,
    age: 0, resistant: false, toxinAge: 0, birthRound: 0,
  };
}

// ===================== DECAY =====================

export function runDecayPhase(state: GameState) {
  const { board, players, round } = state;
  const additionalDecay = round >= DECAY_SCALING_START_ROUND
    ? (round - DECAY_SCALING_START_ROUND + 1) * DECAY_ADDITIONAL_PER_ROUND : 0;

  // Count living cells per player (needed for several mutations)
  const livingCounts = new Map<number, number>();
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (board[i].type === CellType.Alive) {
      livingCounts.set(board[i].owner, (livingCounts.get(board[i].owner) ?? 0) + 1);
    }
  }

  // Track deaths per player this round for Necrophytic Bloom
  const deathsThisRound = new Map<number, number>();

  // === Pre-decay: Putrefactive Mycotoxin kills ===
  applyPutrefactiveMycotoxin(state, livingCounts, deathsThisRound);

  // === Pre-decay: Sporicidal Bloom ===
  applySporicidalBloom(state, livingCounts);

  // === Main decay ===
  for (let i = 0; i < TOTAL_TILES; i++) {
    const cell = board[i];
    if (cell.type === CellType.Alive && !cell.resistant) {
      const player = players[cell.owner];
      const resistance = getDecayResistance(player);
      const chitinLevel = getMutLevel(player, MutationId.ChitinFortification);
      if (chitinLevel > 0 && cell.age <= 3 * TOTAL_GROWTH_CYCLES) continue;

      let decayChance = BASE_RANDOM_DECAY_CHANCE + additionalDecay - resistance;
      if (cell.age > AGE_DECAY_START * TOTAL_GROWTH_CYCLES) {
        const excessAge = cell.age - AGE_DECAY_START * TOTAL_GROWTH_CYCLES;
        decayChance += excessAge * AGE_DEATH_FACTOR_PER_CYCLE;
      }

      if (decayChance > 0 && Math.random() < decayChance) {
        killCell(state, i, deathsThisRound);
      }
    }

    // Expire toxins
    if (cell.type === CellType.Toxin && cell.age >= cell.toxinAge) {
      // Catabolic Rebirth: before clearing, check adjacent dead cells
      applyCatabolicRebirth(state, i);
      board[i] = createEmptyCell();
    }
  }

  // === Post-decay: Regenerative Hyphae ===
  applyRegenerativeHyphae(state);

  // === Post-decay: Necrophytic Bloom ===
  applyNecrophyticBloom(state, deathsThisRound);
}

/** Kill a cell and trigger death-related mutations */
function killCell(state: GameState, i: number, deathsThisRound: Map<number, number>, killerPlayerId?: number) {
  const cell = state.board[i];
  const ownerId = cell.owner;
  cell.type = CellType.Dead;
  cell.lastOwner = ownerId;
  // age keeps ticking for dead cells (visual decay)

  deathsThisRound.set(ownerId, (deathsThisRound.get(ownerId) ?? 0) + 1);

  // Necrosporulation: chance to spawn spore on random empty tile
  const player = state.players[ownerId];
  if (player) {
    const necroLevel = getMutLevel(player, MutationId.Necrosporulation);
    if (necroLevel > 0 && Math.random() < necroLevel * 0.04) {
      spawnSporeOnRandomEmpty(state, ownerId);
    }
  }

  // Necrotoxic Conversion: killer reclaims the dead cell
  if (killerPlayerId !== undefined && killerPlayerId >= 0) {
    const killer = state.players[killerPlayerId];
    if (killer) {
      const ntcLevel = getMutLevel(killer, MutationId.NecrotoxicConversion);
      if (ntcLevel > 0 && Math.random() < ntcLevel * 0.04) {
        reclaimCell(state.board, i, killerPlayerId);
        return; // cell reclaimed, skip further effects
      }
    }

    // Putrefactive Rejuvenation: reduce age of nearby friendly cells
    applyPutrefactiveRejuvenation(state, i, killerPlayerId);

    // Putrefactive Cascade: chain kills
    applyPutrefactiveCascade(state, i, killerPlayerId, deathsThisRound);
  }
}

function spawnSporeOnRandomEmpty(state: GameState, playerId: number) {
  // Pick a random tile; if empty, place spore. Try a few times.
  for (let attempt = 0; attempt < 5; attempt++) {
    const ti = Math.floor(Math.random() * TOTAL_TILES);
    if (state.board[ti].type === CellType.Empty) {
      state.board[ti] = {
        type: CellType.Alive, owner: playerId, lastOwner: playerId,
        age: 0, resistant: false, toxinAge: 0, birthRound: state.round,
      };
      return;
    }
  }
}

// ===================== PUTREFACTIVE MYCOTOXIN =====================

function applyPutrefactiveMycotoxin(state: GameState, livingCounts: Map<number, number>, deathsThisRound: Map<number, number>) {
  const { board, players } = state;
  // For each living cell, check if adjacent enemy has Putrefactive Mycotoxin
  const toKill: { idx: number; killerPlayerId: number }[] = [];

  for (let i = 0; i < TOTAL_TILES; i++) {
    const cell = board[i];
    if (cell.type !== CellType.Alive) continue;

    const ortho = getOrthoNeighbors(i);
    let totalChance = 0;
    const attackers: { playerId: number; chance: number }[] = [];

    for (const ni of ortho) {
      const nc = board[ni];
      if (nc.type === CellType.Alive && nc.owner !== cell.owner) {
        const enemy = players[nc.owner];
        const pmLevel = getMutLevel(enemy, MutationId.PutrefactiveMycotoxin);
        if (pmLevel > 0) {
          let effect = pmLevel * 0.015;
          // Putrefactive Cascade effectiveness bonus
          const cascadeLevel = getMutLevel(enemy, MutationId.PutrefactiveCascade);
          effect += cascadeLevel * 0.004;
          totalChance += effect;
          attackers.push({ playerId: nc.owner, chance: effect });
        }
      }
    }

    if (totalChance > 0 && Math.random() < totalChance) {
      // Determine killer proportionally
      const roll = Math.random() * totalChance;
      let sum = 0;
      let killer = attackers[0].playerId;
      for (const a of attackers) {
        sum += a.chance;
        if (roll < sum) { killer = a.playerId; break; }
      }
      toKill.push({ idx: i, killerPlayerId: killer });
    }
  }

  for (const { idx: ki, killerPlayerId } of toKill) {
    if (board[ki].type === CellType.Alive) {
      killCell(state, ki, deathsThisRound, killerPlayerId);
    }
  }
}

// ===================== SPORICIDAL BLOOM =====================

function applySporicidalBloom(state: GameState, livingCounts: Map<number, number>) {
  const { board, players } = state;
  for (const player of players) {
    const level = getMutLevel(player, MutationId.SporicidalBloom);
    if (level <= 0) continue;

    const myLiving = livingCounts.get(player.id) ?? 0;
    const sporesToDrop = Math.floor(myLiving * level * 0.08);
    if (sporesToDrop <= 0) continue;

    // Find available tiles (not owned by this player)
    const available: number[] = [];
    for (let i = 0; i < TOTAL_TILES; i++) {
      const c = board[i];
      if (c.owner !== player.id || c.type === CellType.Empty) {
        if (!(c.type === CellType.Alive && c.owner === player.id) && 
            !(c.type === CellType.Dead && c.lastOwner === player.id)) {
          available.push(i);
        }
      }
    }
    if (available.length === 0) continue;

    const toxinLife = SPORICIDAL_TOXIN_DURATION;
    for (let s = 0; s < sporesToDrop; s++) {
      const ti = available[Math.floor(Math.random() * available.length)];
      const tc = board[ti];
      if (tc.type === CellType.Alive && tc.owner !== player.id) {
        // Kill enemy and toxify
        tc.type = CellType.Toxin;
        tc.lastOwner = tc.owner;
        tc.owner = player.id;
        tc.age = 0;
        tc.toxinAge = toxinLife;
        tc.resistant = false;
      } else if (tc.type === CellType.Empty || tc.type === CellType.Toxin) {
        board[ti] = {
          type: CellType.Toxin, owner: player.id, lastOwner: -1,
          age: 0, resistant: false, toxinAge: toxinLife, birthRound: state.round,
        };
      }
    }
  }
}

// ===================== REGENERATIVE HYPHAE =====================

function applyRegenerativeHyphae(state: GameState) {
  const { board, players } = state;
  const attempted = new Set<number>();

  for (const player of players) {
    const baseChance = getMutLevel(player, MutationId.RegenerativeHyphae) * 0.03;
    if (baseChance <= 0) continue;

    // Hypersystemic Regeneration boost
    const hyperLevel = getMutLevel(player, MutationId.HypersystemicRegeneration);
    const effectBonus = hyperLevel * 0.01;
    const enhancedChance = baseChance * (1 + effectBonus);
    const resistChance = hyperLevel * 0.15;
    const allowDiagonal = hyperLevel >= 3; // max level

    for (let i = 0; i < TOTAL_TILES; i++) {
      const cell = board[i];
      if (cell.type !== CellType.Alive || cell.owner !== player.id) continue;

      const neighbors = allowDiagonal ? getNeighborIndices(i, true) : getOrthoNeighbors(i);
      for (const ni of neighbors) {
        if (attempted.has(ni)) continue;
        const nc = board[ni];
        if (nc.type === CellType.Dead && nc.lastOwner === player.id) {
          attempted.add(ni);
          if (Math.random() < enhancedChance) {
            reclaimCell(board, ni, player.id);
            // Hypersystemic resistance
            if (resistChance > 0 && Math.random() < resistChance) {
              board[ni].resistant = true;
            }
          }
        }
      }
    }
  }
}

// ===================== CATABOLIC REBIRTH =====================

function applyCatabolicRebirth(state: GameState, toxinIdx: number) {
  const { board, players } = state;
  const ortho = getOrthoNeighbors(toxinIdx);

  for (const ni of ortho) {
    const nc = board[ni];
    if (nc.type !== CellType.Dead || nc.lastOwner < 0) continue;
    const owner = players[nc.lastOwner];
    if (!owner) continue;
    const level = getMutLevel(owner, MutationId.CatabolicRebirth);
    if (level <= 0) continue;
    const chance = level * 0.12;
    if (Math.random() < chance) {
      reclaimCell(board, ni, owner.id);
    }
  }
}

// ===================== PUTREFACTIVE REJUVENATION =====================

function applyPutrefactiveRejuvenation(state: GameState, deathIdx: number, killerPlayerId: number) {
  const killer = state.players[killerPlayerId];
  if (!killer) return;
  const level = getMutLevel(killer, MutationId.PutrefactiveRejuvenation);
  if (level <= 0) return;

  const baseRadius = 3;
  const radius = level >= 4 ? baseRadius * 3 : baseRadius; // max level = 3x radius
  const ageReduction = level * 4;
  const cx = idxX(deathIdx), cy = idxY(deathIdx);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
      if (Math.abs(dx) + Math.abs(dy) > radius) continue; // Manhattan distance
      const ni = idx(nx, ny);
      const nc = state.board[ni];
      if (nc.type === CellType.Alive && nc.owner === killerPlayerId) {
        nc.age = Math.max(0, nc.age - ageReduction);
      }
    }
  }
}

// ===================== PUTREFACTIVE CASCADE =====================

function applyPutrefactiveCascade(state: GameState, deathIdx: number, killerPlayerId: number, deathsThisRound: Map<number, number>, depth: number = 0) {
  if (depth >= 10) return;
  const killer = state.players[killerPlayerId];
  if (!killer) return;
  const cascadeLevel = getMutLevel(killer, MutationId.PutrefactiveCascade);
  if (cascadeLevel <= 0) return;

  const cascadeChance = cascadeLevel * 0.22;
  const ortho = getOrthoNeighbors(deathIdx);

  for (const ni of ortho) {
    if (Math.random() >= cascadeChance) continue;
    const nc = state.board[ni];
    if (nc.type !== CellType.Alive || nc.owner === killerPlayerId) continue;

    // Kill the adjacent enemy
    killCell(state, ni, deathsThisRound, killerPlayerId);
    // Recurse
    applyPutrefactiveCascade(state, ni, killerPlayerId, deathsThisRound, depth + 1);
  }
}

// ===================== NECROPHYTIC BLOOM =====================

function applyNecrophyticBloom(state: GameState, deathsThisRound: Map<number, number>) {
  const { board, players } = state;

  // Check activation
  if (!state.necrophyticBloomActivated) {
    let occupied = 0;
    for (let i = 0; i < TOTAL_TILES; i++) {
      if (board[i].type !== CellType.Empty) occupied++;
    }
    if (occupied / TOTAL_TILES >= 0.20) {
      state.necrophyticBloomActivated = true;
    }
  }
  if (!state.necrophyticBloomActivated) return;

  // Damping based on occupancy
  let occupied = 0;
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (board[i].type !== CellType.Empty) occupied++;
  }
  const occupiedPct = occupied / TOTAL_TILES;
  const damping = occupiedPct <= 0.20 ? 1 : Math.max(0.15, 1 - 0.85 * ((occupiedPct - 0.20) / 0.80));

  for (const player of players) {
    const level = getMutLevel(player, MutationId.NecrophyticBloom);
    if (level <= 0) continue;
    const deaths = deathsThisRound.get(player.id) ?? 0;
    if (deaths <= 0) continue;

    const sporesPerDeath = Math.floor(level * 40 * damping);
    const totalSpores = sporesPerDeath * deaths;
    if (totalSpores <= 0) continue;

    for (let s = 0; s < totalSpores; s++) {
      const ti = Math.floor(Math.random() * TOTAL_TILES);
      const tc = board[ti];
      if (tc.type === CellType.Dead && tc.lastOwner !== player.id) {
        reclaimCell(board, ti, player.id);
      }
    }
  }
}

// ===================== MUTATION POINTS =====================

export function earnMutationPoints(state: GameState) {
  const { players } = state;

  // Count living cells for Anabolic Inversion
  const livingCounts = new Map<number, number>();
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (state.board[i].type === CellType.Alive) {
      const o = state.board[i].owner;
      livingCounts.set(o, (livingCounts.get(o) ?? 0) + 1);
    }
  }

  for (const player of players) {
    let points = 1;

    // Mutator Phenotype
    const mutatorLevel = getMutLevel(player, MutationId.MutatorPhenotype);
    const fractional = mutatorLevel * 0.1;
    player.fractionalPoints += fractional;
    if (player.fractionalPoints >= 1) {
      const bonus = Math.floor(player.fractionalPoints);
      points += bonus;
      player.fractionalPoints -= bonus;
    }

    // Anabolic Inversion: bonus when losing
    const anabolicLevel = getMutLevel(player, MutationId.AnabolicInversion);
    if (anabolicLevel > 0) {
      const myLiving = livingCounts.get(player.id) ?? 0;
      let maxEnemyLiving = 0;
      for (const p of players) {
        if (p.id !== player.id) {
          maxEnemyLiving = Math.max(maxEnemyLiving, livingCounts.get(p.id) ?? 0);
        }
      }
      if (maxEnemyLiving > myLiving && myLiving > 0) {
        const gap = (maxEnemyLiving - myLiving) / maxEnemyLiving;
        const bonusWeight = gap * anabolicLevel * 0.30;
        // Weighted random bonus 0-4 based on gap
        const roll = Math.random() * bonusWeight;
        let anabolicBonus = 0;
        if (roll > 0.6) anabolicBonus = 4;
        else if (roll > 0.4) anabolicBonus = 3;
        else if (roll > 0.2) anabolicBonus = 2;
        else if (roll > 0.1) anabolicBonus = 1;
        points += Math.min(anabolicBonus, 4);
      }
    }

    // Hyperadaptive Drift: free mutation upgrades
    const hyperDriftLevel = getMutLevel(player, MutationId.HyperadaptiveDrift);
    if (hyperDriftLevel > 0) {
      applyHyperadaptiveDrift(player, hyperDriftLevel, state.round);
    }

    // Ontogenic Regression
    const regressionLevel = getMutLevel(player, MutationId.OntogenicRegression);
    if (regressionLevel > 0) {
      applyOntogenicRegression(player, regressionLevel, state.round);
    }

    player.mutationPoints += points;
  }
}

// ===================== HYPERADAPTIVE DRIFT =====================

function applyHyperadaptiveDrift(player: Player, level: number, currentRound: number) {
  const higherTierChance = level * 0.28;

  // Find upgradeable mutations
  const tier1Pool: MutationId[] = [];
  const higherPool: MutationId[] = [];
  for (const m of MUTATIONS) {
    const cur = getMutLevel(player, m.id);
    if (cur >= m.maxLevel) continue;
    if (!isTierUnlocked(m.tier, currentRound)) continue;
    if (m.tier === 1) tier1Pool.push(m.id);
    else if (m.tier >= 2 && m.tier <= 4) higherPool.push(m.id);
  }

  if (tier1Pool.length === 0 && higherPool.length === 0) return;

  // Try for higher tier upgrade
  if (Math.random() < higherTierChance && higherPool.length > 0) {
    const pick = higherPool[Math.floor(Math.random() * higherPool.length)];
    player.mutations.set(pick, (player.mutations.get(pick) ?? 0) + 1);
  } else if (tier1Pool.length > 0) {
    // Free tier 1 upgrade
    const pick = tier1Pool[Math.floor(Math.random() * tier1Pool.length)];
    player.mutations.set(pick, (player.mutations.get(pick) ?? 0) + 1);
    
    // Bonus: chance for additional tier 1
    const bonusChance = level * 0.30;
    if (Math.random() < bonusChance && tier1Pool.length > 0) {
      const pick2 = tier1Pool[Math.floor(Math.random() * tier1Pool.length)];
      player.mutations.set(pick2, (player.mutations.get(pick2) ?? 0) + 1);
    }
  }
}

// ===================== ONTOGENIC REGRESSION =====================

function applyOntogenicRegression(player: Player, level: number, currentRound: number) {
  const chance = level * 0.30;
  const maxAttempts = level >= 3 ? 2 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Math.random() >= chance) {
      // Failure consolation
      player.mutationPoints += 2;
      continue;
    }

    // Find tier 1 mutations with at least 3 levels
    const tier1Sources: MutationId[] = [];
    for (const m of MUTATIONS) {
      if (m.tier === 1 && getMutLevel(player, m.id) >= 3) {
        tier1Sources.push(m.id);
      }
    }
    if (tier1Sources.length === 0) {
      player.mutationPoints += 2;
      continue;
    }

    // Find tier 5-6 targets that aren't maxed
    const targets: MutationId[] = [];
    for (const m of MUTATIONS) {
      if ((m.tier === 5 || m.tier === 6) && getMutLevel(player, m.id) < m.maxLevel && isTierUnlocked(m.tier, currentRound)) {
        targets.push(m.id);
      }
    }
    if (targets.length === 0) {
      player.mutationPoints += 2;
      continue;
    }

    // Consume 3 levels from random tier 1 mutation
    const source = tier1Sources[Math.floor(Math.random() * tier1Sources.length)];
    const currentLevel = getMutLevel(player, source);
    player.mutations.set(source, Math.max(0, currentLevel - 3));

    // Grant 1 level of random tier 5-6 mutation
    const target = targets[Math.floor(Math.random() * targets.length)];
    player.mutations.set(target, (player.mutations.get(target) ?? 0) + 1);
  }
}

// ===================== MUTATION UPGRADES =====================

export function upgradeMutation(player: Player, mutationId: MutationId, round: number = 1): boolean {
  const def = MUTATIONS.find(m => m.id === mutationId);
  if (!def) return false;
  if (!isTierUnlocked(def.tier, round)) return false;
  const current = getMutLevel(player, mutationId);
  if (current >= def.maxLevel) return false;
  if (player.mutationPoints < def.cost) return false;
  player.mutationPoints -= def.cost;
  player.mutations.set(mutationId, current + 1);
  return true;
}

// ===================== AI =====================

export function runAIMutations(state: GameState) {
  for (const player of state.players) {
    if (player.isHuman) continue;

    const strategy = player.aiStrategy ?? 'balanced';
    let spent = 0;
    const maxSpend = 50; // prevent infinite loop

    while (player.mutationPoints > 0 && spent < maxSpend) {
      spent++;

      // Build pool of affordable, unlocked mutations
      const affordable = MUTATIONS.filter(m => {
        const lvl = getMutLevel(player, m.id);
        return lvl < m.maxLevel && player.mutationPoints >= m.cost && isTierUnlocked(m.tier, state.round);
      });
      if (affordable.length === 0) break;

      let target: MutationId | null = null;

      if (strategy === 'growth') {
        const preferred = [MutationId.MycelialBloom, MutationId.Tendrils, MutationId.HyphalSurge,
          MutationId.HomeostaticHarmony, MutationId.MycotropicInduction, MutationId.RegenerativeHyphae,
          MutationId.CreepingMold, MutationId.NecrohyphalInfiltration, MutationId.HypersystemicRegeneration];
        const available = preferred.filter(id => affordable.some(m => m.id === id));
        if (available.length > 0) target = available[Math.floor(Math.random() * available.length)];
      } else if (strategy === 'toxin') {
        const preferred = [MutationId.MycotoxinTracer, MutationId.PutrefactiveMycotoxin,
          MutationId.SporicidalBloom, MutationId.NecrotoxicConversion, MutationId.PutrefactiveCascade,
          MutationId.PutrefactiveRejuvenation, MutationId.MycelialBloom, MutationId.CompetitiveAntagonism];
        const available = preferred.filter(id => affordable.some(m => m.id === id));
        if (available.length > 0) target = available[Math.floor(Math.random() * available.length)];
      }

      if (!target) {
        // Balanced or fallback: pick randomly from affordable, weighted toward lower tiers
        const weights = affordable.map(m => 1 / m.tier);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let roll = Math.random() * totalWeight;
        for (let i = 0; i < affordable.length; i++) {
          roll -= weights[i];
          if (roll <= 0) { target = affordable[i].id; break; }
        }
        if (!target) target = affordable[0].id;
      }

      upgradeMutation(player, target, state.round);
    }
  }
}

// ===================== SURGES =====================

export function activateSurges(state: GameState) {
  for (const player of state.players) {
    // Hyphal Surge
    if (player.surgeActive > 0) player.surgeActive--;
    const surgeLevel = getMutLevel(player, MutationId.HyphalSurge);
    if (surgeLevel > 0 && state.round % 5 === 0) {
      player.surgeActive = 2;
    }

    // Mimetic Resilience surge
    if (player.mimeticSurgeActive > 0) player.mimeticSurgeActive--;
    const mimeticLevel = getMutLevel(player, MutationId.MimeticResilience);
    if (mimeticLevel > 0 && state.round % 5 === 0) {
      player.mimeticSurgeActive = 4;
    }

    // Competitive Antagonism surge
    if (player.competitiveSurgeActive > 0) player.competitiveSurgeActive--;
    const compLevel = getMutLevel(player, MutationId.CompetitiveAntagonism);
    if (compLevel > 0 && state.round % 5 === 0) {
      player.competitiveSurgeActive = 4;
    }
  }
}

// ===================== TERRITORY & ENDGAME =====================

export function updateTerritories(state: GameState) {
  const counts = new Map<number, number>();
  for (const cell of state.board) {
    if (cell.type === CellType.Alive) {
      counts.set(cell.owner, (counts.get(cell.owner) ?? 0) + 1);
    }
  }
  for (const player of state.players) {
    player.territory = counts.get(player.id) ?? 0;
  }
}

export function checkEndgame(state: GameState): boolean {
  let occupied = 0;
  for (const cell of state.board) {
    if (cell.type !== CellType.Empty) occupied++;
  }
  if (occupied / TOTAL_TILES >= GAME_END_OCCUPANCY) {
    if (state.endgameCountdown < 0) state.endgameCountdown = 3;
    state.endgameCountdown--;
    if (state.endgameCountdown <= 0) return true;
  }
  if (state.round >= MAX_ROUNDS) return true;
  return false;
}

export function determineWinner(state: GameState): number {
  updateTerritories(state);
  let best = -1, bestCount = 0;
  for (const player of state.players) {
    if (player.territory > bestCount) {
      bestCount = player.territory;
      best = player.id;
    }
  }
  return best;
}

export function getAIStartingPositions(playerCount: number, humanX: number, humanY: number): [number, number][] {
  const positions: [number, number][] = [];
  const margin = 10;
  const candidates: [number, number][] = [
    [margin, margin],
    [BOARD_SIZE - margin, margin],
    [margin, BOARD_SIZE - margin],
    [BOARD_SIZE - margin, BOARD_SIZE - margin],
    [BOARD_SIZE / 2, margin],
    [margin, BOARD_SIZE / 2],
    [BOARD_SIZE - margin, BOARD_SIZE / 2],
    [BOARD_SIZE / 2, BOARD_SIZE - margin],
  ];
  candidates.sort((a, b) => {
    const da = Math.hypot(a[0] - humanX, a[1] - humanY);
    const db = Math.hypot(b[0] - humanX, b[1] - humanY);
    return db - da;
  });
  for (let i = 0; i < playerCount && i < candidates.length; i++) {
    positions.push(candidates[i]);
  }
  return positions;
}
