import {
  BOARD_SIZE, TOTAL_TILES, CellType, MutationId, MUTATIONS,
  BASE_GROWTH_CHANCE, BASE_RANDOM_DECAY_CHANCE, AGE_DECAY_START,
  AGE_DEATH_FACTOR_PER_CYCLE, TOTAL_GROWTH_CYCLES, GAME_END_OCCUPANCY,
  STARTING_MUTATION_POINTS, MAX_ROUNDS, TOXIN_DURATION,
  DECAY_SCALING_START_ROUND, DECAY_ADDITIONAL_PER_ROUND,
} from './constants';

export interface Cell {
  type: CellType;
  owner: number; // -1 = none
  age: number; // growth cycles
  resistant: boolean;
  toxinAge: number; // when toxin expires
  birthRound: number;
}

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  mutations: Map<MutationId, number>; // mutation -> level
  mutationPoints: number;
  fractionalPoints: number; // accumulate fractional MP
  territory: number;
  aiStrategy?: 'growth' | 'toxin' | 'balanced';
  surgeActive: number; // rounds remaining
}

export interface GameState {
  board: Cell[];
  players: Player[];
  round: number;
  growthCycle: number;
  phase: 'setup' | 'mutation' | 'growth' | 'decay' | 'ended';
  speed: number; // 0=paused, 1,2,5
  endgameCountdown: number;
  winner: number; // -1 = none
  log: string[];
}

export function createEmptyCell(): Cell {
  return { type: CellType.Empty, owner: -1, age: 0, resistant: false, toxinAge: 0, birthRound: 0 };
}

export function createInitialState(): GameState {
  const board: Cell[] = new Array(TOTAL_TILES);
  for (let i = 0; i < TOTAL_TILES; i++) board[i] = createEmptyCell();
  return {
    board,
    players: [],
    round: 1,
    growthCycle: 0,
    phase: 'setup',
    speed: 1,
    endgameCountdown: -1,
    winner: -1,
    log: [],
  };
}

export function addPlayer(state: GameState, name: string, isHuman: boolean, strategy?: 'growth' | 'toxin' | 'balanced'): Player {
  const p: Player = {
    id: state.players.length,
    name,
    isHuman,
    mutations: new Map(),
    mutationPoints: STARTING_MUTATION_POINTS,
    fractionalPoints: 0,
    territory: 0,
    aiStrategy: strategy,
    surgeActive: 0,
  };
  state.players.push(p);
  return p;
}

export function placeStartingSpore(state: GameState, playerId: number, x: number, y: number) {
  const idx = y * BOARD_SIZE + x;
  if (state.board[idx].type !== CellType.Empty) return false;
  state.board[idx] = {
    type: CellType.Alive,
    owner: playerId,
    age: 0,
    resistant: true,
    toxinAge: 0,
    birthRound: state.round,
  };
  return true;
}

function getNeighbors(idx: number, diagonal: boolean): number[] {
  const x = idx % BOARD_SIZE, y = Math.floor(idx / BOARD_SIZE);
  const result: number[] = [];
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  if (diagonal) dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE)
      result.push(ny * BOARD_SIZE + nx);
  }
  return result;
}

function getMutLevel(player: Player, id: MutationId): number {
  return player.mutations.get(id) ?? 0;
}

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

export function runGrowthCycle(state: GameState) {
  const newCells: { idx: number; owner: number }[] = [];
  const failedGrowths = new Map<number, number>(); // playerId -> count
  
  // Collect all living cells
  const livingByPlayer = new Map<number, number[]>();
  for (let i = 0; i < TOTAL_TILES; i++) {
    const cell = state.board[i];
    if (cell.type === CellType.Alive) {
      if (!livingByPlayer.has(cell.owner)) livingByPlayer.set(cell.owner, []);
      livingByPlayer.get(cell.owner)!.push(i);
    }
  }

  for (const [playerId, cells] of livingByPlayer) {
    const player = state.players[playerId];
    const growthChance = getGrowthChance(player);
    const diagChance = getDiagonalChance(player);
    const toxinLevel = getMutLevel(player, MutationId.MycotoxinTracer);

    for (const idx of cells) {
      // Orthogonal growth
      const orthoNeighbors = getNeighbors(idx, false);
      for (const nIdx of orthoNeighbors) {
        if (state.board[nIdx].type === CellType.Empty && Math.random() < growthChance) {
          newCells.push({ idx: nIdx, owner: playerId });
        } else if (state.board[nIdx].type === CellType.Empty && toxinLevel > 0) {
          const toxinChance = toxinLevel * 0.013;
          if (Math.random() < toxinChance * 0.1) {
            // Place toxin
            state.board[nIdx] = {
              type: CellType.Toxin,
              owner: playerId,
              age: 0,
              resistant: false,
              toxinAge: TOXIN_DURATION,
              birthRound: state.round,
            };
          } else {
            failedGrowths.set(playerId, (failedGrowths.get(playerId) ?? 0) + 1);
          }
        }
      }
      // Diagonal growth
      if (diagChance > 0) {
        const diagNeighbors = getNeighbors(idx, true).filter(n => !orthoNeighbors.includes(n));
        for (const nIdx of diagNeighbors) {
          if (state.board[nIdx].type === CellType.Empty && Math.random() < diagChance) {
            newCells.push({ idx: nIdx, owner: playerId });
          }
        }
      }
    }
  }

  // Apply new cells (first come first served for contested tiles)
  // Shuffle to avoid bias
  for (let i = newCells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newCells[i], newCells[j]] = [newCells[j], newCells[i]];
  }
  for (const { idx, owner } of newCells) {
    if (state.board[idx].type === CellType.Empty) {
      state.board[idx] = {
        type: CellType.Alive,
        owner,
        age: 0,
        resistant: false,
        toxinAge: 0,
        birthRound: state.round,
      };
    }
  }

  // Age all living cells
  for (let i = 0; i < TOTAL_TILES; i++) {
    const cell = state.board[i];
    if (cell.type === CellType.Alive) cell.age++;
    if (cell.type === CellType.Toxin) cell.age++;
  }

  state.growthCycle++;
}

export function runDecayPhase(state: GameState) {
  const additionalDecay = state.round >= DECAY_SCALING_START_ROUND
    ? (state.round - DECAY_SCALING_START_ROUND + 1) * DECAY_ADDITIONAL_PER_ROUND
    : 0;

  for (let i = 0; i < TOTAL_TILES; i++) {
    const cell = state.board[i];
    if (cell.type === CellType.Alive && !cell.resistant) {
      const player = state.players[cell.owner];
      const resistance = getDecayResistance(player);
      
      // Chitin fortification check
      const chitinLevel = getMutLevel(player, MutationId.ChitinFortification);
      if (chitinLevel > 0 && cell.age <= 3 * TOTAL_GROWTH_CYCLES) continue; // young fortified cells resist

      let decayChance = BASE_RANDOM_DECAY_CHANCE + additionalDecay - resistance;
      
      // Age-based decay
      if (cell.age > AGE_DECAY_START * TOTAL_GROWTH_CYCLES) {
        const excessAge = cell.age - AGE_DECAY_START * TOTAL_GROWTH_CYCLES;
        decayChance += excessAge * AGE_DEATH_FACTOR_PER_CYCLE;
      }
      
      if (decayChance > 0 && Math.random() < decayChance) {
        cell.type = CellType.Dead;
      }
    }
    // Expire toxins
    if (cell.type === CellType.Toxin && cell.age >= cell.toxinAge) {
      state.board[i] = createEmptyCell();
    }
  }
}

export function earnMutationPoints(state: GameState) {
  for (const player of state.players) {
    let points = 1;
    const mutatorLevel = getMutLevel(player, MutationId.MutatorPhenotype);
    const fractional = mutatorLevel * 0.1;
    player.fractionalPoints += fractional;
    if (player.fractionalPoints >= 1) {
      const bonus = Math.floor(player.fractionalPoints);
      points += bonus;
      player.fractionalPoints -= bonus;
    }
    player.mutationPoints += points;
  }
}

export function upgradeMutation(player: Player, mutationId: MutationId): boolean {
  const def = MUTATIONS.find(m => m.id === mutationId);
  if (!def) return false;
  const current = getMutLevel(player, mutationId);
  if (current >= def.maxLevel) return false;
  if (player.mutationPoints < def.cost) return false;
  player.mutationPoints -= def.cost;
  player.mutations.set(mutationId, current + 1);
  return true;
}

export function runAIMutations(state: GameState) {
  for (const player of state.players) {
    if (player.isHuman) continue;
    
    const strategy = player.aiStrategy ?? 'balanced';
    while (player.mutationPoints > 0) {
      let target: MutationId;
      
      if (strategy === 'growth') {
        const options = [MutationId.MycelialBloom, MutationId.MycelialBloom, MutationId.MycelialBloom,
          MutationId.Tendrils, MutationId.HyphalSurge, MutationId.HomeostaticHarmony];
        target = options[Math.floor(Math.random() * options.length)];
      } else if (strategy === 'toxin') {
        const options = [MutationId.MycotoxinTracer, MutationId.MycotoxinTracer,
          MutationId.MycelialBloom, MutationId.HomeostaticHarmony, MutationId.MutatorPhenotype];
        target = options[Math.floor(Math.random() * options.length)];
      } else {
        const all = MUTATIONS.map(m => m.id);
        target = all[Math.floor(Math.random() * all.length)];
      }
      
      if (!upgradeMutation(player, target)) {
        // Try any affordable mutation
        const affordable = MUTATIONS.filter(m => {
          const lvl = getMutLevel(player, m.id);
          return lvl < m.maxLevel && player.mutationPoints >= m.cost;
        });
        if (affordable.length === 0) break;
        upgradeMutation(player, affordable[Math.floor(Math.random() * affordable.length)].id);
      }
    }
  }
}

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
  
  // Sort by distance from human, pick furthest
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

export function activateSurges(state: GameState) {
  for (const player of state.players) {
    if (player.surgeActive > 0) player.surgeActive--;
    const surgeLevel = getMutLevel(player, MutationId.HyphalSurge);
    if (surgeLevel > 0 && state.round % 5 === 0) {
      player.surgeActive = 2;
    }
  }
}
