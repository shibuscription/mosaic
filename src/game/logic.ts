import {
  BASE_SIZE,
  MAX_LEVEL,
  TOTAL_PIECES,
  type AutoPlacement,
  type Board,
  type GameState,
  type Move,
  type Piece,
  type PieceColor,
  type PlayerColor,
} from './types'

const TURN_LABEL: Record<PlayerColor, string> = {
  blue: 'Blue',
  yellow: 'Yellow',
}

export function createInitialGameState(): GameState {
  const board = createEmptyBoard()
  board[0][3][3] = { color: 'neutral', source: 'initial' }

  return {
    board,
    currentTurn: 'blue',
    remaining: { blue: TOTAL_PIECES, yellow: TOTAL_PIECES },
    winner: null,
    message: 'Blue to move. Place one piece on a legal position.',
    lastMove: null,
    lastAutoPlacements: [],
    lastActor: null,
  }
}

export function isCellFilled(board: Board, level: number, row: number, col: number): boolean {
  if (!isInsideBoard(level, row, col)) {
    return false
  }
  return board[level][row][col] !== null
}

export function canPlaceAt(board: Board, level: number, row: number, col: number): boolean {
  if (!isInsideBoard(level, row, col) || isCellFilled(board, level, row, col)) {
    return false
  }

  if (level === 0) {
    return true
  }

  return (
    isCellFilled(board, level - 1, row, col) &&
    isCellFilled(board, level - 1, row + 1, col) &&
    isCellFilled(board, level - 1, row, col + 1) &&
    isCellFilled(board, level - 1, row + 1, col + 1)
  )
}

export function getLegalMoves(state: GameState): Move[] {
  const moves: Move[] = []

  for (let level = 0; level <= MAX_LEVEL; level += 1) {
    const size = getLevelSize(level)
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (canPlaceAt(state.board, level, row, col)) {
          moves.push({ level, row, col })
        }
      }
    }
  }

  return moves
}

export function placeManualPiece(state: GameState, level: number, row: number, col: number): GameState {
  if (state.winner) {
    return state
  }

  if (!canPlaceAt(state.board, level, row, col)) {
    return {
      ...state,
      message: 'Illegal move.',
      lastAutoPlacements: [],
    }
  }

  const actor = state.currentTurn
  if (state.remaining[actor] <= 0) {
    return {
      ...state,
      message: `${TURN_LABEL[actor]} has no remaining pieces.`,
      lastAutoPlacements: [],
    }
  }

  const board = cloneBoard(state.board)
  board[level][row][col] = { color: actor, source: 'manual' }
  const remaining = { ...state.remaining, [actor]: state.remaining[actor] - 1 }

  const afterAuto = resolveAutoChains({
    ...state,
    board,
    remaining,
    lastMove: { level, row, col },
    lastAutoPlacements: [],
    lastActor: actor,
    message: '',
  })

  const winner = getWinner(afterAuto)
  const nextTurn: PlayerColor = actor === 'blue' ? 'yellow' : 'blue'

  const baseMessage = `${TURN_LABEL[actor]} placed at L${level}(${row + 1},${col + 1}).`
  const autoMessage =
    afterAuto.lastAutoPlacements.length > 0
      ? ` Auto: ${afterAuto.lastAutoPlacements
          .map((item) => `${TURN_LABEL[item.color]}@L${item.level}(${item.row + 1},${item.col + 1})`)
          .join(', ')}`
      : ''

  if (winner) {
    return {
      ...afterAuto,
      winner,
      message: `${baseMessage}${autoMessage} ${TURN_LABEL[winner]} wins (remaining reached 0).`,
    }
  }

  return {
    ...afterAuto,
    currentTurn: nextTurn,
    message: `${baseMessage}${autoMessage} Next: ${TURN_LABEL[nextTurn]}.`,
  }
}

export function evaluateSquareForAutoPlacement(
  state: GameState,
  level: number,
  row: number,
  col: number,
): AutoPlacement | null {
  if (level < 0 || level >= MAX_LEVEL) {
    return null
  }

  const upperLevel = level + 1
  if (!isInsideBoard(upperLevel, row, col) || isCellFilled(state.board, upperLevel, row, col)) {
    return null
  }

  const p1 = state.board[level][row][col]
  const p2 = state.board[level][row + 1][col]
  const p3 = state.board[level][row][col + 1]
  const p4 = state.board[level][row + 1][col + 1]

  if (!p1 || !p2 || !p3 || !p4) {
    return null
  }

  const colors: PieceColor[] = [p1.color, p2.color, p3.color, p4.color]
  const blueCount = colors.filter((color) => color === 'blue').length
  const yellowCount = colors.filter((color) => color === 'yellow').length

  if (blueCount >= 3) {
    return { level: upperLevel, row, col, color: 'blue', basedOnLevel: level }
  }

  if (yellowCount >= 3) {
    return { level: upperLevel, row, col, color: 'yellow', basedOnLevel: level }
  }

  return null
}

export function findAutoPlacementCandidates(state: GameState): AutoPlacement[] {
  const candidates: AutoPlacement[] = []

  for (let level = 0; level < MAX_LEVEL; level += 1) {
    const size = getLevelSize(level)
    for (let row = 0; row < size - 1; row += 1) {
      for (let col = 0; col < size - 1; col += 1) {
        const candidate = evaluateSquareForAutoPlacement(state, level, row, col)
        if (candidate) {
          candidates.push(candidate)
        }
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.level !== b.level) {
      return a.level - b.level
    }
    if (a.row !== b.row) {
      return a.row - b.row
    }
    return a.col - b.col
  })

  return candidates
}

export function resolveAutoChains(state: GameState): GameState {
  let board = cloneBoard(state.board)
  const remaining = { ...state.remaining }
  const events: AutoPlacement[] = []

  while (true) {
    const candidates = findAutoPlacementCandidates({ ...state, board })
    const candidate = candidates.find((item) => remaining[item.color] > 0)

    if (!candidate) {
      break
    }

    board[candidate.level][candidate.row][candidate.col] = {
      color: candidate.color,
      source: 'auto',
    }
    remaining[candidate.color] -= 1
    events.push(candidate)
  }

  return {
    ...state,
    board,
    remaining,
    lastAutoPlacements: events,
  }
}

export function getWinner(state: GameState): PlayerColor | null {
  const blueZero = state.remaining.blue <= 0
  const yellowZero = state.remaining.yellow <= 0

  if (blueZero && yellowZero) {
    return state.lastActor ?? 'blue'
  }
  if (blueZero) {
    return 'blue'
  }
  if (yellowZero) {
    return 'yellow'
  }
  return null
}

export function getPiece(board: Board, level: number, row: number, col: number): Piece | null {
  if (!isInsideBoard(level, row, col)) {
    return null
  }
  return board[level][row][col]
}

export function getLevelSize(level: number): number {
  return BASE_SIZE - level
}

function createEmptyBoard(): Board {
  return Array.from({ length: BASE_SIZE }, (_, level) => {
    const size = getLevelSize(level)
    return Array.from({ length: size }, () => Array.from({ length: size }, () => null))
  })
}

function cloneBoard(board: Board): Board {
  return board.map((levelRows) => levelRows.map((row) => row.map((cell) => (cell ? { ...cell } : null))))
}

function isInsideBoard(level: number, row: number, col: number): boolean {
  if (level < 0 || level > MAX_LEVEL) {
    return false
  }

  const size = getLevelSize(level)
  return row >= 0 && row < size && col >= 0 && col < size
}