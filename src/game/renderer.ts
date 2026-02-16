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

// Toast crumb texture: scattered darker spots
let crumbMap: Uint8Array | null = null;
function getCrumbMap(): Uint8Array {
  if (!crumbMap) {
    crumbMap = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
    // Place random crumbs (about 3% of cells)
    for (let i = 0; i < crumbMap.length; i++) {
      if (Math.random() < 0.03) {
        crumbMap[i] = Math.floor(Math.random() * 30) + 10; // darkness 10-40
      }
    }
  }
  return crumbMap;
}

// Use ImageData for much faster rendering
let imageData: ImageData | null = null;
let prevBoard: Uint32Array | null = null; // simple dirty-checking hash

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  canvasSize: number,
  hoverCell: number | null,
  _selectedMutation: string | null,
) {
  const totalCells = BOARD_SIZE * BOARD_SIZE;
  const cellSize = canvasSize / BOARD_SIZE;

  // Use pixel-level rendering via ImageData for performance
  if (!imageData || imageData.width !== canvasSize || imageData.height !== canvasSize) {
    imageData = ctx.createImageData(canvasSize, canvasSize);
    prevBoard = null;
  }

  const noise = getToastNoise();
  const crumbs = getCrumbMap();
  const data = imageData.data;
  const now = Date.now();
  const cellSizeI = Math.max(1, Math.floor(cellSize));

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const i = y * BOARD_SIZE + x;
      const cell = state.board[i];
      const n = noise[i];
      const crumb = crumbs[i];

      let r: number, g: number, b: number, a = 255;

      if (cell.type === CellType.Empty) {
        // Square toast with edge crust darkening
        const edgeX = Math.min(x, BOARD_SIZE - 1 - x) / (BOARD_SIZE / 2);
        const edgeY = Math.min(y, BOARD_SIZE - 1 - y) / (BOARD_SIZE / 2);
        const edgeDist = Math.min(edgeX, edgeY);
        const crust = Math.max(0, (1 - edgeDist / 0.08)) * 80 * Math.max(0, 1 - edgeDist / 0.15);
        const base = 180 + n - crust - crumb;
        r = Math.min(255, Math.max(0, base + 32));
        g = Math.min(255, Math.max(0, base - 10));
        b = Math.min(255, Math.max(0, base - 60));
      } else if (cell.type === CellType.Alive) {
        const color = PLAYER_COLORS[cell.owner % PLAYER_COLORS.length];
        const ageVar = Math.min(cell.age * 0.3, 20);
        const posVar = (Math.sin(x * 0.7) * Math.cos(y * 0.7)) * 8;
        
        // New cell flash animation
        let flash = 0;
        if (cell.isNew) {
          flash = 40; // bright pop-in
        }

        // Resistant cells: slightly brighter with subtle shimmer
        let resistBonus = 0;
        if (cell.resistant) {
          resistBonus = 20 + Math.sin(now * 0.003 + i * 0.5) * 8;
        }

        r = Math.min(255, Math.max(0, color.base[0] + n * 0.5 + posVar - ageVar + flash + resistBonus));
        g = Math.min(255, Math.max(0, color.base[1] + n * 0.5 + posVar - ageVar * 0.5 + flash + resistBonus));
        b = Math.min(255, Math.max(0, color.base[2] + n * 0.3 + posVar + flash + resistBonus * 0.5));
      } else if (cell.type === CellType.Dead) {
        const decay = Math.min(cell.age * 0.5, 30);
        const deadOwner = cell.lastOwner >= 0 ? cell.lastOwner : cell.owner;
        if (deadOwner >= 0) {
          const color = PLAYER_COLORS[deadOwner % PLAYER_COLORS.length];
          r = Math.min(255, Math.max(0, color.dark[0] * 0.35 + 30 + n * 0.15 - decay));
          g = Math.min(255, Math.max(0, color.dark[1] * 0.35 + 25 + n * 0.15 - decay));
          b = Math.min(255, Math.max(0, color.dark[2] * 0.25 + 20 + n * 0.1));
        } else {
          r = Math.max(0, 50 + n * 0.3 - decay);
          g = Math.max(0, 40 + n * 0.3 - decay);
          b = Math.max(0, 30 + n * 0.2);
        }
        a = 180; // semi-transparent to show dead cells are distinct
      } else if (cell.type === CellType.Toxin) {
        const pulse = Math.sin(now * 0.006 + i * 0.15) * 20;
        const glow = Math.max(0, Math.sin(now * 0.003 + i * 0.08) * 12);
        const color = PLAYER_COLORS[cell.owner % PLAYER_COLORS.length];
        r = Math.min(255, Math.max(0, color.dark[0] + 50 + pulse));
        g = Math.max(0, color.dark[1] - 25 + pulse * 0.5);
        b = Math.min(255, Math.max(0, color.dark[2] + 70 + pulse + glow));
      } else {
        r = 0; g = 0; b = 0;
      }

      // Fill pixels for this cell (use ceil for end to avoid 1px gaps between cells)
      const px = Math.floor(x * cellSize);
      const py = Math.floor(y * cellSize);
      const pxEnd = Math.min(canvasSize, Math.ceil((x + 1) * cellSize));
      const pyEnd = Math.min(canvasSize, Math.ceil((y + 1) * cellSize));

      for (let cy = py; cy < pyEnd; cy++) {
        const rowOff = cy * canvasSize * 4;
        for (let cx = px; cx < pxEnd; cx++) {
          const off = rowOff + cx * 4;
          data[off] = r;
          data[off + 1] = g;
          data[off + 2] = b;
          data[off + 3] = a;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Draw hover highlight during setup
  if (hoverCell !== null && state.phase === 'setup') {
    const hx = (hoverCell % BOARD_SIZE) * cellSize;
    const hy = Math.floor(hoverCell / BOARD_SIZE) * cellSize;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(hx, hy, cellSize, cellSize);
  }
}
