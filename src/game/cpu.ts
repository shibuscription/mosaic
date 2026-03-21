import { BASE_SIZE, TOTAL_PIECES, type GameState, type Move, type PlayerColor } from './types'
import { canPlaceAt, evaluateSquareForAutoPlacement, getLegalMoves, placeManualPiece } from './logic'
import { chooseKobalabMove } from './kobalab'

export type CpuDifficulty = 'easy' | 'normal' | 'hard' | 'kobalab'

export interface CpuDefinition {
  id: CpuDifficulty
  labelKey: string
  descriptionKey: string
  strategy: 'profile' | 'hard' | 'kobalab'
  supportsAnalysis: boolean
}

export const CPU_DEFINITIONS: CpuDefinition[] = [
  {
    id: 'easy',
    labelKey: 'mode.easy',
    descriptionKey: 'cpu.description.easy',
    strategy: 'profile',
    supportsAnalysis: false,
  },
  {
    id: 'normal',
    labelKey: 'mode.normal',
    descriptionKey: 'cpu.description.normal',
    strategy: 'profile',
    supportsAnalysis: false,
  },
  {
    id: 'hard',
    labelKey: 'mode.hard',
    descriptionKey: 'cpu.description.hard',
    strategy: 'hard',
    supportsAnalysis: true,
  },
  {
    id: 'kobalab',
    labelKey: 'mode.kobalab',
    descriptionKey: 'cpu.description.kobalab',
    strategy: 'kobalab',
    supportsAnalysis: false,
  },
]

export function isCpuDifficulty(value: unknown): value is CpuDifficulty {
  return CPU_DEFINITIONS.some((definition) => definition.id === value)
}

export function getCpuDefinition(difficulty: CpuDifficulty): CpuDefinition {
  return CPU_DEFINITIONS.find((definition) => definition.id === difficulty) ?? CPU_DEFINITIONS[0]
}

interface ScoredMove {
  move: Move
  score: number
}

export interface HardMoveScoreBreakdown {
  immediateValue: number
  immediateBaseValue: number
  immediateMultiplier: number
  immediatePhaseMultiplier: number
  immediateAppliedValue: number
  patternGrowth: number
  patternGrowthBaseValue: number
  patternGrowthAppliedValue: number
  urgentThreatBlock: number
  opponentReplyRisk: number
  opponentReplyRiskBaseValue: number
  opponentReplyRiskAppliedValue: number
  replyRiskBestMoveLevel: number | null
  replyRiskBestMoveRow: number | null
  replyRiskBestMoveCol: number | null
  replyRiskBestMoveLabel: string
  replyRiskBestMoveRawScore: number
  replyRiskBestMoveInstantWin: boolean
  replyRiskEnemyImmediate: number
  replyRiskEnemyPatternGrowth: number
  replyRiskEnemyPatternPotential: number
  replyRiskEnemySuppression: number
  replyRiskFactor: number
  replyRiskRawBeforeCompression: number
  replyRiskCompressedValue: number
  replyRiskCompressionInfo: string
  replyRiskAppliedValue: number
  selfReservedCompletionPenalty: number
  chainBackfirePenalty: number
  endgameAdjustment: number
  noise: number
}

export interface HardMoveCandidate {
  move: Move
  score: number
  rank: number
  endgameScore: number
  endgameGatePassed: boolean
  breakdown: HardMoveScoreBreakdown
  isSelected: boolean
}

export type HardEndgamePhase = 'normal' | 'endgame' | 'late_endgame'

export interface HardMoveAnalysis {
  selected: Move
  phase: HardEndgamePhase
  endgameGateTolerance: number
  phaseImmediateMultiplier: number
  phasePatternGrowthMultiplier: number
  phaseReplyRiskMultiplier: number
  candidates: HardMoveCandidate[]
}

export type HardScoreComponentKey =
  | 'immediateValue'
  | 'patternGrowth'
  | 'urgentThreatBlock'
  | 'opponentReplyRisk'
  | 'selfReservedCompletionPenalty'
  | 'chainBackfirePenalty'
  | 'endgameAdjustment'

export type HardScoreComponentToggles = Record<HardScoreComponentKey, boolean>

export const DEFAULT_HARD_SCORE_COMPONENTS: HardScoreComponentToggles = {
  immediateValue: true,
  patternGrowth: true,
  urgentThreatBlock: true,
  opponentReplyRisk: true,
  selfReservedCompletionPenalty: true,
  chainBackfirePenalty: true,
  endgameAdjustment: true,
}

interface HardScoreOptions {
  enabledComponents?: Partial<HardScoreComponentToggles>
}

interface HardPhaseMultipliers {
  immediate: number
  patternGrowth: number
  replyRisk: number
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
  endgameThreshold: 14,
  endgameWinWeight: 60,
  endgameThreatPenalty: 95,
}

interface HardMoveOutcome {
  resolved: GameState
  selfAutoCount: number
  enemyAutoCount: number
  selfAutoLevelSum: number
  enemyAutoLevelSum: number
  chainDepth: number
  enemyChainDepth: number
  selfSpent: number
}

interface HardScoredMove {
  move: Move
  score: number
  breakdown: HardMoveScoreBreakdown
}

interface HardReplyRiskDetails {
  penalty: number
  bestMove: Move | null
  bestMoveRawScore: number
  bestMoveInstantWin: boolean
  immediate: number
  patternGrowth: number
  patternPotential: number
  suppression: number
  factor: number
  rawBeforeCompression: number
  compressedValue: number
  compressionInfo: string
}

interface PatternPotential {
  strong: number
  neutralBacked: number
  densityLinks: number
}

const HARD_IMMEDIATE_WIN_BONUS = 2600
const HARD_SELF_AUTO_WEIGHT = 56
const HARD_SELF_AUTO_LEVEL_WEIGHT = 10
const HARD_ENEMY_AUTO_PENALTY = 62
const HARD_CHAIN_DEPTH_WEIGHT = 34
const HARD_SELF_SPENT_WEIGHT = 22
const HARD_PATTERN_STRONG_WEIGHT = 26
const HARD_PATTERN_NEUTRAL_WEIGHT = 11
const HARD_PATTERN_DENSITY_WEIGHT = 8
const HARD_OPP_PATTERN_STRONG_PENALTY = 30
const HARD_OPP_PATTERN_NEUTRAL_PENALTY = 13
const HARD_OPP_PATTERN_DENSITY_PENALTY = 8
const HARD_SELF_ONE_TO_TWO_WEIGHT = 14
const HARD_SELF_TWO_TO_THREE_WEIGHT = 30
const HARD_SELF_MULTI_SUPPORT_BONUS = 12
const HARD_ENEMY_THREE_BLOCK_WEIGHT = 44
const HARD_ENEMY_TWO_BLOCK_WEIGHT = 20
const HARD_URGENT_THREE_BREAK_BONUS = 150
const HARD_URGENT_TWO_ONE_BREAK_BONUS = 92
const HARD_REPLY_FACTOR = 0.62
const HARD_REPLY_WIN_PENALTY = 1700
const HARD_SELF_RESERVED_COMPLETION_PENALTY = 18
const HARD_RESERVED_IMMEDIATE_DISCOUNT = 44
const HARD_CHAIN_BACKFIRE_AUTO_WEIGHT = 60
const HARD_CHAIN_BACKFIRE_ABSOLUTE_WEIGHT = 24
const HARD_CHAIN_BACKFIRE_DEPTH_WEIGHT = 48
const HARD_CHAIN_BACKFIRE_LEVEL_WEIGHT = 12
const HARD_CHAIN_BACKFIRE_ENDGAME_THRESHOLD = 12
const HARD_CHAIN_BACKFIRE_ENDGAME_MULTIPLIER = 1.55
const HARD_REPLY_RISK_CAP = 1250
const HARD_ENDGAME_SPENT_BOOST = 16
const HARD_ENDGAME_REMAINING_PENALTY = 4.5
const HARD_NOISE_RANGE = 0.45
const HARD_IMMEDIATE_STAGE_EARLY_PROGRESS = 0.25
const HARD_IMMEDIATE_STAGE_MID_PROGRESS = 0.65
const HARD_IMMEDIATE_EARLY_MULTIPLIER = 0.0
const HARD_IMMEDIATE_MID_MULTIPLIER = 0.5
const HARD_IMMEDIATE_LATE_MULTIPLIER = 1.0
const HARD_ENDGAME_MIN_REMAINING_THRESHOLD = 18
const HARD_ENDGAME_SUM_REMAINING_THRESHOLD = 42
const HARD_LATE_ENDGAME_MIN_REMAINING_THRESHOLD = 10
const HARD_LATE_ENDGAME_SUM_REMAINING_THRESHOLD = 24
const HARD_ENDGAME_SCORE_TOLERANCE = 6
const HARD_LATE_ENDGAME_SCORE_TOLERANCE = 2
const HARD_LATE_ENDGAME_RANDOM_POOL_LIMIT = 2
const HARD_ENDGAME_IMMEDIATE_MULTIPLIER = 0.75
const HARD_LATE_ENDGAME_IMMEDIATE_MULTIPLIER = 0.5
const HARD_ENDGAME_PATTERN_GROWTH_MULTIPLIER = 0.6
const HARD_LATE_ENDGAME_PATTERN_GROWTH_MULTIPLIER = 0.3
const HARD_ENDGAME_REPLY_RISK_MULTIPLIER = 0.75
const HARD_LATE_ENDGAME_REPLY_RISK_MULTIPLIER = 0.5

export function chooseCpuMove(state: GameState, cpuColor: PlayerColor, difficulty: CpuDifficulty): Move | null {
  const legalMoves = getLegalMoves(state)
  if (legalMoves.length === 0) {
    return null
  }
  if (difficulty === 'kobalab') {
    return chooseKobalabMove(state)
  }
  if (difficulty === 'hard') {
    return chooseHardMove(state, legalMoves, cpuColor).move
  }
  const profile = getProfile(difficulty)

  const scored = legalMoves.map((move) => ({ move, score: scoreMove(state, move, cpuColor, profile) }))
  scored.sort((a, b) => b.score - a.score)

  return pickMoveWithVariance(scored, profile)
}

export function chooseCpuMoveWithAnalysis(
  state: GameState,
  cpuColor: PlayerColor,
  difficulty: CpuDifficulty,
  options?: HardScoreOptions,
): { move: Move | null; analysis: HardMoveAnalysis | null } {
  const legalMoves = getLegalMoves(state)
  if (legalMoves.length === 0) {
    return { move: null, analysis: null }
  }

  if (difficulty !== 'hard') {
    return {
      move: chooseCpuMove(state, cpuColor, difficulty),
      analysis: null,
    }
  }

  const picked = chooseHardMove(state, legalMoves, cpuColor, options)
  const sorted = [...picked.scored].sort((a, b) => b.score - a.score)
  const gateKeySet = new Set(picked.gated.map((item) => toMoveKey(item.move)))
  const candidates: HardMoveCandidate[] = sorted.map((item, index) => ({
    move: item.move,
    score: item.score,
    rank: index + 1,
    endgameScore: item.breakdown.endgameAdjustment,
    endgameGatePassed: gateKeySet.has(toMoveKey(item.move)),
    breakdown: item.breakdown,
    isSelected:
      item.move.level === picked.move.level &&
      item.move.row === picked.move.row &&
      item.move.col === picked.move.col,
  }))

  return {
    move: picked.move,
    analysis: {
      selected: picked.move,
      phase: picked.phase,
      endgameGateTolerance: picked.gateTolerance,
      phaseImmediateMultiplier: picked.phaseMultipliers.immediate,
      phasePatternGrowthMultiplier: picked.phaseMultipliers.patternGrowth,
      phaseReplyRiskMultiplier: picked.phaseMultipliers.replyRisk,
      candidates,
    },
  }
}

function scoreMove(
  state: GameState,
  move: Move,
  cpuColor: PlayerColor,
  profile: DifficultyProfile,
): number {
  const afterState = placeManualPiece(state, move.level, move.row, move.col)
  let score = evaluateMoveCore(state, move, cpuColor, profile, afterState)

  score += (Math.random() - 0.5) * profile.noiseRange
  return score
}

function chooseHardMove(
  state: GameState,
  legalMoves: Move[],
  cpuColor: PlayerColor,
  options?: HardScoreOptions,
): {
  move: Move
  scored: HardScoredMove[]
  gated: HardScoredMove[]
  phase: HardEndgamePhase
  gateTolerance: number
  phaseMultipliers: HardPhaseMultipliers
} {
  const phase = resolveHardEndgamePhase(state, cpuColor)
  const phaseMultipliers = resolveHardPhaseMultipliers(phase)
  const scored: HardScoredMove[] = legalMoves.map((move) =>
    scoreHardMove(state, move, cpuColor, phaseMultipliers, options),
  )
  const gateTolerance =
    phase === 'late_endgame'
      ? HARD_LATE_ENDGAME_SCORE_TOLERANCE
      : phase === 'endgame'
        ? HARD_ENDGAME_SCORE_TOLERANCE
        : Number.POSITIVE_INFINITY
  const bestEndgameScore = Math.max(...scored.map((item) => item.breakdown.endgameAdjustment))
  let gated =
    phase === 'normal'
      ? [...scored]
      : scored.filter((item) => item.breakdown.endgameAdjustment >= bestEndgameScore - gateTolerance)

  if (gated.length === 0) {
    gated = [...scored]
  }

  gated.sort((a, b) => b.score - a.score)

  if (phase === 'late_endgame') {
    gated = gated.slice(0, HARD_LATE_ENDGAME_RANDOM_POOL_LIMIT)
  }

  scored.sort((a, b) => b.score - a.score)
  if (gated.length === 1) {
    return { move: gated[0].move, scored, gated, phase, gateTolerance, phaseMultipliers }
  }

  const randomProfile: DifficultyProfile =
    phase === 'normal'
      ? HARD_PROFILE
      : {
          ...HARD_PROFILE,
          nearBestMargin: phase === 'late_endgame' ? 2.5 : HARD_PROFILE.nearBestMargin,
          poolLimit:
            phase === 'late_endgame'
              ? Math.min(HARD_LATE_ENDGAME_RANDOM_POOL_LIMIT, gated.length)
              : Math.min(HARD_PROFILE.poolLimit, gated.length),
          noiseRange: phase === 'late_endgame' ? Math.min(HARD_PROFILE.noiseRange, 0.2) : HARD_PROFILE.noiseRange,
        }

  const sampled = pickMoveWithVariance(
    gated.map((item) => ({ move: item.move, score: item.score })),
    randomProfile,
  )
  return { move: sampled, scored, gated, phase, gateTolerance, phaseMultipliers }
}

function scoreHardMove(
  state: GameState,
  move: Move,
  cpuColor: PlayerColor,
  phaseMultipliers: HardPhaseMultipliers,
  options?: HardScoreOptions,
): HardScoredMove {
  const enabled = resolveHardScoreComponents(options?.enabledComponents)
  const outcome = simulateHardMoveOutcome(state, move, cpuColor)
  if (outcome.resolved.winner === cpuColor && enabled.immediateValue) {
    const noise = (Math.random() - 0.5) * HARD_NOISE_RANGE
    const breakdown: HardMoveScoreBreakdown = {
      immediateValue: HARD_IMMEDIATE_WIN_BONUS,
      immediateBaseValue: HARD_IMMEDIATE_WIN_BONUS,
      immediateMultiplier: 1,
      immediatePhaseMultiplier: 1,
      immediateAppliedValue: HARD_IMMEDIATE_WIN_BONUS,
      patternGrowth: 0,
      patternGrowthBaseValue: 0,
      patternGrowthAppliedValue: 0,
      urgentThreatBlock: 0,
      opponentReplyRisk: 0,
      opponentReplyRiskBaseValue: 0,
      opponentReplyRiskAppliedValue: 0,
      replyRiskBestMoveLevel: null,
      replyRiskBestMoveRow: null,
      replyRiskBestMoveCol: null,
      replyRiskBestMoveLabel: '-',
      replyRiskBestMoveRawScore: 0,
      replyRiskBestMoveInstantWin: false,
      replyRiskEnemyImmediate: 0,
      replyRiskEnemyPatternGrowth: 0,
      replyRiskEnemyPatternPotential: 0,
      replyRiskEnemySuppression: 0,
      replyRiskFactor: HARD_REPLY_FACTOR,
      replyRiskRawBeforeCompression: 0,
      replyRiskCompressedValue: 0,
      replyRiskCompressionInfo: `cap:${HARD_REPLY_RISK_CAP},compress:sqrt*22`,
      replyRiskAppliedValue: 0,
      selfReservedCompletionPenalty: 0,
      chainBackfirePenalty: 0,
      endgameAdjustment: 0,
      noise,
    }
    return {
      move,
      score: computeHardScoreFromBreakdown(breakdown, enabled),
      breakdown,
    }
  }
  const localPatternDelta = evaluateHardLocalPatternDelta(state, move, cpuColor)
  const urgentThreatBlock = evaluateHardUrgentThreatBlock(state, move, cpuColor)
  const selfPattern = evaluateHardPatternPotential(outcome.resolved, cpuColor)
  const opponentReplyRisk = evaluateHardOpponentReply(outcome.resolved, cpuColor)
  const completionRisk = evaluateHardSelfCompletionRiskPenalty(state, move, cpuColor)
  const chainBackfirePenalty = evaluateHardChainBackfirePenalty(outcome, cpuColor)
  const endgameAdjustment = evaluateHardEndgameAdjustment(outcome, cpuColor)
  const noise = (Math.random() - 0.5) * HARD_NOISE_RANGE

  const reservedImmediatePenalty =
    completionRisk.selfReservedCompletionCount * HARD_RESERVED_IMMEDIATE_DISCOUNT
  const immediateBaseValue = evaluateHardImmediateValue(outcome) - reservedImmediatePenalty
  const immediateMultiplier = resolveImmediateMultiplier(outcome.resolved)
  const immediateAppliedValue = immediateBaseValue * immediateMultiplier * phaseMultipliers.immediate
  const immediateValue = immediateAppliedValue
  const patternGrowthBaseValue = selfPattern + localPatternDelta
  const patternGrowthAppliedValue = patternGrowthBaseValue * phaseMultipliers.patternGrowth
  const patternGrowth = patternGrowthAppliedValue
  const opponentReplyRiskBaseValue = opponentReplyRisk.penalty
  const opponentReplyRiskAppliedValue = opponentReplyRiskBaseValue * phaseMultipliers.replyRisk

  const breakdown: HardMoveScoreBreakdown = {
    immediateValue,
    immediateBaseValue,
    immediateMultiplier,
    immediatePhaseMultiplier: phaseMultipliers.immediate,
    immediateAppliedValue,
    patternGrowth,
    patternGrowthBaseValue,
    patternGrowthAppliedValue,
    urgentThreatBlock,
    opponentReplyRisk: opponentReplyRiskAppliedValue,
    opponentReplyRiskBaseValue,
    opponentReplyRiskAppliedValue,
    replyRiskBestMoveLevel: opponentReplyRisk.bestMove?.level ?? null,
    replyRiskBestMoveRow: opponentReplyRisk.bestMove?.row ?? null,
    replyRiskBestMoveCol: opponentReplyRisk.bestMove?.col ?? null,
    replyRiskBestMoveLabel: opponentReplyRisk.bestMove
      ? `L${opponentReplyRisk.bestMove.level} (${opponentReplyRisk.bestMove.row + 1},${opponentReplyRisk.bestMove.col + 1})`
      : '-',
    replyRiskBestMoveRawScore: opponentReplyRisk.bestMoveRawScore,
    replyRiskBestMoveInstantWin: opponentReplyRisk.bestMoveInstantWin,
    replyRiskEnemyImmediate: opponentReplyRisk.immediate,
    replyRiskEnemyPatternGrowth: opponentReplyRisk.patternGrowth,
    replyRiskEnemyPatternPotential: opponentReplyRisk.patternPotential,
    replyRiskEnemySuppression: opponentReplyRisk.suppression,
    replyRiskFactor: opponentReplyRisk.factor,
    replyRiskRawBeforeCompression: opponentReplyRisk.rawBeforeCompression,
    replyRiskCompressedValue: opponentReplyRisk.compressedValue,
    replyRiskCompressionInfo: opponentReplyRisk.compressionInfo,
    replyRiskAppliedValue: opponentReplyRiskAppliedValue,
    selfReservedCompletionPenalty: completionRisk.selfReservedCompletionPenalty,
    chainBackfirePenalty,
    endgameAdjustment,
    noise,
  }
  const score = computeHardScoreFromBreakdown(breakdown, enabled)
  return {
    move,
    score,
    breakdown,
  }
}

function resolveImmediateMultiplier(state: GameState): number {
  const totalInitialPieces = TOTAL_PIECES * 2
  const remainingTotal = state.remaining.blue + state.remaining.yellow
  const placedProgress = (totalInitialPieces - remainingTotal) / totalInitialPieces

  if (placedProgress < HARD_IMMEDIATE_STAGE_EARLY_PROGRESS) {
    return HARD_IMMEDIATE_EARLY_MULTIPLIER
  }
  if (placedProgress < HARD_IMMEDIATE_STAGE_MID_PROGRESS) {
    return HARD_IMMEDIATE_MID_MULTIPLIER
  }
  return HARD_IMMEDIATE_LATE_MULTIPLIER
}

export function computeHardScoreFromBreakdown(
  breakdown: HardMoveScoreBreakdown,
  enabledComponents?: Partial<HardScoreComponentToggles>,
): number {
  const enabled = resolveHardScoreComponents(enabledComponents)
  let score = 0

  if (enabled.immediateValue) {
    score += breakdown.immediateValue
  }
  if (enabled.patternGrowth) {
    score += breakdown.patternGrowth
  }
  if (enabled.urgentThreatBlock) {
    score += breakdown.urgentThreatBlock
  }
  if (enabled.opponentReplyRisk) {
    score -= breakdown.opponentReplyRisk
  }
  if (enabled.selfReservedCompletionPenalty) {
    score -= breakdown.selfReservedCompletionPenalty
  }
  if (enabled.chainBackfirePenalty) {
    score -= breakdown.chainBackfirePenalty
  }
  if (enabled.endgameAdjustment) {
    score += breakdown.endgameAdjustment
  }

  score += breakdown.noise
  return score
}

function resolveHardScoreComponents(
  enabledComponents?: Partial<HardScoreComponentToggles>,
): HardScoreComponentToggles {
  return {
    ...DEFAULT_HARD_SCORE_COMPONENTS,
    ...enabledComponents,
  }
}

function resolveHardEndgamePhase(state: GameState, cpuColor: PlayerColor): HardEndgamePhase {
  const enemyColor: PlayerColor = cpuColor === 'blue' ? 'yellow' : 'blue'
  const selfRemaining = state.remaining[cpuColor]
  const opponentRemaining = state.remaining[enemyColor]
  const minRemaining = Math.min(selfRemaining, opponentRemaining)
  const totalRemaining = selfRemaining + opponentRemaining

  if (
    minRemaining <= HARD_LATE_ENDGAME_MIN_REMAINING_THRESHOLD ||
    totalRemaining <= HARD_LATE_ENDGAME_SUM_REMAINING_THRESHOLD
  ) {
    return 'late_endgame'
  }
  if (
    minRemaining <= HARD_ENDGAME_MIN_REMAINING_THRESHOLD ||
    totalRemaining <= HARD_ENDGAME_SUM_REMAINING_THRESHOLD
  ) {
    return 'endgame'
  }
  return 'normal'
}

function resolveHardPhaseMultipliers(phase: HardEndgamePhase): HardPhaseMultipliers {
  if (phase === 'late_endgame') {
    return {
      immediate: HARD_LATE_ENDGAME_IMMEDIATE_MULTIPLIER,
      patternGrowth: HARD_LATE_ENDGAME_PATTERN_GROWTH_MULTIPLIER,
      replyRisk: HARD_LATE_ENDGAME_REPLY_RISK_MULTIPLIER,
    }
  }

  if (phase === 'endgame') {
    return {
      immediate: HARD_ENDGAME_IMMEDIATE_MULTIPLIER,
      patternGrowth: HARD_ENDGAME_PATTERN_GROWTH_MULTIPLIER,
      replyRisk: HARD_ENDGAME_REPLY_RISK_MULTIPLIER,
    }
  }

  return {
    immediate: 1,
    patternGrowth: 1,
    replyRisk: 1,
  }
}

function toMoveKey(move: Move): string {
  return `${move.level}-${move.row}-${move.col}`
}

function evaluateHardUrgentThreatBlock(state: GameState, move: Move, cpuColor: PlayerColor): number {
  const enemyColor: PlayerColor = cpuColor === 'blue' ? 'yellow' : 'blue'
  const level = move.level
  const size = BASE_SIZE - level

  let threeBreak = 0
  let twoOneBreak = 0

  for (let dr = -1; dr <= 0; dr += 1) {
    for (let dc = -1; dc <= 0; dc += 1) {
      const sr = move.row + dr
      const sc = move.col + dc
      if (sr < 0 || sc < 0 || sr >= size - 1 || sc >= size - 1) {
        continue
      }

      const before = getSquareStats(state, level, sr, sc, enemyColor)
      const after = getSquareStatsWithMove(state, move, level, sr, sc, enemyColor)

      if (before.emptyCount !== 1) {
        continue
      }

      // Enemy had 3-majority pressure with one hole and this move removed that immediate completion window.
      if (before.enemySame >= 3 && after.enemySame < 3) {
        threeBreak += 1
      }

      // Enemy had 2-1 advantage with one hole and this move prevented immediate 3化ルート。
      if (before.enemySame === 2 && before.selfOrNeutral === 1 && after.enemySame <= 2 && after.emptyCount === 0) {
        twoOneBreak += 1
      }
    }
  }

  return threeBreak * HARD_URGENT_THREE_BREAK_BONUS + twoOneBreak * HARD_URGENT_TWO_ONE_BREAK_BONUS

  function getSquareStats(
    targetState: GameState,
    targetLevel: number,
    row: number,
    col: number,
    targetEnemy: PlayerColor,
  ) {
    const colors = [
      targetState.board[targetLevel][row][col]?.color ?? null,
      targetState.board[targetLevel][row + 1][col]?.color ?? null,
      targetState.board[targetLevel][row][col + 1]?.color ?? null,
      targetState.board[targetLevel][row + 1][col + 1]?.color ?? null,
    ]
    const enemySame = colors.filter((c) => c === targetEnemy).length
    const emptyCount = colors.filter((c) => c === null).length
    return {
      enemySame,
      selfOrNeutral: 4 - enemySame - emptyCount,
      emptyCount,
    }
  }

  function getSquareStatsWithMove(
    targetState: GameState,
    targetMove: Move,
    targetLevel: number,
    row: number,
    col: number,
    targetEnemy: PlayerColor,
  ) {
    const colors = [
      getCellColor(targetState, targetLevel, row, col, targetMove),
      getCellColor(targetState, targetLevel, row + 1, col, targetMove),
      getCellColor(targetState, targetLevel, row, col + 1, targetMove),
      getCellColor(targetState, targetLevel, row + 1, col + 1, targetMove),
    ]
    const enemySame = colors.filter((c) => c === targetEnemy).length
    const emptyCount = colors.filter((c) => c === null).length
    return {
      enemySame,
      selfOrNeutral: 4 - enemySame - emptyCount,
      emptyCount,
    }
  }
}

function simulateHardMoveOutcome(state: GameState, move: Move, cpuColor: PlayerColor): HardMoveOutcome {
  const enemyColor: PlayerColor = cpuColor === 'blue' ? 'yellow' : 'blue'
  const resolved = placeManualPiece(state, move.level, move.row, move.col)
  const selfAutoMoves = resolved.lastAutoPlacements.filter((item) => item.color === cpuColor)
  const enemyAutoMoves = resolved.lastAutoPlacements.filter((item) => item.color === enemyColor)

  return {
    resolved,
    selfAutoCount: selfAutoMoves.length,
    enemyAutoCount: enemyAutoMoves.length,
    selfAutoLevelSum: selfAutoMoves.reduce((sum, item) => sum + (item.level + 1), 0),
    enemyAutoLevelSum: enemyAutoMoves.reduce((sum, item) => sum + (item.level + 1), 0),
    chainDepth: estimateChainDepth(move.level, resolved.lastAutoPlacements.map((item) => item.level)),
    enemyChainDepth: estimateChainDepth(move.level, enemyAutoMoves.map((item) => item.level)),
    selfSpent: Math.max(0, state.remaining[cpuColor] - resolved.remaining[cpuColor]),
  }
}

function evaluateHardImmediateValue(outcome: HardMoveOutcome): number {
  let score = 0
  score += outcome.selfAutoCount * HARD_SELF_AUTO_WEIGHT
  score += outcome.selfAutoLevelSum * HARD_SELF_AUTO_LEVEL_WEIGHT
  score -= outcome.enemyAutoCount * HARD_ENEMY_AUTO_PENALTY
  score += Math.max(0, outcome.chainDepth - 1) * HARD_CHAIN_DEPTH_WEIGHT
  score += outcome.selfSpent * HARD_SELF_SPENT_WEIGHT
  return score
}

function evaluateHardPatternPotential(state: GameState, color: PlayerColor, asPenalty = false): number {
  const pattern = countPatternPotential(state, color)
  const strongScore = pattern.strong * HARD_PATTERN_STRONG_WEIGHT
  const neutralScore = pattern.neutralBacked * HARD_PATTERN_NEUTRAL_WEIGHT
  const densityScore = pattern.densityLinks * HARD_PATTERN_DENSITY_WEIGHT
  const total = strongScore + neutralScore + densityScore
  if (!asPenalty) {
    return total
  }
  return (
    pattern.strong * HARD_OPP_PATTERN_STRONG_PENALTY +
    pattern.neutralBacked * HARD_OPP_PATTERN_NEUTRAL_PENALTY +
    pattern.densityLinks * HARD_OPP_PATTERN_DENSITY_PENALTY
  )
}

function evaluateHardOpponentReply(afterMyMove: GameState, cpuColor: PlayerColor): HardReplyRiskDetails {
  const enemyColor: PlayerColor = cpuColor === 'blue' ? 'yellow' : 'blue'
  const replies = getLegalMoves(afterMyMove)
  if (replies.length === 0) {
    return {
      penalty: 0,
      bestMove: null,
      bestMoveRawScore: 0,
      bestMoveInstantWin: false,
      immediate: 0,
      patternGrowth: 0,
      patternPotential: 0,
      suppression: 0,
      factor: HARD_REPLY_FACTOR,
      rawBeforeCompression: 0,
      compressedValue: 0,
      compressionInfo: `cap:${HARD_REPLY_RISK_CAP},compress:sqrt*22`,
    }
  }

  let bestEnemyValue = -Infinity
  let enemyCanWin = false
  let bestMove: Move | null = null
  let bestMoveInstantWin = false
  let bestImmediate = 0
  let bestPatternGrowth = 0
  let bestPatternPotential = 0
  let bestSuppression = 0

  for (const reply of replies) {
    const outcome = simulateHardMoveOutcome(afterMyMove, reply, enemyColor)
    const instantWin = outcome.resolved.winner === enemyColor
    if (instantWin) {
      enemyCanWin = true
    }
    const immediate = evaluateHardImmediateValue(outcome)
    const patternGrowth = evaluateHardLocalPatternDelta(afterMyMove, reply, enemyColor)
    const patternPotential = evaluateHardPatternPotential(outcome.resolved, enemyColor)
    const suppression = -evaluateHardPatternPotential(outcome.resolved, cpuColor, true)
    const enemyValue = immediate + patternGrowth + patternPotential + suppression
    if (enemyValue > bestEnemyValue) {
      bestEnemyValue = enemyValue
      bestMove = reply
      bestMoveInstantWin = instantWin
      bestImmediate = immediate
      bestPatternGrowth = patternGrowth
      bestPatternPotential = patternPotential
      bestSuppression = suppression
    }
  }

  const rawBeforeCompression = Math.max(0, bestEnemyValue) * HARD_REPLY_FACTOR
  const compressedValue = compressReplyRisk(rawBeforeCompression)
  let penalty = compressedValue
  if (enemyCanWin) {
    penalty += HARD_REPLY_WIN_PENALTY
  }
  return {
    penalty,
    bestMove,
    bestMoveRawScore: Number.isFinite(bestEnemyValue) ? bestEnemyValue : 0,
    bestMoveInstantWin,
    immediate: bestImmediate,
    patternGrowth: bestPatternGrowth,
    patternPotential: bestPatternPotential,
    suppression: bestSuppression,
    factor: HARD_REPLY_FACTOR,
    rawBeforeCompression,
    compressedValue,
    compressionInfo: `cap:${HARD_REPLY_RISK_CAP},compress:sqrt*22${enemyCanWin ? `,win:+${HARD_REPLY_WIN_PENALTY}` : ''}`,
  }

  function compressReplyRisk(rawPenalty: number): number {
    if (rawPenalty <= HARD_REPLY_RISK_CAP) {
      return rawPenalty
    }
    // Keep sensitivity around medium values while preventing one item from dominating total score.
    return HARD_REPLY_RISK_CAP + Math.sqrt(rawPenalty - HARD_REPLY_RISK_CAP) * 22
  }
}

function evaluateHardEndgameAdjustment(outcome: HardMoveOutcome, cpuColor: PlayerColor): number {
  const remaining = outcome.resolved.remaining[cpuColor]
  if (remaining > HARD_PROFILE.endgameThreshold) {
    return 0
  }
  return outcome.selfSpent * HARD_ENDGAME_SPENT_BOOST - remaining * HARD_ENDGAME_REMAINING_PENALTY
}

function evaluateHardSelfCompletionRiskPenalty(
  state: GameState,
  move: Move,
  cpuColor: PlayerColor,
): {
  selfReservedCompletionPenalty: number
  selfReservedCompletionCount: number
} {
  const level = move.level
  const size = BASE_SIZE - level

  let selfReserved = 0

  for (let dr = -1; dr <= 0; dr += 1) {
    for (let dc = -1; dc <= 0; dc += 1) {
      const sr = move.row + dr
      const sc = move.col + dc
      if (sr < 0 || sc < 0 || sr >= size - 1 || sc >= size - 1) {
        continue
      }

      const stats = getSquareStats(state, level, sr, sc)
      if (stats.emptyCount !== 1) {
        continue
      }

      if (stats.selfSame === 3 && stats.enemySame === 0 && stats.neutralSame === 0) {
        selfReserved += HARD_SELF_RESERVED_COMPLETION_PENALTY
      }
    }
  }

  return {
    selfReservedCompletionPenalty: selfReserved,
    selfReservedCompletionCount: Math.floor(selfReserved / HARD_SELF_RESERVED_COMPLETION_PENALTY),
  }

  function getSquareStats(targetState: GameState, targetLevel: number, row: number, col: number) {
    const colors = [
      targetState.board[targetLevel][row][col]?.color ?? null,
      targetState.board[targetLevel][row + 1][col]?.color ?? null,
      targetState.board[targetLevel][row][col + 1]?.color ?? null,
      targetState.board[targetLevel][row + 1][col + 1]?.color ?? null,
    ]
    return {
      selfSame: colors.filter((c) => c === cpuColor).length,
      enemySame: colors.filter((c) => c !== null && c !== cpuColor).length,
      neutralSame: colors.filter((c) => c === 'neutral').length,
      emptyCount: colors.filter((c) => c === null).length,
    }
  }
}

function evaluateHardChainBackfirePenalty(outcome: HardMoveOutcome, cpuColor: PlayerColor): number {
  const enemyColor: PlayerColor = cpuColor === 'blue' ? 'yellow' : 'blue'
  let penalty = 0
  const enemyAutoAdvantage = Math.max(0, outcome.enemyAutoCount - outcome.selfAutoCount)
  penalty += enemyAutoAdvantage * HARD_CHAIN_BACKFIRE_AUTO_WEIGHT
  penalty += outcome.enemyAutoCount * HARD_CHAIN_BACKFIRE_ABSOLUTE_WEIGHT

  const enemyDepthAdvantage = Math.max(0, outcome.enemyChainDepth - outcome.chainDepth)
  penalty += enemyDepthAdvantage * HARD_CHAIN_BACKFIRE_DEPTH_WEIGHT

  const enemyLevelAdvantage = Math.max(0, outcome.enemyAutoLevelSum - Math.floor(outcome.selfAutoLevelSum * 0.8))
  penalty += enemyLevelAdvantage * HARD_CHAIN_BACKFIRE_LEVEL_WEIGHT

  const enemyRemaining = outcome.resolved.remaining[enemyColor]
  if (enemyRemaining <= HARD_CHAIN_BACKFIRE_ENDGAME_THRESHOLD && outcome.enemyAutoCount > 0) {
    penalty *= HARD_CHAIN_BACKFIRE_ENDGAME_MULTIPLIER
  }

  return penalty
}

function evaluateHardLocalPatternDelta(state: GameState, move: Move, cpuColor: PlayerColor): number {
  const enemyColor: PlayerColor = cpuColor === 'blue' ? 'yellow' : 'blue'
  const level = move.level
  const size = BASE_SIZE - level

  let selfOneToTwo = 0
  let selfTwoToThree = 0
  let enemyThreeBlocked = 0
  let enemyTwoSuppressed = 0

  for (let dr = -1; dr <= 0; dr += 1) {
    for (let dc = -1; dc <= 0; dc += 1) {
      const sr = move.row + dr
      const sc = move.col + dc
      if (sr < 0 || sc < 0 || sr >= size - 1 || sc >= size - 1) {
        continue
      }

      const before = countSquareColors(state, level, sr, sc)
      const after = countSquareColorsAfterMove(state, move, level, sr, sc)

      if (before.selfSame === 1 && after.selfSame >= 2) {
        selfOneToTwo += 1
      }
      if (before.selfSame === 2 && after.selfSame >= 3) {
        selfTwoToThree += 1
      }

      if (before.enemySame >= 3 && after.enemySame < 3) {
        enemyThreeBlocked += 1
      } else if (before.enemySame === 2 && before.emptyCount >= 2 && after.emptyCount < before.emptyCount) {
        enemyTwoSuppressed += 1
      }
    }
  }

  const multiSupportBonus = Math.max(0, selfOneToTwo + selfTwoToThree - 1)

  return (
    selfOneToTwo * HARD_SELF_ONE_TO_TWO_WEIGHT +
    selfTwoToThree * HARD_SELF_TWO_TO_THREE_WEIGHT +
    multiSupportBonus * HARD_SELF_MULTI_SUPPORT_BONUS +
    enemyThreeBlocked * HARD_ENEMY_THREE_BLOCK_WEIGHT +
    enemyTwoSuppressed * HARD_ENEMY_TWO_BLOCK_WEIGHT
  )

  function countSquareColors(targetState: GameState, targetLevel: number, row: number, col: number) {
    const colors = [
      targetState.board[targetLevel][row][col]?.color ?? null,
      targetState.board[targetLevel][row + 1][col]?.color ?? null,
      targetState.board[targetLevel][row][col + 1]?.color ?? null,
      targetState.board[targetLevel][row + 1][col + 1]?.color ?? null,
    ]
    return {
      selfSame: colors.filter((c) => c === cpuColor).length,
      enemySame: colors.filter((c) => c === enemyColor).length,
      emptyCount: colors.filter((c) => c === null).length,
    }
  }

  function countSquareColorsAfterMove(targetState: GameState, targetMove: Move, targetLevel: number, row: number, col: number) {
    const colors = [
      getCellColor(targetState, targetLevel, row, col, targetMove),
      getCellColor(targetState, targetLevel, row + 1, col, targetMove),
      getCellColor(targetState, targetLevel, row, col + 1, targetMove),
      getCellColor(targetState, targetLevel, row + 1, col + 1, targetMove),
    ]
    return {
      selfSame: colors.filter((c) => c === cpuColor).length,
      enemySame: colors.filter((c) => c === enemyColor).length,
      emptyCount: colors.filter((c) => c === null).length,
    }
  }
}

function countPatternPotential(state: GameState, color: PlayerColor): PatternPotential {
  let strong = 0
  let neutralBacked = 0
  const positions: Array<{ level: number; row: number; col: number }> = []

  for (let level = 0; level < BASE_SIZE - 1; level += 1) {
    const size = BASE_SIZE - level
    for (let row = 0; row < size - 1; row += 1) {
      for (let col = 0; col < size - 1; col += 1) {
        if (!canPlaceAt(state.board, level + 1, row, col)) {
          continue
        }
        const colors = [
          state.board[level][row][col]?.color ?? null,
          state.board[level][row + 1][col]?.color ?? null,
          state.board[level][row][col + 1]?.color ?? null,
          state.board[level][row + 1][col + 1]?.color ?? null,
        ]
        const same = colors.filter((item) => item === color).length
        if (same >= 3) {
          strong += 1
          positions.push({ level, row, col })
        } else if (same === 2 && colors.some((item) => item === 'neutral')) {
          neutralBacked += 1
          positions.push({ level, row, col })
        }
      }
    }
  }

  return {
    strong,
    neutralBacked,
    densityLinks: estimatePatternDensity(positions),
  }
}

function estimatePatternDensity(positions: Array<{ level: number; row: number; col: number }>): number {
  let links = 0
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      if (positions[i].level !== positions[j].level) {
        continue
      }
      const rowDiff = Math.abs(positions[i].row - positions[j].row)
      const colDiff = Math.abs(positions[i].col - positions[j].col)
      if (rowDiff <= 1 && colDiff <= 1) {
        links += 1
      }
    }
  }
  return links
}

function estimateChainDepth(manualLevel: number, autoLevels: number[]): number {
  if (autoLevels.length === 0) {
    return 1
  }
  let minLevel = manualLevel
  let maxLevel = manualLevel
  for (const level of autoLevels) {
    if (level < minLevel) {
      minLevel = level
    }
    if (level > maxLevel) {
      maxLevel = level
    }
  }
  return maxLevel - minLevel + 1
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
