'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { BOARD_SIZE, MUTATIONS, MutationId, PLAYER_COLORS, TOTAL_TILES, CellType } from '@/game/constants';
import {
  GameState, createInitialState, addPlayer, placeStartingSpore,
  runGrowthCycle, runDecayPhase, earnMutationPoints, updateTerritories,
  checkEndgame, determineWinner, getAIStartingPositions, runAIMutations,
  upgradeMutation, activateSurges,
} from '@/game/state';
import { renderBoard } from '@/game/renderer';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(createInitialState());
  const animFrameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const [phase, setPhase] = useState<string>('setup');
  const [round, setRound] = useState(1);
  const [cycle, setCycle] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playerData, setPlayerData] = useState<{ name: string; territory: number; mp: number; color: number[] }[]>([]);
  const [humanMp, setHumanMp] = useState(5);
  const [humanMutations, setHumanMutations] = useState<Map<MutationId, number>>(new Map());
  const [showTutorial, setShowTutorial] = useState(true);
  const [winner, setWinner] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState(640);
  const [showMutationPanel, setShowMutationPanel] = useState(false);

  // Responsive canvas size
  useEffect(() => {
    const updateSize = () => {
      const maxW = Math.min(window.innerWidth - 360, window.innerHeight - 100);
      setCanvasSize(Math.max(320, Math.min(800, maxW)));
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Initialize game
  const initGame = useCallback((humanX: number, humanY: number) => {
    const state = createInitialState();
    addPlayer(state, 'You', true);
    addPlayer(state, 'Sporax', false, 'growth');
    addPlayer(state, 'Toxicus', false, 'toxin');
    addPlayer(state, 'Moldsworth', false, 'balanced');

    placeStartingSpore(state, 0, humanX, humanY);
    const aiPositions = getAIStartingPositions(3, humanX, humanY);
    for (let i = 0; i < 3; i++) {
      placeStartingSpore(state, i + 1, aiPositions[i][0], aiPositions[i][1]);
    }

    state.phase = 'mutation';
    stateRef.current = state;
    syncUI(state);
  }, []);

  const syncUI = (state: GameState) => {
    setPhase(state.phase);
    setRound(state.round);
    setCycle(state.growthCycle);
    updateTerritories(state);
    setPlayerData(state.players.map(p => ({
      name: p.name,
      territory: p.territory,
      mp: p.mutationPoints,
      color: PLAYER_COLORS[p.id % PLAYER_COLORS.length].base,
    })));
    const human = state.players[0];
    if (human) {
      setHumanMp(human.mutationPoints);
      setHumanMutations(new Map(human.mutations));
    }
  };

  // Handle canvas click for setup
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    const rect = canvasRef.current!.getBoundingClientRect();
    const cellSize = canvasSize / BOARD_SIZE;
    const x = Math.floor((e.clientX - rect.left) / cellSize);
    const y = Math.floor((e.clientY - rect.top) / cellSize);

    if (state.phase === 'setup') {
      if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        initGame(x, y);
        setShowTutorial(false);
      }
    }
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (stateRef.current.phase !== 'setup') { setHoverCell(null); return; }
    const rect = canvasRef.current!.getBoundingClientRect();
    const cellSize = canvasSize / BOARD_SIZE;
    const x = Math.floor((e.clientX - rect.left) / cellSize);
    const y = Math.floor((e.clientY - rect.top) / cellSize);
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE)
      setHoverCell(y * BOARD_SIZE + x);
    else setHoverCell(null);
  };

  // Start round (from mutation phase)
  const startRound = () => {
    const state = stateRef.current;
    if (state.phase !== 'mutation') return;
    
    runAIMutations(state);
    activateSurges(state);
    state.phase = 'growth';
    state.growthCycle = 0;
    syncUI(state);
  };

  // Game loop
  useEffect(() => {
    let running = true;
    const tick = (now: number) => {
      if (!running) return;
      animFrameRef.current = requestAnimationFrame(tick);

      const state = stateRef.current;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;

      // Render every frame
      renderBoard(ctx, state, canvasSize, hoverCell, null);

      // Game logic at speed intervals
      if (state.phase === 'growth' && speed > 0) {
        const interval = 300 / speed;
        if (now - lastTickRef.current >= interval) {
          lastTickRef.current = now;

          if (state.growthCycle < 5) {
            runGrowthCycle(state);
            syncUI(state);
          } else {
            // Decay phase
            state.phase = 'decay';
            runDecayPhase(state);
            earnMutationPoints(state);
            updateTerritories(state);

            if (checkEndgame(state)) {
              const w = determineWinner(state);
              state.winner = w;
              state.phase = 'ended';
              setWinner(state.players[w]?.name ?? 'Unknown');
              syncUI(state);
            } else {
              state.round++;
              state.phase = 'mutation';
              state.growthCycle = 0;
              syncUI(state);
              // Auto-continue if not human's turn to spend points
              if (state.players[0]?.mutationPoints === 0) {
                startRound();
              }
            }
          }
        }
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(animFrameRef.current); };
  }, [canvasSize, hoverCell, speed]);

  const handleUpgrade = (mutId: MutationId) => {
    const state = stateRef.current;
    const human = state.players[0];
    if (human && upgradeMutation(human, mutId)) {
      syncUI(state);
    }
  };

  const occupiedPct = () => {
    const total = playerData.reduce((s, p) => s + p.territory, 0);
    return ((total / TOTAL_TILES) * 100).toFixed(1);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col lg:flex-row">
      {/* Sidebar */}
      <div className="w-full lg:w-80 p-4 bg-gray-900 border-b lg:border-b-0 lg:border-r border-gray-800 flex flex-col gap-4 overflow-y-auto max-h-screen">
        <h1 className="text-2xl font-bold text-amber-400 flex items-center gap-2">
          🍞 Fungus Toast
        </h1>

        <div className="text-sm text-gray-400">
          Round {round} · Cycle {cycle}/5 · {occupiedPct()}% covered
        </div>

        {/* Players */}
        <div className="space-y-2">
          {playerData.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <div
                className="w-4 h-4 rounded-sm flex-shrink-0"
                style={{ backgroundColor: `rgb(${p.color.join(',')})` }}
              />
              <span className="flex-1">{p.name}</span>
              <span className="text-gray-400">
                {((p.territory / TOTAL_TILES) * 100).toFixed(1)}%
              </span>
              {i === 0 && <span className="text-amber-400 text-xs">{p.mp} MP</span>}
            </div>
          ))}
        </div>

        {/* Speed Control */}
        <div className="flex gap-1">
          {[0, 1, 2, 5].map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-3 py-1 rounded text-sm ${speed === s ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              {s === 0 ? '⏸' : `${s}x`}
            </button>
          ))}
        </div>

        {/* Mutation Panel */}
        {phase === 'mutation' && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-amber-300">Mutations</h2>
              <span className="text-xs text-amber-400">{humanMp} points</span>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {MUTATIONS.map(m => {
                const lvl = humanMutations.get(m.id) ?? 0;
                const canAfford = humanMp >= m.cost && lvl < m.maxLevel;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleUpgrade(m.id)}
                    disabled={!canAfford}
                    className={`w-full text-left p-2 rounded text-xs ${canAfford ? 'bg-gray-800 hover:bg-gray-700 cursor-pointer' : 'bg-gray-900 text-gray-600 cursor-default'}`}
                  >
                    <div className="flex justify-between">
                      <span>{m.icon} {m.name}</span>
                      <span className="text-gray-500">Lv{lvl} · {m.cost}MP</span>
                    </div>
                    <div className="text-gray-500 mt-0.5">{m.description}</div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={startRound}
              className="w-full py-2 bg-green-700 hover:bg-green-600 rounded text-sm font-semibold"
            >
              ▶ Start Round
            </button>
          </div>
        )}

        {/* How to Play */}
        {phase !== 'setup' && !winner && (
          <details className="text-xs">
            <summary className="text-amber-400 cursor-pointer hover:text-amber-300 font-semibold">📖 How to Play</summary>
            <div className="mt-2 space-y-2 text-gray-400 bg-gray-800/50 rounded p-3">
              <div>
                <span className="text-amber-300 font-semibold">🎯 Goal:</span> Control the most territory when the toast is 90% covered (or after 75 rounds).
              </div>
              <div>
                <span className="text-amber-300 font-semibold">🔄 Each Round:</span>
                <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                  <li><b>Mutation Phase</b> — Spend your mutation points (MP) on upgrades, then click <span className="text-green-400">▶ Start Round</span></li>
                  <li><b>Growth Phase</b> — 5 cycles run automatically. Your cells try to spread to empty neighbors</li>
                  <li><b>Decay Phase</b> — Old cells may die. You earn MP based on your territory</li>
                </ol>
              </div>
              <div>
                <span className="text-amber-300 font-semibold">🧬 Mutations:</span>
                <ul className="ml-4 mt-1 space-y-0.5">
                  <li>🌱 <b>Mycelial Bloom</b> — Faster growth (best for beginners!)</li>
                  <li>🛡️ <b>Homeostatic Harmony</b> — Cells resist decay longer</li>
                  <li>☠️ <b>Mycotoxin Tracer</b> — Poison empty tiles to block enemies</li>
                  <li>🧪 <b>Mutator Phenotype</b> — Earn more MP each round</li>
                  <li>🌿 <b>Tendrils</b> — Grow diagonally (Tier 2)</li>
                  <li>⚡ <b>Hyphal Surge</b> — Temporary growth bursts (Tier 2)</li>
                  <li>🔰 <b>Chitin Fortification</b> — Make cells resistant (Tier 2)</li>
                </ul>
              </div>
              <div>
                <span className="text-amber-300 font-semibold">💡 Tips:</span>
                <ul className="ml-4 mt-1 space-y-0.5">
                  <li>• Start near the center for maximum expansion room</li>
                  <li>• Invest in Mycelial Bloom early — growth is king</li>
                  <li>• Use speed controls (1x/2x/5x) to watch or fast-forward</li>
                  <li>• Toxins block enemy growth — use them at borders</li>
                </ul>
              </div>
            </div>
          </details>
        )}

        {/* Winner */}
        {winner && (
          <div className="p-4 bg-amber-900/30 border border-amber-700 rounded text-center">
            <div className="text-lg font-bold text-amber-300">🏆 {winner} Wins!</div>
            <div className="text-sm text-gray-400 mt-1">
              {playerData.map(p => `${p.name}: ${((p.territory / TOTAL_TILES) * 100).toFixed(1)}%`).join(' · ')}
            </div>
            <button
              onClick={() => {
                stateRef.current = createInitialState();
                setWinner(null);
                syncUI(stateRef.current);
              }}
              className="mt-2 px-4 py-1 bg-amber-700 hover:bg-amber-600 rounded text-sm"
            >
              New Game
            </button>
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center p-4 relative">
        {showTutorial && phase === 'setup' && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-gray-900/90 border border-amber-700 rounded-lg p-6 max-w-md text-center pointer-events-auto">
              <h2 className="text-xl font-bold text-amber-400 mb-2">🍞 Welcome to Fungus Toast!</h2>
              <p className="text-sm text-gray-300 mb-3">
                You are a mold colony competing against 3 AI opponents to dominate a piece of toast.
              </p>
              <div className="text-xs text-gray-400 text-left space-y-2 mb-4">
                <div className="font-semibold text-amber-300">How it works:</div>
                <ol className="list-decimal ml-4 space-y-1">
                  <li><b>Click the toast</b> to place your starting spore (tip: aim for the center!)</li>
                  <li><b>Spend mutation points</b> on upgrades in the sidebar, then click <span className="text-green-400 font-semibold">▶ Start Round</span></li>
                  <li><b>Watch your mold grow</b> — 5 growth cycles run automatically each round</li>
                  <li><b>Repeat</b> until the toast is 90% covered. Most territory wins!</li>
                </ol>
                <div className="mt-2 pt-2 border-t border-gray-700">
                  <span className="text-amber-300 font-semibold">🧬 Starter tip:</span> Put your first points into <b>Mycelial Bloom</b> (faster growth) — it&apos;s the best early investment.
                </div>
              </div>
              <button
                onClick={() => setShowTutorial(false)}
                className="mt-2 px-6 py-2 bg-amber-600 hover:bg-amber-500 rounded font-semibold text-sm text-white"
              >
                🍞 Let&apos;s Go!
              </button>
              <p className="text-xs text-gray-500 mt-2">Then click anywhere on the toast to place your spore</p>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={canvasSize}
          height={canvasSize}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMove}
          className="rounded-lg shadow-2xl shadow-amber-900/20 cursor-crosshair"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
}
