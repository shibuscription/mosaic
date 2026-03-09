import { BASE_SIZE, type GameState, type Move, type PlayerColor } from './types'
import { canPlaceAt, evaluateSquareForAutoPlacement, getLegalMoves, placeManualPiece } from './logic'

export type CpuDifficulty = 'easy' | 'normal' | 'hard'

interface ScoredMove {
  move: Move
  score: number
}

interface DifficultyProfile {
  autoCountWeight: number
  autoSelfWeight: number
  autoEnemyPenalty: number
  autoLevelWeight: number
  localShapeStrongWeight: number
  localShapeWeakWeight: number
  blockBonus: number
  levelWeight: number
  centerWeight: number
  threatReduceWeight: number
  threatIncreasePenalty: number
  noiseRange: number
  nearBestMargin: number
  poolLimit: number
  responsePenaltyFactor: number
  endgameThreshold: number
  endgameWinWeight: number
  endgameThreatPenalty: number
}

const EASY_PROFILE: DifficultyProfile = {
  autoCountWeight: 24,
  autoSelfWeight: 14,
  autoEnemyPenalty: 21,
  autoLevelWeight: 3.5,
  localShapeStrongWeight: 15,
  localShapeWeakWeight: 4,
  blockBonus: 20,
  levelWeight: 6,
  centerWeight: 1,
  threatReduceWeight: 8,
  threatIncreasePenalty: 10,
  noiseRange: 3.2,
  nearBestMargin: 18,
  poolLimit: 5,
  responsePenaltyFactor: 0,
  endgameThreshold: 12,
  endgameWinWeight: 34,
  endgameThreatPenalty: 40,
}

const NORMAL_PROFILE: DifficultyProfile = {
  autoCountWeight: 30,
  autoSelfWeight: 19,
  autoEnemyPenalty: 27,
  autoLevelWeight: 4.5,
  localShapeStrongWeight: 18,
  localShapeWeakWeight: 5,
  blockBonus: 26,
  levelWeight: 6.8,
  centerWeight: 1.05,
  threatReduceWeight: 12,
  threatIncreasePenalty: 15,
  noiseRange: 1.8,
  nearBestMargin: 10,
  poolLimit: 3,
  responsePenaltyFactor: 0,
  endgameThreshold: 12,
  endgameWinWeight: 42,
  endgameThreatPenalty: 52,
}

const HARD_PROFILE: DifficultyProfile = {
  autoCountWeight: 36,
  autoSelfWeight: 24,
  autoEnemyPenalty: 34,
  autoLevelWeight: 5.6,
  localShapeStrongWeight: 21,
  localShapeWeakWeight: 6,
  blockBonus: 34,
  levelWeight: 8.2,
  centerWeight: 1.1,
  threatReduceWeight: 15,
  threatIncreasePenalty: 20,
  noiseRange: 0.8,
  nearBestMargin: 5,
  poolLimit: 2,
  responsePenaltyFactor: 0.46,
  endgameThreshold: 14,
  endgameWinWeight: 60,
  endgameThreatPenalty: 95,
}

export function chooseCpuMove(state: GameState, cpuColor: PlayerColor, difficulty: CpuDifficulty): Move | null {
  const legalMoves = getLegalMoves(state)
  if (legalMoves.length === 0) {
    return null
  }
  const profile = getProfile(difficulty)

  const scored = legalMoves.map((move) => ({ move, score: scoreMove(state, move, cpuColor, difficulty, profile) }))
  scored.sort((a, b) => b.score - a.score)

  return pickMoveWithVariance(scored, profile)
}

function scoreMove(
  state: GameState,
  move: Move,
  cpuColor: PlayerColor,
  difficulty: CpuDifficulty,
  profile: DifficultyProfile,
): number {
  const enemyColor: PlayerColor = cpuColor === 'blue' ? 'yellow' : 'blue'
  const afterState = placeManualPiece(state, move.level, move.row, move.col)
  let score = evaluateMoveCore(state, move, cpuColor, profile, afterState)

  if (difficulty === 'hard') {
    score -= evaluateOpponentResponsePenalty(afterState, enemyColor, profile)
  }

  score += (Math.random() - 0.5) * profile.noiseRange
  return score
}

function evaluateMoveCore(
  state: GameState,
  move: Move,
  cpuColor: PlayerColor,
  profile: DifficultyProfile,
  resolved: GameState,
): number {
  const enemyColor: PlayerColor = cpuColor === 'blue' ? 'yellow' : 'blue'
  const autoMoves = resolved.lastAutoPlacements

  let score = 0

  if (resolved.winner === cpuColor) {
    score += 1500
  }

  const autoForCpu = autoMoves.filter((item) => item.color === cpuColor).length
  const autoForEnemy = autoMoves.filter((item) => item.color === enemyColor).length
  score += autoMoves.length * profile.autoCountWeight
  score += autoForCpu * profile.autoSelfWeight
  score -= autoForEnemy * profile.autoEnemyPenalty
  score += autoMoves.reduce((sum, item) => sum + item.level, 0) * profile.autoLevelWeight

  score += estimateLocalShapeBonus(state, move, cpuColor, profile)
  score += estimateBlockBonus(state, move, enemyColor, profile)

  score += move.level * profile.levelWeight
  score += centerPreference(move) * profile.centerWeight

  const enemyThreatBefore = countImmediateThreats(state, enemyColor)
  const enemyThreatAfter = countImmediateThreats(resolved, enemyColor)
  score += (enemyThreatBefore - enemyThreatAfter) * profile.threatReduceWeight
  score -= Math.max(0, enemyThreatAfter - enemyThreatBefore) * profile.threatIncreasePenalty

  score += endgameBonus(resolved, cpuColor, enemyColor, profile)

  return score
}

function estimateLocalShapeBonus(state: GameState, move: Move, color: PlayerColor, profile: DifficultyProfile): number {
  let bonus = 0
  const level = move.level
  const size = BASE_SIZE - level

  for (let dr = -1; dr <= 0; dr += 1) {
    for (let dc = -1; dc <= 0; dc += 1) {
      const sr = move.row + dr
      const sc = move.col + dc
      if (sr < 0 || sc < 0 || sr >= size - 1 || sc >= size - 1) {
        continue
      }

      const colors = [
        getCellColor(state, level, sr, sc, move),
        getCellColor(state, level, sr + 1, sc, move),
        getCellColor(state, level, sr, sc + 1, move),
        getCellColor(state, level, sr + 1, sc + 1, move),
      ]

      const same = colors.filter((item) => item === color).length
      if (same >= 3) {
        bonus += profile.localShapeStrongWeight
      } else if (same === 2) {
        bonus += profile.localShapeWeakWeight
      }
    }
  }

  return bonus
}

function estimateBlockBonus(state: GameState, move: Move, enemyColor: PlayerColor, profile: DifficultyProfile): number {
  if (move.level <= 0) {
    return 0
  }
  const candidate = evaluateSquareForAutoPlacement(state, move.level - 1, move.row, move.col)
  if (candidate?.color === enemyColor) {
    return profile.blockBonus
  }
  return 0
}

function countImmediateThreats(state: GameState, color: PlayerColor): number {
  let count = 0

  for (let level = 0; level < BASE_SIZE - 1; level += 1) {
    const size = BASE_SIZE - level
    for (let row = 0; row < size - 1; row += 1) {
      for (let col = 0; col < size - 1; col += 1) {
        const upperLevel = level + 1
        if (!canPlaceAt(state.board, upperLevel, row, col)) {
          continue
        }

        const colors = [
          state.board[level][row][col]?.color ?? null,
          state.board[level][row + 1][col]?.color ?? null,
          state.board[level][row][col + 1]?.color ?? null,
          state.board[level][row + 1][col + 1]?.color ?? null,
        ]

        const same = colors.filter((item) => item === color).length
        const neutral = colors.filter((item) => item === 'neutral').length
        if (same >= 3 || (same === 2 && neutral >= 1)) {
          count += 1
        }
      }
    }
  }

  return count
}

function centerPreference(move: Move): number {
  const size = BASE_SIZE - move.level
  const center = (size - 1) / 2
  const distance = Math.abs(move.row - center) + Math.abs(move.col - center)
  return Math.max(0, 8 - distance * 2)
}

function getCellColor(state: GameState, level: number, row: number, col: number, move: Move): PlayerColor | 'neutral' | null {
  if (move.level === level && move.row === row && move.col === col) {
    return state.currentTurn
  }
  return state.board[level][row][col]?.color ?? null
}

function pickMoveWithVariance(scoredMoves: ScoredMove[], profile: DifficultyProfile): Move {
  const bestScore = scoredMoves[0].score
  const nearBest = scoredMoves
    .filter((item) => item.score >= bestScore - profile.nearBestMargin)
    .slice(0, profile.poolLimit)

  if (nearBest.length === 1) {
    return nearBest[0].move
  }

  const weights = nearBest.map((item) => Math.max(1, 10 + item.score - (bestScore - profile.nearBestMargin)))
  const total = weights.reduce((sum, value) => sum + value, 0)
  let roll = Math.random() * total

  for (let i = 0; i < nearBest.length; i += 1) {
    roll -= weights[i]
    if (roll <= 0) {
      return nearBest[i].move
    }
  }

  return nearBest[0].move
}

function getProfile(difficulty: CpuDifficulty): DifficultyProfile {
  if (difficulty === 'hard') {
    return HARD_PROFILE
  }
  if (difficulty === 'normal') {
    return NORMAL_PROFILE
  }
  return EASY_PROFILE
}

function evaluateOpponentResponsePenalty(afterMyMove: GameState, enemyColor: PlayerColor, profile: DifficultyProfile): number {
  const responseMoves = getLegalMoves(afterMyMove)
  if (responseMoves.length === 0) {
    return 0
  }

  const cpuColor: PlayerColor = enemyColor === 'blue' ? 'yellow' : 'blue'
  let bestEnemyScore = -Infinity
  let enemyCanWinImmediately = false

  for (const response of responseMoves) {
    const enemyResolved = placeManualPiece(afterMyMove, response.level, response.row, response.col)
    if (enemyResolved.winner === enemyColor) {
      enemyCanWinImmediately = true
    }
    const enemyViewScore = evaluateMoveCore(afterMyMove, response, enemyColor, NORMAL_PROFILE, enemyResolved)
    if (enemyViewScore > bestEnemyScore) {
      bestEnemyScore = enemyViewScore
    }
  }

  let penalty = Math.max(0, bestEnemyScore) * profile.responsePenaltyFactor
  if (enemyCanWinImmediately) {
    penalty += profile.endgameThreatPenalty * 1.8
  }

  const cpuImmediateWins = countImmediateWinningMoves(afterMyMove, cpuColor)
  const enemyImmediateWins = countImmediateWinningMoves(afterMyMove, enemyColor)
  if (enemyImmediateWins > cpuImmediateWins) {
    penalty += (enemyImmediateWins - cpuImmediateWins) * profile.endgameThreatPenalty * 0.35
  }

  return penalty
}

function endgameBonus(state: GameState, cpuColor: PlayerColor, enemyColor: PlayerColor, profile: DifficultyProfile): number {
  const cpuRemaining = state.remaining[cpuColor]
  const enemyRemaining = state.remaining[enemyColor]
  if (cpuRemaining > profile.endgameThreshold && enemyRemaining > profile.endgameThreshold) {
    return 0
  }

  let bonus = 0
  if (state.winner === cpuColor) {
    bonus += profile.endgameWinWeight
  }

  bonus += Math.max(0, enemyRemaining - cpuRemaining) * 1.9
  bonus += countImmediateWinningMoves(state, cpuColor) * (profile.endgameWinWeight * 0.38)
  bonus -= countImmediateWinningMoves(state, enemyColor) * (profile.endgameThreatPenalty * 0.42)
  return bonus
}

function countImmediateWinningMoves(state: GameState, player: PlayerColor): number {
  if (state.currentTurn !== player) {
    return 0
  }

  const moves = getLegalMoves(state)
  let count = 0
  for (const move of moves) {
    const resolved = placeManualPiece(state, move.level, move.row, move.col)
    if (resolved.winner === player) {
      count += 1
    }
  }
  return count
}
