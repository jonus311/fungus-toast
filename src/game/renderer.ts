import { BOARD_SIZE, CellType, PLAYER_COLORS } from './constants';
import { GameState } from './state';

// Pre-generate toast texture noise
let toastNoise: Float32Array | null = null;
function getToastNoise(): Float32Array {
  if (!toastNoise) {
    toastNoise = new Float32Array(BOARD_SIZE * BOARD_SIZE);
    for (let i = 0; i < toastNoise.length; i++) {
      toastNoise[i] = (Math.random() - 0.5) * 20;
    }
  }
  return toastNoise;
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasSize: number,
  hoverCell: number | null,
  selectedMutation: string | null,
) {
  const cellSize = canvasSize / BOARD_SIZE;
  const noise = getToastNoise();

  // Draw toast background
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const idx = y * BOARD_SIZE + x;
      const cell = state.board[idx];
      const px = x * cellSize;
      const py = y * cellSize;
      const n = noise[idx];

      if (cell.type === CellType.Empty) {
        // Toast color with texture
        const distFromCenter = Math.hypot(x - BOARD_SIZE / 2, y - BOARD_SIZE / 2) / (BOARD_SIZE / 2);
        const crust = Math.max(0, distFromCenter - 0.85) * 800;
        const base = 180 + n - crust;
        const r = Math.min(255, Math.max(0, base + 32));
        const g = Math.min(255, Math.max(0, base - 10));
        const b = Math.min(255, Math.max(0, base - 60));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      } else if (cell.type === CellType.Alive) {
        const color = PLAYER_COLORS[cell.owner % PLAYER_COLORS.length];
        // Organic variation based on age and position
        const ageVar = Math.min(cell.age * 0.3, 20);
        const posVar = (Math.sin(x * 0.7) * Math.cos(y * 0.7)) * 8;
        const r = Math.min(255, Math.max(0, color.base[0] + n * 0.5 + posVar - ageVar));
        const g = Math.min(255, Math.max(0, color.base[1] + n * 0.5 + posVar - ageVar * 0.5));
        const b = Math.min(255, Math.max(0, color.base[2] + n * 0.3 + posVar));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      } else if (cell.type === CellType.Dead) {
        const decay = Math.min(cell.age * 0.5, 30);
        ctx.fillStyle = `rgb(${60 + n * 0.3 - decay},${50 + n * 0.3 - decay},${40 + n * 0.2})`;
      } else if (cell.type === CellType.Toxin) {
        const pulse = Math.sin(Date.now() * 0.005 + idx * 0.1) * 15;
        const color = PLAYER_COLORS[cell.owner % PLAYER_COLORS.length];
        ctx.fillStyle = `rgb(${Math.min(255, color.dark[0] + 40 + pulse)},${Math.max(0, color.dark[1] - 20 + pulse)},${Math.min(255, color.dark[2] + 60 + pulse)})`;
      }

      ctx.fillRect(px, py, cellSize + 0.5, cellSize + 0.5);
    }
  }

  // Draw hover highlight during setup
  if (hoverCell !== null && state.phase === 'setup') {
    const hx = (hoverCell % BOARD_SIZE) * cellSize;
    const hy = Math.floor(hoverCell / BOARD_SIZE) * cellSize;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(hx, hy, cellSize, cellSize);
  }
}
