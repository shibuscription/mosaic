import { type GameState, type Move, type PlayerColor } from './types'
import { evaluateSquareForAutoPlacement, getLegalMoves, placeManualPiece } from './logic'

export interface OnumaTuning {
  toleranceEasy: number
  toleranceNormal: number
  toleranceHard: number
  adjacentBonus: number
  opponentThreatPenalty: number
  selfOnlyBonusPenalty: number
  denyOpponentBonusReward: number
  allowOpponentBonusPenalty: number
  mixedBonusReward: number
}

export type OnumaDifficultyMode = 'easy' | 'normal' | 'hard'

export interface OnumaDebugCandidate {
  move: Move
  finalScore: number
  baseWeight: number
  adjacentBonus: number
  opponentThreatPenalty: number
  selfOnlyBonusPenalty: number
  denyOpponentBonusReward: number
  allowOpponentBonusPenalty: number
  mixedBonusReward: number
  squareEvaluationsCount: number
  rank: number
}

export interface OnumaDebugAnalysis {
  isTerminal: boolean
  terminalMessage: string | null
  selected: Move | null
  selectedRank: number | null
  difficulty: OnumaDifficultyMode
  activeTolerance: number
  candidates: OnumaDebugCandidate[]
  parameters: OnumaTuning
}

const ONUMA_BASE_WEIGHTS: number[][][] = [
  [
    [4, 7, 9, 11, 12, 11, 9, 7, 4],
    [7, 13, 18, 23, 25, 23, 18, 13, 7],
    [9, 18, 29, 37, 40, 37, 29, 18, 9],
    [11, 23, 37, 49, 54, 49, 37, 23, 11],
    [12, 25, 40, 54, 70, 54, 40, 25, 12],
    [11, 23, 37, 49, 54, 49, 37, 23, 11],
    [9, 18, 29, 37, 40, 37, 29, 18, 9],
    [7, 13, 18, 23, 25, 23, 18, 13, 7],
    [4, 7, 9, 11, 12, 11, 9, 7, 4],
  ],
  [
    [5, 8, 10, 11, 11, 10, 8, 5],
    [8, 14, 20, 24, 24, 20, 14, 8],
    [10, 20, 31, 39, 39, 31, 20, 10],
    [11, 24, 39, 51, 51, 39, 24, 11],
    [11, 24, 39, 51, 51, 39, 24, 11],
    [10, 20, 31, 39, 39, 31, 20, 10],
    [8, 14, 20, 24, 24, 20, 14, 8],
    [5, 8, 10, 11, 11, 10, 8, 5],
  ],
  [
    [5, 10, 13, 15, 13, 10, 5],
    [10, 19, 26, 30, 26, 19, 10],
    [13, 26, 37, 40, 37, 26, 13],
    [15, 30, 40, 55, 40, 30, 15],
    [13, 26, 37, 40, 37, 26, 13],
    [10, 19, 26, 30, 26, 19, 10],
    [5, 10, 13, 15, 13, 10, 5],
  ],
  [
    [7, 11, 14, 14, 11, 7],
    [11, 17, 23, 23, 17, 11],
    [14, 23, 35, 35, 23, 14],
    [14, 23, 35, 35, 23, 14],
    [11, 17, 23, 23, 17, 11],
    [7, 11, 14, 14, 11, 7],
  ],
  [
    [8, 15, 18, 15, 8],
    [15, 21, 36, 21, 15],
    [18, 36, 45, 36, 18],
    [15, 21, 36, 21, 15],
    [8, 15, 18, 15, 8],
  ],
  [
    [4, 7, 7, 4],
    [7, 14, 14, 7],
    [7, 14, 14, 7],
    [4, 7, 7, 4],
  ],
  [
    [2, 5, 2],
    [5, 16, 5],
    [2, 5, 2],
  ],
  [
    [3, 3],
    [3, 3],
  ],
  [[0]],
]

export const DEFAULT_ONUMA_TUNING: OnumaTuning = {
  toleranceEasy: 10,
  toleranceNormal: 5,
  toleranceHard: 0,
  adjacentBonus: 3,
  opponentThreatPenalty: 5,
  selfOnlyBonusPenalty: 3,
  denyOpponentBonusReward: 5,
  allowOpponentBonusPenalty: 10,
  mixedBonusReward: 7,
}

interface OnumaScoredMove {
  move: Move
  candidate: OnumaDebugCandidate
}

export function chooseOnumaMove(
  state: GameState,
  params?: Partial<OnumaTuning>,
  difficulty: OnumaDifficultyMode = 'normal',
): Move | null {
  return analyzeOnumaMove(state, params, difficulty).selected
}

export function analyzeOnumaMove(
  state: GameState,
  params?: Partial<OnumaTuning>,
  difficulty: OnumaDifficultyMode = 'normal',
): OnumaDebugAnalysis {
  const tuning = resolveOnumaTuning(params)
  const activeTolerance = getOnumaToleranceForDifficulty(tuning, difficulty)
  const legalMoves = getLegalMoves(state)
  if (state.winner) {
    return {
      isTerminal: true,
      terminalMessage: 'Game over.',
      selected: null,
      selectedRank: null,
      difficulty,
      activeTolerance,
      candidates: [],
      parameters: tuning,
    }
  }
  if (legalMoves.length === 0) {
    return {
      isTerminal: true,
      terminalMessage: 'No legal moves.',
      selected: null,
      selectedRank: null,
      difficulty,
      activeTolerance,
      candidates: [],
      parameters: tuning,
    }
  }

  const scored = legalMoves.map((move) => scoreOnumaMove(state, move, tuning))
  scored.sort((a, b) => {
    if (b.candidate.finalScore !== a.candidate.finalScore) {
      return b.candidate.finalScore - a.candidate.finalScore
    }
    if (b.candidate.baseWeight !== a.candidate.baseWeight) {
      return b.candidate.baseWeight - a.candidate.baseWeight
    }
    if (a.move.level !== b.move.level) {
      return a.move.level - b.move.level
    }
    if (a.move.row !== b.move.row) {
      return a.move.row - b.move.row
    }
    return a.move.col - b.move.col
  })

  const rankedCandidates = scored.map((item, index) => ({
    ...item.candidate,
    rank: index + 1,
  }))
  const topScore = rankedCandidates[0]?.finalScore ?? 0
  const pool = rankedCandidates.filter((item) => item.finalScore >= topScore - activeTolerance)
  const selectedPool = pool.length > 0 ? pool : rankedCandidates
  const selected = selectedPool[Math.floor(Math.random() * selectedPool.length)] ?? null

  return {
    isTerminal: false,
    terminalMessage: null,
    selected: selected?.move ?? null,
    selectedRank: selected?.rank ?? null,
    difficulty,
    activeTolerance,
    candidates: rankedCandidates,
    parameters: tuning,
  }
}

function resolveOnumaTuning(params?: Partial<OnumaTuning>): OnumaTuning {
  return {
    ...DEFAULT_ONUMA_TUNING,
    ...params,
  }
}

function getOnumaToleranceForDifficulty(tuning: OnumaTuning, difficulty: OnumaDifficultyMode): number {
  if (difficulty === 'easy') {
    return tuning.toleranceEasy
  }
  if (difficulty === 'hard') {
    return tuning.toleranceHard
  }
  return tuning.toleranceNormal
}

function scoreOnumaMove(state: GameState, move: Move, tuning: OnumaTuning): OnumaScoredMove {
  const selfColor = state.currentTurn
  const opponentColor: PlayerColor = selfColor === 'blue' ? 'yellow' : 'blue'
  const baseWeight = getOnumaBaseWeight(state, move)
  const adjacentCount = countAdjacentOwnPieces(state, move, selfColor)
  const adjacentBonus = adjacentCount * tuning.adjacentBonus
  const beforeThreats = collectThreatSquares(state, move.level, move.row, move.col, opponentColor)
  const afterManualState = createStateAfterManualPlacement(state, move)
  const afterThreats = collectThreatSquares(afterManualState, move.level, move.row, move.col, opponentColor)
  const opponentThreatPenalty = afterThreats.length * tuning.opponentThreatPenalty
  const denyOpponentBonusReward = countRemovedThreats(beforeThreats, afterThreats) * tuning.denyOpponentBonusReward

  const resolved = placeManualPiece(state, move.level, move.row, move.col)
  const squareEffects = evaluateSquareEffects(afterManualState, move, selfColor, opponentColor, tuning)
  const allowOpponentBonusPenalty =
    resolved.lastAutoPlacements.filter((item) => item.color === opponentColor).length * tuning.allowOpponentBonusPenalty

  const candidate: OnumaDebugCandidate = {
    move,
    finalScore:
      baseWeight +
      adjacentBonus -
      opponentThreatPenalty -
      squareEffects.selfOnlyBonusPenalty +
      denyOpponentBonusReward -
      allowOpponentBonusPenalty +
      squareEffects.mixedBonusReward,
    baseWeight,
    adjacentBonus,
    opponentThreatPenalty,
    selfOnlyBonusPenalty: squareEffects.selfOnlyBonusPenalty,
    denyOpponentBonusReward,
    allowOpponentBonusPenalty,
    mixedBonusReward: squareEffects.mixedBonusReward,
    squareEvaluationsCount: squareEffects.squareEvaluationsCount,
    rank: 0,
  }

  return {
    move,
    candidate,
  }
}

function getOnumaBaseWeight(state: GameState, move: Move): number {
  const size = state.board[move.level]?.length ?? 0
  const levelWeights = ONUMA_BASE_WEIGHTS.find((weights) => weights.length === size)
  return levelWeights?.[move.row]?.[move.col] ?? 0
}

function countAdjacentOwnPieces(state: GameState, move: Move, color: PlayerColor): number {
  const size = state.board[move.level]?.length ?? 0
  let count = 0
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) {
        continue
      }
      const row = move.row + dr
      const col = move.col + dc
      if (row < 0 || col < 0 || row >= size || col >= size) {
        continue
      }
      if (state.board[move.level][row][col]?.color === color) {
        count += 1
      }
    }
  }
  return count
}

function createStateAfterManualPlacement(state: GameState, move: Move): GameState {
  const board = state.board.map((levelRows) =>
    levelRows.map((row) => row.map((cell) => (cell ? { ...cell } : null))),
  )
  board[move.level][move.row][move.col] = { color: state.currentTurn, source: 'manual' }
  return {
    ...state,
    board,
    remaining: { ...state.remaining },
    lastMove: move,
    lastAutoPlacements: [],
    lastActor: state.currentTurn,
  }
}

function collectThreatSquares(
  state: GameState,
  level: number,
  row: number,
  col: number,
  opponentColor: PlayerColor,
): string[] {
  const keys: string[] = []
  const size = state.board[level]?.length ?? 0
  for (let dr = -1; dr <= 0; dr += 1) {
    for (let dc = -1; dc <= 0; dc += 1) {
      const sr = row + dr
      const sc = col + dc
      if (sr < 0 || sc < 0 || sr >= size - 1 || sc >= size - 1) {
        continue
      }
      const colors = [
        state.board[level][sr][sc]?.color ?? null,
        state.board[level][sr + 1][sc]?.color ?? null,
        state.board[level][sr][sc + 1]?.color ?? null,
        state.board[level][sr + 1][sc + 1]?.color ?? null,
      ]
      const opponentCount = colors.filter((item) => item === opponentColor).length
      const neutralCount = colors.filter((item) => item === 'neutral').length
      const emptyCount = colors.filter((item) => item === null).length
      if (emptyCount !== 1) {
        continue
      }
      if (opponentCount >= 3 || (opponentCount === 2 && neutralCount >= 1)) {
        keys.push(`${level}:${sr}:${sc}`)
      }
    }
  }
  return keys
}

function countRemovedThreats(before: string[], after: string[]): number {
  if (before.length === 0) {
    return 0
  }
  const afterSet = new Set(after)
  return before.filter((key) => !afterSet.has(key)).length
}

function evaluateSquareEffects(
  afterManualState: GameState,
  move: Move,
  selfColor: PlayerColor,
  opponentColor: PlayerColor,
  tuning: OnumaTuning,
): {
  selfOnlyBonusPenalty: number
  mixedBonusReward: number
  squareEvaluationsCount: number
} {
  let selfOnlyBonusPenalty = 0
  let mixedBonusReward = 0
  let squareEvaluationsCount = 0
  const size = afterManualState.board[move.level]?.length ?? 0

  for (let dr = -1; dr <= 0; dr += 1) {
    for (let dc = -1; dc <= 0; dc += 1) {
      const sr = move.row + dr
      const sc = move.col + dc
      if (sr < 0 || sc < 0 || sr >= size - 1 || sc >= size - 1) {
        continue
      }
      squareEvaluationsCount += 1
      const auto = evaluateSquareForAutoPlacement(afterManualState, move.level, sr, sc)
      if (!auto || auto.color !== selfColor) {
        continue
      }
      const colors = [
        afterManualState.board[move.level][sr][sc]?.color ?? null,
        afterManualState.board[move.level][sr + 1][sc]?.color ?? null,
        afterManualState.board[move.level][sr][sc + 1]?.color ?? null,
        afterManualState.board[move.level][sr + 1][sc + 1]?.color ?? null,
      ]
      const selfCount = colors.filter((item) => item === selfColor).length
      const opponentCount = colors.filter((item) => item === opponentColor).length
      const neutralCount = colors.filter((item) => item === 'neutral').length

      if (selfCount === 4) {
        selfOnlyBonusPenalty += tuning.selfOnlyBonusPenalty
      } else if (selfCount === 3 && (opponentCount === 1 || neutralCount === 1)) {
        mixedBonusReward += tuning.mixedBonusReward
      }
    }
  }

  return {
    selfOnlyBonusPenalty,
    mixedBonusReward,
    squareEvaluationsCount,
  }
}

export function getOnumaOverlayValue(
  candidate: OnumaDebugCandidate,
  mode: OnumaDebugOverlayMode,
  totalCandidates: number,
): { value: number; text: string } {
  if (mode === 'final') {
    return { value: candidate.finalScore, text: candidate.finalScore.toFixed(1) }
  }
  if (mode === 'base') {
    return { value: candidate.baseWeight, text: `${candidate.baseWeight}` }
  }
  if (mode === 'adjacent') {
    return { value: candidate.adjacentBonus, text: candidate.adjacentBonus >= 0 ? `+${candidate.adjacentBonus}` : `${candidate.adjacentBonus}` }
  }
  if (mode === 'opponentRisk') {
    return { value: -candidate.opponentThreatPenalty, text: candidate.opponentThreatPenalty > 0 ? `-${candidate.opponentThreatPenalty}` : '0' }
  }
  if (mode === 'blockBonus') {
    const blockValue = candidate.denyOpponentBonusReward - candidate.allowOpponentBonusPenalty
    return { value: blockValue, text: blockValue > 0 ? `+${blockValue}` : `${blockValue}` }
  }
  if (mode === 'selfBonusPenalty') {
    return { value: -candidate.selfOnlyBonusPenalty, text: candidate.selfOnlyBonusPenalty > 0 ? `-${candidate.selfOnlyBonusPenalty}` : '0' }
  }
  if (mode === 'mixedBonusReward') {
    return { value: candidate.mixedBonusReward, text: candidate.mixedBonusReward > 0 ? `+${candidate.mixedBonusReward}` : '0' }
  }
  return { value: totalCandidates - candidate.rank + 1, text: `#${candidate.rank}` }
}

export type OnumaDebugOverlayMode =
  | 'final'
  | 'base'
  | 'adjacent'
  | 'opponentRisk'
  | 'blockBonus'
  | 'selfBonusPenalty'
  | 'mixedBonusReward'
  | 'rank'

export function onumaBoardOverlayLabel(mode: OnumaDebugOverlayMode): string {
  if (mode === 'final') {
    return 'Final'
  }
  if (mode === 'base') {
    return 'Base'
  }
  if (mode === 'adjacent') {
    return 'Adjacent'
  }
  if (mode === 'opponentRisk') {
    return 'Opponent Risk'
  }
  if (mode === 'blockBonus') {
    return 'Block Bonus'
  }
  if (mode === 'selfBonusPenalty') {
    return 'Self Bonus Penalty'
  }
  if (mode === 'mixedBonusReward') {
    return 'Mixed Bonus Reward'
  }
  return 'Rank'
}
