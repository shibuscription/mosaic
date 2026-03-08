# Mosaic (Browser)

A local two-player implementation of Mosaic with a pyramid board model.
Current UI is 2D (not full 3D), but it visually shows that upper levels sit at the centers of lower 2x2 blocks.

## 1. Overview

- Stack: React + TypeScript + Vite
- Play mode: Local hot-seat (Blue and Yellow alternate turns)
- Board model: `board[level][row][col] = Piece | null`

## 2. Rule Spec in This Build

### Piece counts

- Blue starts with 70 pieces.
- Yellow starts with 70 pieces.
- Manual and auto placements both consume pieces.
- A player wins when their remaining pieces reach 0.

### Pyramid board structure

- level 0: 7x7
- level 1: 6x6
- level 2: 5x5
- level 3: 4x4
- level 4: 3x3
- level 5: 2x2
- level 6: 1x1

An upper-level cell maps to the center of a 2x2 block on the level below.
Initial placement includes one neutral piece at level 0, (3,3).

### Manual placement condition

A cell is legal when:
- it is empty
- level 0: always legal if empty
- level > 0: the four supporting cells on the lower level are all filled:
  - (r,c)
  - (r+1,c)
  - (r,c+1)
  - (r+1,c+1)

### Auto placement (center of 4)

If a 2x2 on the same level is fully filled, the center-above cell at level+1 becomes a candidate.
If 3 or 4 of those 4 colors are the same Blue/Yellow color, one auto piece of that color is placed.
Neutral does not count toward either player color.

### Chain and resolution order

Auto placement chains until no more valid candidates remain.
When multiple candidates exist, fixed priority is:
1. lower level first
2. lower row first
3. lower col first

### Piece shortage during auto

If a candidate color has 0 remaining pieces, that auto placement is skipped.
Chain continues with the next available candidate in priority order.

### Winner timing

Implementation order is:
- manual placement
- resolve auto chains as far as possible
- winner check

If both players reach 0 in the same turn, this build uses a temporary rule:
- the acting player of that turn is the winner (no draw)

## 3. UI Notes

- The previous square-grid board UI was removed.
- The board is rendered as overlapping circular placement points.
- Each higher level is offset by half spacing to the lower-right, so center stacking is visible.
- Legal empty moves are highlighted; illegal cells are disabled.

## 4. Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## 5. Main Files

```text
src/
  App.tsx            # 2D layered board UI (absolute-positioned circular points)
  style.css          # board and token styling
  game/
    types.ts         # pyramid board types
    logic.ts         # rules, legal moves, auto chains, winner
```

## 6. Future Extensions

- CPU opponent
- Online multiplayer
- Record/replay
- Richer animations
- Optional 3D / volumetric rendering
- Rule-variant toggles