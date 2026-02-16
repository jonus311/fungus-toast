import {
  BOARD_SIZE, TOTAL_TILES, CellType, MutationId, MUTATIONS, MutationTier, MutationDef,
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
  lastOwner: number;   // -1 = none
  age: number;
  resistant: boolean;
  toxinAge: number;    // when toxin expires (growth cycles)
  birthRound: number;
  isNew?: boolean;     // for animation: was placed this cycle
}

export interface SurgeState {
  turnsRemaining: number;
  level: number;
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
  surgePoints: number;
  activeSurges: Map<MutationId, SurgeState>;
  catabolismMpThisRound: number;
}

export interface RoundStats {
  cellsGained: Map<number, number>;
  cellsLost: Map<number, number>;
  cellsKilled: Map<number, number>;
  toxinsPlaced: Map<number, number>;
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
  roundStats: RoundStats;
  history: Uint8Array[]; // snapshots for replay
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

function isSurgeActive(player: Player, id: MutationId): boolean {
  const s = player.activeSurges.get(id);
  return s !== undefined && s.turnsRemaining > 0;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function addLog(state: GameState, msg: string) {
  state.log.push(msg);
  if (state.log.length > 200) state.log.shift();
}

function incStat(map: Map<number, number>, key: number, amount: number = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

// ===================== INIT =====================

function createRoundStats(): RoundStats {
  return {
    cellsGained: new Map(), cellsLost: new Map(),
    cellsKilled: new Map(), toxinsPlaced: new Map(),
  };
}

export function createInitialState(): GameState {
  const board: Cell[] = new Array(TOTAL_TILES);
  for (let i = 0; i < TOTAL_TILES; i++) board[i] = createEmptyCell();
  return {
    board, players: [], round: 1, growthCycle: 0,
    phase: 'setup', speed: 1, endgameCountdown: -1, winner: -1,
    log: [], necrophyticBloomActivated: false,
    roundStats: createRoundStats(), history: [],
  };
}

export function addPlayer(state: GameState, name: string, isHuman: boolean, strategy?: 'growth' | 'toxin' | 'balanced'): Player {
  const p: Player = {
    id: state.players.length, name, isHuman,
    mutations: new Map(), mutationPoints: STARTING_MUTATION_POINTS, fractionalPoints: 0,
    territory: 0, aiStrategy: strategy, surgePoints: 0,
    activeSurges: new Map(), catabolismMpThisRound: 0,
  };
  state.players.push(p);
  return p;
}

export function placeStartingSpore(state: GameState, playerId: number, x: number, y: number) {
  const i = idx(x, y);
  if (state.board[i].type !== CellType.Empty) return false;
  state.board[i] = {
    type: CellType.Alive, owner: playerId, lastOwner: playerId,
    age: 0, resistant: true, toxinAge: 0, birthRound: state.round, isNew: true,
  };
  return true;
}

// ===================== SURGE POINT SYSTEM =====================

function getSurgeActivationCost(def: MutationDef, level: number): number {
  return (def.surgePointCost ?? 5) + (level - 1) * (def.surgePointIncreasePerLevel ?? 1);
}

/** Accumulate surge points from territory each round */
function accumulateSurgePoints(state: GameState) {
  for (const player of state.players) {
    // Points from territory: 1 point per 400 living cells
    const livingCount = player.territory;
    const pointsFromTerritory = Math.floor(livingCount / 400);
    // Base 1 point per round + territory bonus
    player.surgePoints += 1 + pointsFromTerritory;
  }
}

/** Try to activate surges for all players */
export function activateSurges(state: GameState) {
  accumulateSurgePoints(state);

  for (const player of state.players) {
    // Tick down active surges
    for (const [id, surge] of player.activeSurges) {
      surge.turnsRemaining--;
      if (surge.turnsRemaining <= 0) {
        player.activeSurges.delete(id);
      }
    }

    // Try to activate surges that have enough points
    const surgeMutations = MUTATIONS.filter(m => m.isSurge);
    for (const def of surgeMutations) {
      const level = getMutLevel(player, def.id);
      if (level <= 0) continue;
      if (isSurgeActive(player, def.id)) continue;
      const cost = getSurgeActivationCost(def, level);
      if (player.surgePoints >= cost) {
        player.surgePoints -= cost;
        player.activeSurges.set(def.id, {
          turnsRemaining: def.surgeDuration ?? 2,
          level,
        });
        addLog(state, `${player.name}'s ${def.name} surge activated!`);
      }
    }
  }
}

// ===================== GROWTH MECHANICS =====================

function getGrowthChance(player: Player): number {
  let chance = BASE_GROWTH_CHANCE;
  chance += getMutLevel(player, MutationId.MycelialBloom) * 0.0025;
  if (isSurgeActive(player, MutationId.HyphalSurge))
    chance += getMutLevel(player, MutationId.HyphalSurge) * 0.009;
  return chance;
}

function getDiagonalChance(player: Player): number {
  return getMutLevel(player, MutationId.Tendrils) * 0.01;
}

function getDecayResistance(player: Player): number {
  return getMutLevel(player, MutationId.HomeostaticHarmony) * 0.003;
}

function getAgeDecayStart(player: Player): number {
  const chronoLevel = getMutLevel(player, MutationId.ChronoresilientCytoplasm);
  return (AGE_DECAY_START + chronoLevel * 4) * TOTAL_GROWTH_CYCLES;
}

function getMycotropicBonus(player: Player, cellIdx: number, board: Cell[]): number {
  const level = getMutLevel(player, MutationId.MycotropicInduction);
  if (level <= 0) return 0;
  const neighbors = getOrthoNeighbors(cellIdx);
  for (const ni of neighbors) {
    const nc = board[ni];
    if (nc.type === CellType.Alive && nc.owner !== player.id) {
      return level * 0.25;
    }
  }
  return 0;
}

export function runGrowthCycle(state: GameState) {
  const { board, players } = state;
  const newCells: { idx: number; owner: number }[] = [];

  // Clear isNew flags from previous cycle
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (board[i].isNew) board[i].isNew = false;
  }

  // Collect living cells per player
  const livingByPlayer = new Map<number, number[]>();
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (board[i].type === CellType.Alive) {
      const o = board[i].owner;
      if (!livingByPlayer.has(o)) livingByPlayer.set(o, []);
      livingByPlayer.get(o)!.push(i);
    }
  }

  // Mycotoxin Catabolism: clean enemy toxins pre-growth
  for (const player of players) {
    applyMycotoxinCatabolism(state, player, livingByPlayer.get(player.id) ?? []);
  }

  for (const [playerId, cells] of livingByPlayer) {
    const player = players[playerId];
    const baseGrowth = getGrowthChance(player);
    const diagChance = getDiagonalChance(player);
    const toxinLevel = getMutLevel(player, MutationId.MycotoxinTracer);
    const creepingLevel = getMutLevel(player, MutationId.CreepingMold);
    const moveChance = creepingLevel * 0.035;
    const potentiationKillChance = getMutLevel(player, MutationId.MycotoxinPotentiation) * 0.016;

    for (const ci of cells) {
      const mycotropicMult = 1 + getMycotropicBonus(player, ci, board);
      const growthChance = baseGrowth * mycotropicMult;

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
              const potDuration = TOXIN_DURATION + getMutLevel(player, MutationId.MycotoxinPotentiation);
              board[ni] = {
                type: CellType.Toxin, owner: playerId, lastOwner: -1,
                age: 0, resistant: false, toxinAge: potDuration, birthRound: state.round,
              };
              incStat(state.roundStats.toxinsPlaced, playerId);
            }
          }
        }
        // Mycotoxin Potentiation: toxins adjacent to living cells have kill chance
        if (nc.type === CellType.Toxin && nc.owner === playerId && potentiationKillChance > 0) {
          for (const tni of getOrthoNeighbors(ni)) {
            const tnc = board[tni];
            if (tnc.type === CellType.Alive && tnc.owner !== playerId && Math.random() < potentiationKillChance) {
              // Use a temporary deaths map for potentiation kills
              const tempDeaths = new Map<number, number>();
              killCell(state, tni, tempDeaths, playerId);
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

      // Creeping Mold
      if (creepingLevel > 0 && !grew && Math.random() < moveChance) {
        tryCreepingMoldMove(board, ci, player, creepingLevel);
      }

      // Necrohyphal Infiltration
      if (!grew) {
        tryNecrohyphalInfiltration(board, ci, player);
      }
    }
  }

  // Apply Hyphal Vectoring surge
  for (const player of players) {
    if (isSurgeActive(player, MutationId.HyphalVectoring) && state.growthCycle === 0) {
      applyHyphalVectoring(state, player);
    }
  }

  // Apply Chitin Fortification surge
  for (const player of players) {
    if (isSurgeActive(player, MutationId.ChitinFortification) && state.growthCycle === 0) {
      applyChitinFortification(state, player);
    }
  }

  // Apply new cells
  shuffle(newCells);
  for (const { idx: ni, owner } of newCells) {
    if (board[ni].type === CellType.Empty) {
      board[ni] = {
        type: CellType.Alive, owner, lastOwner: owner,
        age: 0, resistant: false, toxinAge: 0, birthRound: state.round, isNew: true,
      };
      incStat(state.roundStats.cellsGained, owner);
    }
  }

  // Age all cells
  for (let i = 0; i < TOTAL_TILES; i++) {
    const c = board[i];
    if (c.type === CellType.Alive || c.type === CellType.Toxin) c.age++;
  }

  state.growthCycle++;
}

// ===================== HYPHAL VECTORING =====================

function applyHyphalVectoring(state: GameState, player: Player) {
  const level = getMutLevel(player, MutationId.HyphalVectoring);
  if (level <= 0) return;
  const totalTiles = 3 + level;
  const centerX = BOARD_SIZE / 2, centerY = BOARD_SIZE / 2;

  // Find frontier cells (living cells with at least one empty neighbor)
  const frontier: number[] = [];
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (state.board[i].type === CellType.Alive && state.board[i].owner === player.id) {
      const neighbors = getOrthoNeighbors(i);
      if (neighbors.some(ni => state.board[ni].type === CellType.Empty || (state.board[ni].type === CellType.Alive && state.board[ni].owner !== player.id))) {
        frontier.push(i);
      }
    }
  }
  if (frontier.length === 0) return;

  // Pick the frontier cell closest to center with fewest friendly cells in path
  let bestCell = frontier[0];
  let bestScore = Infinity;
  const checkCount = Math.min(50, frontier.length);
  const shuffled = shuffle([...frontier]).slice(0, checkCount);
  for (const ci of shuffled) {
    const cx = idxX(ci), cy = idxY(ci);
    const dist = Math.hypot(cx - centerX, cy - centerY);
    if (dist < bestScore) {
      bestScore = dist;
      bestCell = ci;
    }
  }

  // Grow a line toward center
  const sx = idxX(bestCell), sy = idxY(bestCell);
  const dx = Math.sign(centerX - sx);
  const dy = Math.sign(centerY - sy);
  let cx = sx, cy = sy;
  let placed = 0;

  for (let i = 0; i < totalTiles; i++) {
    cx += dx;
    cy += dy;
    if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) break;
    const ti = idx(cx, cy);
    const tc = state.board[ti];
    if (tc.type === CellType.Alive && tc.owner === player.id) continue; // skip own cells
    // Overwrite everything else
    state.board[ti] = {
      type: CellType.Alive, owner: player.id, lastOwner: player.id,
      age: 0, resistant: false, toxinAge: 0, birthRound: state.round, isNew: true,
    };
    placed++;
    incStat(state.roundStats.cellsGained, player.id);
  }
  if (placed > 0) {
    addLog(state, `${player.name}'s Hyphal Vectoring grew ${placed} cells!`);
  }
}

// ===================== CHITIN FORTIFICATION =====================

function applyChitinFortification(state: GameState, player: Player) {
  const level = getMutLevel(player, MutationId.ChitinFortification);
  if (level <= 0) return;

  const livingCells: number[] = [];
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (state.board[i].type === CellType.Alive && state.board[i].owner === player.id && !state.board[i].resistant) {
      livingCells.push(i);
    }
  }
  const count = Math.min(level, livingCells.length);
  shuffle(livingCells);
  for (let i = 0; i < count; i++) {
    state.board[livingCells[i]].resistant = true;
  }
}

// ===================== MYCOTOXIN CATABOLISM =====================

function applyMycotoxinCatabolism(state: GameState, player: Player, livingCells: number[]) {
  const level = getMutLevel(player, MutationId.MycotoxinCatabolism);
  if (level <= 0) return;

  player.catabolismMpThisRound = 0;
  const cleanupChance = level * 0.032;
  const mpChance = level * 0.08;
  const processed = new Set<number>();

  for (const ci of livingCells) {
    for (const ni of getOrthoNeighbors(ci)) {
      if (processed.has(ni)) continue;
      const nc = state.board[ni];
      if (nc.type === CellType.Toxin && nc.owner !== player.id) {
        processed.add(ni);
        if (Math.random() < cleanupChance) {
          state.board[ni] = createEmptyCell();
          // MP chance
          if (player.catabolismMpThisRound < 3 && Math.random() < mpChance) {
            player.mutationPoints += 1;
            player.catabolismMpThisRound++;
          }
        }
      }
    }
  }
  if (processed.size > 0 && player.catabolismMpThisRound > 0) {
    addLog(state, `${player.name}'s Catabolism cleaned toxins, earned ${player.catabolismMpThisRound} MP`);
  }
}

// ===================== CREEPING MOLD =====================

function tryCreepingMoldMove(board: Cell[], ci: number, player: Player, level: number) {
  const ortho = getOrthoNeighbors(ci);
  const sourceOpen = ortho.filter(n => board[n].type === CellType.Empty).length;
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
  const src = board[ci];
  board[target] = {
    type: CellType.Alive, owner: src.owner, lastOwner: src.owner,
    age: src.age, resistant: src.resistant, toxinAge: 0, birthRound: src.birthRound,
  };
  board[ci] = createEmptyCell();
}

// ===================== NECROHYPHAL INFILTRATION =====================

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
        reclaimCell(board, ni, player.id);
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
    age: 0, resistant: false, toxinAge: 0, birthRound: 0, isNew: true,
  };
}

// ===================== DECAY =====================

export function runDecayPhase(state: GameState) {
  const { board, players, round } = state;
  const additionalDecay = round >= DECAY_SCALING_START_ROUND
    ? (round - DECAY_SCALING_START_ROUND + 1) * DECAY_ADDITIONAL_PER_ROUND : 0;

  const livingCounts = new Map<number, number>();
  for (let i = 0; i < TOTAL_TILES; i++) {
    if (board[i].type === CellType.Alive) {
      livingCounts.set(board[i].owner, (livingCounts.get(board[i].owner) ?? 0) + 1);
    }
  }

  const deathsThisRound = new Map<number, number>();

  // Putrefactive Mycotoxin kills
  applyPutrefactiveMycotoxin(state, livingCounts, deathsThisRound);

  // Sporicidal Bloom
  applySporicidalBloom(state, livingCounts);

  // Main decay
  for (let i = 0; i < TOTAL_TILES; i++) {
    const cell = board[i];
    if (cell.type === CellType.Alive && !cell.resistant) {
      const player = players[cell.owner];
      const resistance = getDecayResistance(player);
      const chitinLevel = getMutLevel(player, MutationId.ChitinFortification);
      if (chitinLevel > 0 && cell.age <= 3 * TOTAL_GROWTH_CYCLES) continue;

      const ageThreshold = getAgeDecayStart(player);
      let decayChance = BASE_RANDOM_DECAY_CHANCE + additionalDecay - resistance;
      if (cell.age > ageThreshold) {
        const excessAge = cell.age - ageThreshold;
        decayChance += excessAge * AGE_DEATH_FACTOR_PER_CYCLE;
      }

      if (decayChance > 0 && Math.random() < decayChance) {
        killCell(state, i, deathsThisRound);
      }
    }

    // Expire toxins
    if (cell.type === CellType.Toxin && cell.age >= cell.toxinAge) {
      applyCatabolicRebirth(state, i);
      board[i] = createEmptyCell();
    }
  }

  // Regenerative Hyphae
  applyRegenerativeHyphae(state);

  // Necrophytic Bloom
  applyNecrophyticBloom(state, deathsThisRound);

  // Log round stats
  for (const p of players) {
    const gained = state.roundStats.cellsGained.get(p.id) ?? 0;
    const lost = state.roundStats.cellsLost.get(p.id) ?? 0;
    const killed = state.roundStats.cellsKilled.get(p.id) ?? 0;
    if (gained > 10 || lost > 10 || killed > 5) {
      addLog(state, `R${round} ${p.name}: +${gained} -${lost} killed:${killed}`);
    }
  }
}

function killCell(state: GameState, i: number, deathsThisRound: Map<number, number>, killerPlayerId?: number) {
  const cell = state.board[i];
  const ownerId = cell.owner;
  cell.type = CellType.Dead;
  cell.lastOwner = ownerId;

  deathsThisRound.set(ownerId, (deathsThisRound.get(ownerId) ?? 0) + 1);
  incStat(state.roundStats.cellsLost, ownerId);
  if (killerPlayerId !== undefined && killerPlayerId >= 0) {
    incStat(state.roundStats.cellsKilled, killerPlayerId);
  }

  const player = state.players[ownerId];
  if (player) {
    const necroLevel = getMutLevel(player, MutationId.Necrosporulation);
    if (necroLevel > 0 && Math.random() < necroLevel * 0.04) {
      spawnSporeOnRandomEmpty(state, ownerId);
    }
  }

  if (killerPlayerId !== undefined && killerPlayerId >= 0) {
    const killer = state.players[killerPlayerId];
    if (killer) {
      const ntcLevel = getMutLevel(killer, MutationId.NecrotoxicConversion);
      if (ntcLevel > 0 && Math.random() < ntcLevel * 0.04) {
        reclaimCell(state.board, i, killerPlayerId);
        return;
      }
    }
    applyPutrefactiveRejuvenation(state, i, killerPlayerId);
    applyPutrefactiveCascade(state, i, killerPlayerId, deathsThisRound);
  }
}

function spawnSporeOnRandomEmpty(state: GameState, playerId: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ti = Math.floor(Math.random() * TOTAL_TILES);
    if (state.board[ti].type === CellType.Empty) {
      state.board[ti] = {
        type: CellType.Alive, owner: playerId, lastOwner: playerId,
        age: 0, resistant: false, toxinAge: 0, birthRound: state.round, isNew: true,
      };
      return;
    }
  }
}

// ===================== PUTREFACTIVE MYCOTOXIN =====================

function applyPutrefactiveMycotoxin(state: GameState, livingCounts: Map<number, number>, deathsThisRound: Map<number, number>) {
  const { board, players } = state;
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
          const cascadeLevel = getMutLevel(enemy, MutationId.PutrefactiveCascade);
          effect += cascadeLevel * 0.004;
          totalChance += effect;
          attackers.push({ playerId: nc.owner, chance: effect });
        }
      }
    }

    if (totalChance > 0 && Math.random() < totalChance) {
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

    const toxinLife = SPORICIDAL_TOXIN_DURATION + getMutLevel(player, MutationId.MycotoxinPotentiation);
    let placed = 0;
    for (let s = 0; s < sporesToDrop; s++) {
      const ti = available[Math.floor(Math.random() * available.length)];
      const tc = board[ti];
      if (tc.type === CellType.Alive && tc.owner !== player.id) {
        tc.type = CellType.Toxin;
        tc.lastOwner = tc.owner;
        tc.owner = player.id;
        tc.age = 0;
        tc.toxinAge = toxinLife;
        tc.resistant = false;
        placed++;
      } else if (tc.type === CellType.Empty || tc.type === CellType.Toxin) {
        board[ti] = {
          type: CellType.Toxin, owner: player.id, lastOwner: -1,
          age: 0, resistant: false, toxinAge: toxinLife, birthRound: state.round,
        };
        placed++;
      }
    }
    if (placed > 0) {
      incStat(state.roundStats.toxinsPlaced, player.id, placed);
      addLog(state, `${player.name}'s Sporicidal Bloom placed ${placed} toxins`);
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

    const hyperLevel = getMutLevel(player, MutationId.HypersystemicRegeneration);
    const effectBonus = hyperLevel * 0.01;
    const enhancedChance = baseChance * (1 + effectBonus);
    const resistChance = hyperLevel * 0.15;
    const allowDiagonal = hyperLevel >= 3;

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
  const radius = level >= 4 ? baseRadius * 3 : baseRadius;
  const ageReduction = level * 4;
  const cx = idxX(deathIdx), cy = idxY(deathIdx);

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
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
    killCell(state, ni, deathsThisRound, killerPlayerId);
    applyPutrefactiveCascade(state, ni, killerPlayerId, deathsThisRound, depth + 1);
  }
}

// ===================== NECROPHYTIC BLOOM =====================

function applyNecrophyticBloom(state: GameState, deathsThisRound: Map<number, number>) {
  const { board, players } = state;

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

    let reclaims = 0;
    for (let s = 0; s < totalSpores; s++) {
      const ti = Math.floor(Math.random() * TOTAL_TILES);
      const tc = board[ti];
      if (tc.type === CellType.Dead && tc.lastOwner !== player.id) {
        reclaimCell(board, ti, player.id);
        reclaims++;
      }
    }
    if (reclaims > 0) {
      addLog(state, `${player.name}'s Necrophytic Bloom spawned ${reclaims} spores!`);
    }
  }
}

// ===================== MUTATION POINTS =====================

export function earnMutationPoints(state: GameState) {
  const { players } = state;

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

    // Adaptive Expression
    const aeLevel = getMutLevel(player, MutationId.AdaptiveExpression);
    if (aeLevel > 0) {
      const aeChance = aeLevel * 0.19;
      if (Math.random() < aeChance) {
        points += 1;
        const secondChance = aeLevel * 0.14;
        if (Math.random() < secondChance) {
          points += 1;
        }
      }
    }

    // Anabolic Inversion
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
        const roll = Math.random() * bonusWeight;
        let anabolicBonus = 0;
        if (roll > 0.6) anabolicBonus = 4;
        else if (roll > 0.4) anabolicBonus = 3;
        else if (roll > 0.2) anabolicBonus = 2;
        else if (roll > 0.1) anabolicBonus = 1;
        points += Math.min(anabolicBonus, 4);
      }
    }

    // Hyperadaptive Drift
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

  const tier1Pool: MutationId[] = [];
  const higherPool: MutationId[] = [];
  for (const m of MUTATIONS) {
    const cur = getMutLevel(player, m.id);
    if (cur >= m.maxLevel) continue;
    if (!isTierUnlocked(m.tier, currentRound)) continue;
    if (m.isSurge) continue; // Surges can't be auto-upgraded
    if (m.tier === 1) tier1Pool.push(m.id);
    else if (m.tier >= 2 && m.tier <= 4) higherPool.push(m.id);
  }

  if (tier1Pool.length === 0 && higherPool.length === 0) return;

  if (Math.random() < higherTierChance && higherPool.length > 0) {
    const pick = higherPool[Math.floor(Math.random() * higherPool.length)];
    player.mutations.set(pick, (player.mutations.get(pick) ?? 0) + 1);
  } else if (tier1Pool.length > 0) {
    const pick = tier1Pool[Math.floor(Math.random() * tier1Pool.length)];
    player.mutations.set(pick, (player.mutations.get(pick) ?? 0) + 1);
    
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
      player.mutationPoints += 2;
      continue;
    }

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

    const targets: MutationId[] = [];
    for (const m of MUTATIONS) {
      if ((m.tier === 5 || m.tier === 6) && getMutLevel(player, m.id) < m.maxLevel && isTierUnlocked(m.tier, currentRound) && !m.isSurge) {
        targets.push(m.id);
      }
    }
    if (targets.length === 0) {
      player.mutationPoints += 2;
      continue;
    }

    const source = tier1Sources[Math.floor(Math.random() * tier1Sources.length)];
    const currentLevel = getMutLevel(player, source);
    player.mutations.set(source, Math.max(0, currentLevel - 3));

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

// ===================== SMARTER AI =====================

interface AIGoal {
  id: MutationId;
  targetLevel?: number;
}

const GROWTH_GOALS: AIGoal[] = [
  { id: MutationId.MycelialBloom },
  { id: MutationId.Tendrils, targetLevel: 5 },
  { id: MutationId.CreepingMold },
  { id: MutationId.MycotropicInduction, targetLevel: 2 },
  { id: MutationId.RegenerativeHyphae },
  { id: MutationId.HyphalSurge, targetLevel: 5 },
  { id: MutationId.HyphalVectoring, targetLevel: 3 },
  { id: MutationId.NecrohyphalInfiltration },
  { id: MutationId.HypersystemicRegeneration },
];

const TOXIN_GOALS: AIGoal[] = [
  { id: MutationId.MycotoxinTracer, targetLevel: 10 },
  { id: MutationId.MycotoxinPotentiation, targetLevel: 5 },
  { id: MutationId.PutrefactiveMycotoxin },
  { id: MutationId.SporicidalBloom },
  { id: MutationId.NecrotoxicConversion },
  { id: MutationId.PutrefactiveCascade },
  { id: MutationId.PutrefactiveRejuvenation },
  { id: MutationId.CompetitiveAntagonism, targetLevel: 2 },
];

const BALANCED_GOALS: AIGoal[] = [
  { id: MutationId.MycelialBloom },
  { id: MutationId.CreepingMold },
  { id: MutationId.Necrosporulation },
  { id: MutationId.PutrefactiveMycotoxin },
  { id: MutationId.NecrohyphalInfiltration },
  { id: MutationId.CatabolicRebirth },
  { id: MutationId.HyperadaptiveDrift },
];

function getAIGoals(strategy: string): AIGoal[] {
  switch (strategy) {
    case 'growth': return GROWTH_GOALS;
    case 'toxin': return TOXIN_GOALS;
    default: return BALANCED_GOALS;
  }
}

export function runAIMutations(state: GameState) {
  for (const player of state.players) {
    if (player.isHuman) continue;

    const strategy = player.aiStrategy ?? 'balanced';
    const goals = getAIGoals(strategy);
    let spent = 0;
    const maxSpend = 80;

    // Early game: prioritize economy mutations
    if (state.round <= 10) {
      const econMuts = [MutationId.MutatorPhenotype, MutationId.AdaptiveExpression];
      for (const econId of econMuts) {
        if (player.mutationPoints <= 0) break;
        const def = MUTATIONS.find(m => m.id === econId);
        if (!def) continue;
        const lvl = getMutLevel(player, econId);
        if (lvl < Math.min(3, def.maxLevel) && player.mutationPoints >= def.cost && isTierUnlocked(def.tier, state.round)) {
          upgradeMutation(player, econId, state.round);
          spent++;
        }
      }
    }

    // Work through goals sequentially
    for (const goal of goals) {
      if (player.mutationPoints <= 0 || spent >= maxSpend) break;
      const def = MUTATIONS.find(m => m.id === goal.id);
      if (!def) continue;
      if (!isTierUnlocked(def.tier, state.round)) continue;
      const targetLvl = goal.targetLevel ?? def.maxLevel;
      const currentLvl = getMutLevel(player, goal.id);
      if (currentLvl >= targetLvl) continue;

      // Check if we should save for higher-tier mutation
      if (def.cost > player.mutationPoints) {
        // Save points for this expensive mutation if it's coming soon
        if (def.cost <= player.mutationPoints + 3) break;
        continue;
      }

      while (getMutLevel(player, goal.id) < targetLvl && player.mutationPoints >= def.cost && spent < maxSpend) {
        if (!upgradeMutation(player, goal.id, state.round)) break;
        spent++;
      }
    }

    // Spend remaining on fallback (weighted toward strategy-relevant categories)
    while (player.mutationPoints > 0 && spent < maxSpend) {
      spent++;
      const affordable = MUTATIONS.filter(m => {
        const lvl = getMutLevel(player, m.id);
        return lvl < m.maxLevel && player.mutationPoints >= m.cost && isTierUnlocked(m.tier, state.round);
      });
      if (affordable.length === 0) break;

      // Weight by strategy relevance
      const weights = affordable.map(m => {
        let w = 1 / m.tier;
        if (strategy === 'growth' && (m.category === 'growth' || m.category === 'cellularResilience')) w *= 3;
        if (strategy === 'toxin' && m.category === 'fungicide') w *= 3;
        if (m.category === 'geneticDrift') w *= 1.5; // economy always somewhat useful
        return w;
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let roll = Math.random() * totalWeight;
      let target = affordable[0].id;
      for (let i = 0; i < affordable.length; i++) {
        roll -= weights[i];
        if (roll <= 0) { target = affordable[i].id; break; }
      }

      upgradeMutation(player, target, state.round);
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

/** Take a snapshot of the board for replay */
export function snapshotBoard(state: GameState): Uint8Array {
  // 2 bytes per cell: type+owner (byte1), flags (byte2)
  const snap = new Uint8Array(TOTAL_TILES * 2);
  for (let i = 0; i < TOTAL_TILES; i++) {
    const c = state.board[i];
    snap[i * 2] = (c.type << 4) | ((c.owner + 1) & 0x0F);
    snap[i * 2 + 1] = (c.resistant ? 1 : 0) | (c.isNew ? 2 : 0);
  }
  return snap;
}

export function resetRoundStats(state: GameState) {
  state.roundStats = createRoundStats();
  for (const p of state.players) {
    p.catabolismMpThisRound = 0;
  }
}
