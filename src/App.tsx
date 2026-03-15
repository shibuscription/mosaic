import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BASE_SIZE, MAX_LEVEL, TOTAL_PIECES, type AutoPlacement, type GameState, type Move, type PlayerColor } from './game/types'
import { createInitialGameState, getLegalMoves, getLevelSize, getPiece, placeManualPiece } from './game/logic'
import {
  chooseCpuMove,
  chooseCpuMoveWithAnalysis,
  computeHardScoreFromBreakdown,
  DEFAULT_HARD_SCORE_COMPONENTS,
  type CpuDifficulty,
  type HardMoveAnalysis,
  type HardMoveCandidate,
  type HardScoreComponentKey,
  type HardScoreComponentToggles,
} from './game/cpu'
import { Board3DViewport } from './components/Board3DViewport'
import { isFirebaseConfigured } from './firebase'
import { resolveLanguage, translate, type AppLanguage } from './i18n'
import {
  createMosaicRecordFileName,
  downloadMosaicRecord,
  parseMosaicRecord,
  type MosaicRecordV1,
} from './record/file'
import {
  createMosaicScoreSheetFileName,
  exportMosaicScoreSheetPng,
  type ScoreSheetRenderLabels,
} from './record/sheet'
import {
  RoomError,
  createRoom,
  joinRoom,
  markPlayerLeft,
  normalizeRoomCode,
  submitRoomMove,
  subscribeRoom,
  updateRoomHeartbeat,
  type RoomDoc,
  deserializeGameState,
} from './online/room'
import './style.css'

type DisplayColorId =
  | 'classic_brown'
  | 'classic_blue'
  | 'milkyway_blue'
  | 'milkyway_white'
  | 'pastel_pink'
  | 'pastel_green'
  | 'halfblue_sky'
  | 'halfblue_white'
  | 'trad_black'
  | 'trad_white'
  | 'miyabi_teal'
  | 'miyabi_vermilion'
  | 'iki_blue'
  | 'iki_white'
  | 'oribe_green'
  | 'oribe_deepbrown'

interface ColorOption {
  id: DisplayColorId
  label: string
  hex: string
}

interface ColorPairTheme {
  key: string
  label: string
  colors: [DisplayColorId, DisplayColorId]
}

interface PlayerColorConfig {
  blue: DisplayColorId
  yellow: DisplayColorId
}
type MatchMode = 'pvp' | 'cpu' | 'online'
type SetupStep = 'mode' | 'color'
type OnlineEntryAction = 'create' | 'join' | null
type CpuTurnOrder = 'you_first' | 'you_second'
type HostTurnOrder = 'host_first' | 'host_second'
type CpuMatchType = 'you_vs_cpu' | 'cpu_vs_cpu'
type MobilePanelMode = 'standard' | 'faceoff'
type BoardRendererMode = '2d' | '3d'
type PlaybackStatus = 'playing' | 'paused'
type OnlinePhase = 'create' | 'join' | 'waiting' | 'playing' | 'error' | 'finished' | 'closed' | 'interrupted'
type OnlineConnectionState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'disconnected'
type OnlineSyncState = 'idle' | 'submitting'

interface MoveRecord {
  turn: number
  player: PlayerColor
  manual: Move
  autoPlacements: AutoPlacement[]
}

interface MatchRecord {
  players: PlayerColorConfig
  moves: MoveRecord[]
  winner: PlayerColor | null
}

interface UndoSnapshot {
  game: GameState
  matchRecord: MatchRecord
}

interface PlaybackFrame {
  game: GameState
  remaining: Record<PlayerColor, number>
  animatingKey: string | null
  revealedAutoCount: number
  sound: 'manual' | 'auto' | null
  autoChainIndex: number
  delayMs: number
}

interface PlaybackBuildResult {
  frames: PlaybackFrame[]
  moveStartFrameIndices: number[]
  moveEndFrameIndices: number[]
  frameToMoveCursor: number[]
  initialGame: GameState
  initialRemaining: Record<PlayerColor, number>
  finalGame: GameState
  finalRemaining: Record<PlayerColor, number>
}

interface OnlineSessionState {
  phase: OnlinePhase
  roomCode: string
  roomInput: string
  role: PlayerColor | null
  isHost: boolean
  connectionState: OnlineConnectionState
  syncState: OnlineSyncState
  errorMessage: string
  waitMessage: string
  createColors: PlayerColorConfig
}

type DebugScoreCategoryKey = 'gain' | 'growth' | 'safety' | 'lookahead'

interface DebugScoreCategory {
  key: DebugScoreCategoryKey
  label: string
}

interface DebugScoreComponentDefinition {
  key: HardScoreComponentKey
  label: string
  category: DebugScoreCategoryKey
  description: string
}

type DebugOverlayMode = 'total' | HardScoreComponentKey
type ChainTone = 'cool' | 'violet' | 'magenta' | 'orange' | 'hot'

interface ChainBannerState {
  id: number
  count: number
  tone: ChainTone
  left: number
  top: number
}

const DEBUG_SCORE_CATEGORIES: DebugScoreCategory[] = [
  { key: 'gain', label: 'Gain' },
  { key: 'growth', label: 'Growth' },
  { key: 'safety', label: 'Safety' },
  { key: 'lookahead', label: 'Lookahead' },
]

const DEBUG_SCORE_COMPONENTS: DebugScoreComponentDefinition[] = [
  {
    key: 'immediateValue',
    label: 'Immediate',
    category: 'gain',
    description: 'この手を打った瞬間の価値。base 値に係数を掛けた applied 値を合計へ反映。',
  },
  {
    key: 'endgameAdjustment',
    label: 'Endgame',
    category: 'gain',
    description: '終盤で置き切り勝ちに近づく補正。自分のコマを多く減らせる手を評価。',
  },
  {
    key: 'patternGrowth',
    label: 'Pattern Growth',
    category: 'growth',
    description: '次につながる自分の形づくりを評価。',
  },
  {
    key: 'urgentThreatBlock',
    label: 'Urgent Threat Block',
    category: 'safety',
    description: '相手の即危険な形を止める評価。',
  },
  {
    key: 'selfReservedCompletionPenalty',
    label: 'Reserved Completion',
    category: 'safety',
    description: '予約済みの自連鎖を自分で回収しすぎないための減点。',
  },
  {
    key: 'chainBackfirePenalty',
    label: 'Chain Backfire',
    category: 'safety',
    description: '自分の手が相手連鎖の燃料になる危険への減点。',
  },
  {
    key: 'opponentReplyRisk',
    label: 'Reply Risk',
    category: 'lookahead',
    description: 'この手の後に相手最善返しがどれだけ強いかを減点。',
  },
]

const COLOR_OPTIONS: ColorOption[] = [
  { id: 'classic_brown', label: 'Classic Brown', hex: '#7b5a3b' },
  { id: 'classic_blue', label: 'Classic Blue', hex: '#2f5f9d' },
  { id: 'milkyway_blue', label: 'Milky Way Blue', hex: '#1f3f86' },
  { id: 'milkyway_white', label: 'Milky Way White', hex: '#f4f5f2' },
  { id: 'pastel_pink', label: 'Pastel Pink', hex: '#f2b8cf' },
  { id: 'pastel_green', label: 'Pastel Green', hex: '#b9dfc7' },
  { id: 'halfblue_sky', label: 'Half Blue Sky', hex: '#a8d8f2' },
  { id: 'halfblue_white', label: 'Half Blue White', hex: '#fbfbf8' },
  { id: 'trad_black', label: 'Trad Black', hex: '#1f2328' },
  { id: 'trad_white', label: 'Trad White', hex: '#ffffff' },
  { id: 'miyabi_teal', label: 'Miyabi Teal', hex: '#0d5a59' },
  { id: 'miyabi_vermilion', label: 'Miyabi Vermilion', hex: '#bf4a2d' },
  { id: 'iki_blue', label: 'Iki Blue', hex: '#3e6fb3' },
  { id: 'iki_white', label: 'Iki White', hex: '#f7f7f3' },
  { id: 'oribe_green', label: 'Oribe Green', hex: '#5b7d48' },
  { id: 'oribe_deepbrown', label: 'Oribe Deep Brown', hex: '#4f3b2d' },
]

const COLOR_PAIR_THEMES: ColorPairTheme[] = [
  { key: 'classic', label: 'Classic', colors: ['classic_brown', 'classic_blue'] },
  { key: 'milkyway', label: 'Milky Way', colors: ['milkyway_blue', 'milkyway_white'] },
  { key: 'pastel', label: 'Pastel', colors: ['pastel_pink', 'pastel_green'] },
  { key: 'halfblue', label: 'Half Blue', colors: ['halfblue_sky', 'halfblue_white'] },
  { key: 'trad', label: 'Trad', colors: ['trad_black', 'trad_white'] },
  { key: 'miyabi', label: 'Miyabi', colors: ['miyabi_teal', 'miyabi_vermilion'] },
  { key: 'iki', label: 'Iki', colors: ['iki_blue', 'iki_white'] },
  { key: 'oribe', label: 'Oribe', colors: ['oribe_green', 'oribe_deepbrown'] },
]

const COLOR_OPTION_BY_ID = new Map<DisplayColorId, ColorOption>(COLOR_OPTIONS.map((option) => [option.id, option]))

// Default palette: Trad (black/white) for maximum contrast and readability.
const DEFAULT_PLAYER_COLORS: PlayerColorConfig = {
  blue: 'trad_black',
  yellow: 'trad_white',
}

const INTERNAL_LABEL: Record<PlayerColor, string> = {
  blue: 'Player 1',
  yellow: 'Player 2',
}

const BASE_SPACING = 1
const MAX_COORDINATE = (BASE_SIZE - 1) * BASE_SPACING
const TOKEN_INSET_PERCENT = 7.6
const MAX_BOARD_PIXELS = 760
const MIN_BOARD_PIXELS = 170

const MANUAL_ANIM_MS = 220
const AUTO_STEP_MS = 190
const MANUAL_SOUND_DELAY_MS = 170
const AUTO_SOUND_DELAY_MS = 145
const PLAYBACK_MANUAL_MS = 170
const PLAYBACK_AUTO_MS = 120
const PLAYBACK_GAP_MS = 70
const MOBILE_PANEL_MODE_KEY = 'mosaic.mobilePanelMode'
const APP_LANGUAGE_KEY = 'mosaic.language'
const ONLINE_HEARTBEAT_INTERVAL_MS = 5000
const ONLINE_HEARTBEAT_TIMEOUT_MS = 15000
const INITIAL_ONLINE_SESSION: OnlineSessionState = {
  phase: 'create',
  roomCode: '',
  roomInput: '',
  role: null,
  isHost: false,
  connectionState: 'idle',
  syncState: 'idle',
  errorMessage: '',
  waitMessage: '',
  createColors: { ...DEFAULT_PLAYER_COLORS },
}

export default function App() {
  const initialGame = useMemo(() => createInitialGameState(), [])
  const [language, setLanguage] = useState<AppLanguage>(() => {
    if (typeof window === 'undefined') {
      return 'en'
    }
    const saved = window.localStorage.getItem(APP_LANGUAGE_KEY)
    if (saved !== null) {
      return resolveLanguage(saved)
    }
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
      const browserLanguage = navigator.language.toLowerCase()
      if (browserLanguage.startsWith('ja')) {
        return 'ja'
      }
    }
    return 'en'
  })
  const [game, setGame] = useState(initialGame)
  const [displayRemaining, setDisplayRemaining] = useState(() => ({ ...initialGame.remaining }))
  const [boardSize, setBoardSize] = useState(() => {
    if (typeof window === 'undefined') {
      return 640
    }
    return Math.max(MIN_BOARD_PIXELS, Math.min(MAX_BOARD_PIXELS, window.innerWidth - 24))
  })

  const [setupOpen, setSetupOpen] = useState(true)
  const [setupStep, setSetupStep] = useState<SetupStep>('mode')
  const [playerColors, setPlayerColors] = useState<PlayerColorConfig>({ ...DEFAULT_PLAYER_COLORS })
  const [pendingColors, setPendingColors] = useState<PlayerColorConfig>({ ...DEFAULT_PLAYER_COLORS })
  const [matchMode, setMatchMode] = useState<MatchMode>('pvp')
  const [pendingMode, setPendingMode] = useState<MatchMode>('pvp')
  const [pendingOnlineAction, setPendingOnlineAction] = useState<OnlineEntryAction>(null)
  const [cpuMatchType, setCpuMatchType] = useState<CpuMatchType>('you_vs_cpu')
  const [pendingCpuMatchType, setPendingCpuMatchType] = useState<CpuMatchType>('you_vs_cpu')
  const [cpuDifficulty, setCpuDifficulty] = useState<CpuDifficulty>('easy')
  const [pendingCpuDifficulty, setPendingCpuDifficulty] = useState<CpuDifficulty>('easy')
  const [cpu1Difficulty, setCpu1Difficulty] = useState<CpuDifficulty>('easy')
  const [cpu2Difficulty, setCpu2Difficulty] = useState<CpuDifficulty>('easy')
  const [pendingCpu1Difficulty, setPendingCpu1Difficulty] = useState<CpuDifficulty>('easy')
  const [pendingCpu2Difficulty, setPendingCpu2Difficulty] = useState<CpuDifficulty>('easy')
  const [pendingCpuTurnOrder, setPendingCpuTurnOrder] = useState<CpuTurnOrder>('you_first')
  const [pendingHostTurnOrder, setPendingHostTurnOrder] = useState<HostTurnOrder>('host_first')
  const [onlineSession, setOnlineSession] = useState<OnlineSessionState>(INITIAL_ONLINE_SESSION)

  const [soundOn, setSoundOn] = useState(true)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isPlayback, setIsPlayback] = useState(false)
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus | null>(null)
  const [playbackRenderer, setPlaybackRenderer] = useState<BoardRendererMode | null>(null)
  const [playbackMoveCursor, setPlaybackMoveCursor] = useState(0)
  const [playbackTotalMoves, setPlaybackTotalMoves] = useState(0)
  const [winnerModalVisible, setWinnerModalVisible] = useState(false)
  const [chainBanners, setChainBanners] = useState<ChainBannerState[]>([])
  const [boardRenderer, setBoardRenderer] = useState<BoardRendererMode>('2d')
  const [isCpuThinking, setIsCpuThinking] = useState(false)
  const [hardDebugAnalysis, setHardDebugAnalysis] = useState<HardMoveAnalysis | null>(null)
  const [debugScoreComponents, setDebugScoreComponents] = useState<HardScoreComponentToggles>(() => ({
    ...DEFAULT_HARD_SCORE_COMPONENTS,
  }))
  const [isDebugHudCollapsed, setIsDebugHudCollapsed] = useState(true)
  const [debugOverlayMode, setDebugOverlayMode] = useState<DebugOverlayMode>('total')
  const [selectedDebugMoveKey, setSelectedDebugMoveKey] = useState<string | null>(null)
  const [hoveredDebugMoveKey, setHoveredDebugMoveKey] = useState<string | null>(null)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [recordNotice, setRecordNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [mobilePanelMode, setMobilePanelMode] = useState<MobilePanelMode>(() => {
    if (typeof window === 'undefined') {
      return 'standard'
    }
    const saved = window.localStorage.getItem(MOBILE_PANEL_MODE_KEY)
    if (saved === 'faceoff' || saved === 'standard') {
      return saved
    }
    return 'standard'
  })
  const [revealedAutoCount, setRevealedAutoCount] = useState(0)
  const [animatingKey, setAnimatingKey] = useState<string | null>(null)
  const [matchRecord, setMatchRecord] = useState<MatchRecord>({
    players: { ...DEFAULT_PLAYER_COLORS },
    moves: [],
    winner: null,
  })
  const [history, setHistory] = useState<UndoSnapshot[]>([
    {
      game: cloneGameState(initialGame),
      matchRecord: cloneMatchRecord({
        players: { ...DEFAULT_PLAYER_COLORS },
        moves: [],
        winner: null,
      }),
    },
  ])

  const boardStageRef = useRef<HTMLElement | null>(null)
  const mobileMenuRef = useRef<HTMLDivElement | null>(null)
  const recordFileInputRef = useRef<HTMLInputElement | null>(null)
  const timeoutIdsRef = useRef<number[]>([])
  const playbackTimerRef = useRef<number | null>(null)
  const playbackFramesRef = useRef<PlaybackFrame[]>([])
  const playbackMoveStartFrameIndicesRef = useRef<number[]>([])
  const playbackMoveEndFrameIndicesRef = useRef<number[]>([])
  const playbackFrameToMoveCursorRef = useRef<number[]>([])
  const playbackCursorRef = useRef(0)
  const playbackMoveCursorRef = useRef(0)
  const playbackOpeningTurnRef = useRef<PlayerColor>('blue')
  const playbackInitialGameRef = useRef<GameState | null>(null)
  const playbackInitialRemainingRef = useRef<Record<PlayerColor, number> | null>(null)
  const playbackFinalGameRef = useRef<GameState | null>(null)
  const playbackFinalRemainingRef = useRef<Record<PlayerColor, number> | null>(null)
  const playbackStatusRef = useRef<PlaybackStatus | null>(null)
  const cpuTimeoutRef = useRef<number | null>(null)
  const chainBannerTimeoutIdsRef = useRef<number[]>([])
  const chainBannerSeqRef = useRef(0)
  const pendingCpuMoveRef = useRef<Move | null>(null)
  const onlineRoomUnsubRef = useRef<(() => void) | null>(null)
  const onlineLastMoveSignatureRef = useRef<string | null>(null)
  const onlineLeaveInFlightRef = useRef(false)
  const gameRef = useRef<GameState>(initialGame)
  const matchRecordRef = useRef<MatchRecord>({
    players: { ...DEFAULT_PLAYER_COLORS },
    moves: [],
    winner: null,
  })
  const historyRef = useRef<UndoSnapshot[]>([
    {
      game: cloneGameState(initialGame),
      matchRecord: cloneMatchRecord({
        players: { ...DEFAULT_PLAYER_COLORS },
        moves: [],
        winner: null,
      }),
    },
  ])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastWinnerRef = useRef<PlayerColor | null>(null)

  const colorById = useMemo(() => {
    const map = new Map<DisplayColorId, ColorOption>()
    for (const option of COLOR_OPTIONS) {
      map.set(option.id, option)
    }
    return map
  }, [])

  const blueTheme = colorById.get(playerColors.blue) ?? COLOR_OPTIONS[0]
  const yellowTheme = colorById.get(playerColors.yellow) ?? COLOR_OPTIONS[1]

  const themeStyle = {
    '--color-blue': blueTheme.hex,
    '--color-blue-soft': hexToRgba(blueTheme.hex, 0.26),
    '--color-yellow': yellowTheme.hex,
    '--color-yellow-soft': hexToRgba(yellowTheme.hex, 0.26),
  } as CSSProperties
  const pieceColorMap = useMemo(
    () => ({
      blue: blueTheme.hex,
      yellow: yellowTheme.hex,
      neutral: '#8f9aae',
    }),
    [blueTheme.hex, yellowTheme.hex],
  )
  const leftRemaining = displayRemaining.yellow
  const rightRemaining = displayRemaining.blue
  const totalRemaining = leftRemaining + rightRemaining
  const leftPercent = totalRemaining > 0 ? Math.round((rightRemaining / totalRemaining) * 100) : 50
  const rightPercent = 100 - leftPercent
  const selectedColorTheme = useMemo(() => getThemeByAssignedColors(pendingColors), [pendingColors])
  const debugMode = useMemo(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return new URLSearchParams(window.location.search).get('debug') === '1'
  }, [])
  const t = (key: string): string => translate(language, key)
  const nextTurnNumber = getNextTurnNumber(isPlayback, playbackMoveCursor, playbackTotalMoves, matchRecord.moves.length)
  const turnBadgeLabel = language === 'ja' ? `${nextTurnNumber}${t('status.moveSuffix')}` : `${t('status.turn')} ${nextTurnNumber}`
  const playbackTurnPlayer = getPlaybackTurnPlayer(playbackOpeningTurnRef.current, playbackMoveCursor)
  const displayTurnPlayer: PlayerColor = isPlayback ? playbackTurnPlayer : game.currentTurn
  const isOnlineMode = matchMode === 'online'
  const isOnlineMyTurn = isOnlineMode && onlineSession.role === game.currentTurn
  const shouldWarnOnlineLeave =
    isOnlineMode && (onlineSession.phase === 'waiting' || onlineSession.phase === 'playing')
  const isOnlineMockView =
    !setupOpen && isOnlineMode && onlineSession.phase !== 'playing' && onlineSession.phase !== 'finished'
  const showHardDebugOverlay =
    debugMode &&
    !setupOpen &&
    matchMode === 'cpu' &&
    cpuMatchType === 'you_vs_cpu' &&
    cpuDifficulty === 'hard' &&
    !isPlayback
  const suppressDeeperCpuLegalIndicators =
    matchMode === 'cpu' &&
    cpuMatchType === 'you_vs_cpu' &&
    isCpuThinking &&
    !setupOpen &&
    !isAnimating &&
    !isPlayback &&
    !game.winner
  const showCpuThinkingOverlay =
    matchMode === 'cpu' &&
    cpuMatchType === 'you_vs_cpu' &&
    isCpuThinking &&
    !setupOpen &&
    !game.winner
  const playbackAtStart = playbackMoveCursor <= 0
  const playbackAtEnd = playbackMoveCursor >= playbackTotalMoves

  const legalSet = useMemo(() => {
    if (game.winner) {
      return new Set<string>()
    }
    return new Set(getLegalMoves(game).map((move) => toMoveKey(move.level, move.row, move.col)))
  }, [game])

  const hiddenAutoKeySet = useMemo(() => {
    if (!isAnimating) {
      return new Set<string>()
    }

    return new Set(
      game.lastAutoPlacements.slice(revealedAutoCount).map((item) => toMoveKey(item.level, item.row, item.col)),
    )
  }, [game.lastAutoPlacements, isAnimating, revealedAutoCount])

  const hardDebugCandidates = useMemo(() => {
    if (!hardDebugAnalysis) {
      return []
    }

    const selectedKey = toMoveKey(
      hardDebugAnalysis.selected.level,
      hardDebugAnalysis.selected.row,
      hardDebugAnalysis.selected.col,
    )
    const rescored = hardDebugAnalysis.candidates
      .map((item) => {
        const moveKey = toMoveKey(item.move.level, item.move.row, item.move.col)
        return {
          ...item,
          score: computeHardScoreFromBreakdown(item.breakdown, debugScoreComponents),
          isSelected: moveKey === selectedKey,
        }
      })
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({
        ...item,
        rank: index + 1,
      }))

    return rescored
  }, [debugScoreComponents, hardDebugAnalysis])

  const hardDebugTopCandidates = useMemo(() => {
    return hardDebugCandidates.slice(0, 5)
  }, [hardDebugCandidates])

  const hardDebugSelectedCandidate = useMemo(() => {
    if (!hardDebugCandidates.length) {
      return null
    }
    if (selectedDebugMoveKey) {
      const selected = hardDebugCandidates.find(
        (item) => toMoveKey(item.move.level, item.move.row, item.move.col) === selectedDebugMoveKey,
      )
      if (selected) {
        return selected
      }
    }
    return hardDebugCandidates.find((item) => item.isSelected) ?? hardDebugCandidates[0] ?? null
  }, [hardDebugCandidates, selectedDebugMoveKey])

  const hardDebugHoveredCandidate = useMemo(() => {
    if (!hardDebugCandidates.length || !hoveredDebugMoveKey) {
      return null
    }
    return (
      hardDebugCandidates.find(
        (item) => toMoveKey(item.move.level, item.move.row, item.move.col) === hoveredDebugMoveKey,
      ) ?? null
    )
  }, [hardDebugCandidates, hoveredDebugMoveKey])

  const hardDebugDetailCandidate = useMemo<HardMoveCandidate | null>(() => {
    return hardDebugHoveredCandidate ?? hardDebugSelectedCandidate
  }, [hardDebugHoveredCandidate, hardDebugSelectedCandidate])

  const hardDebugComponentValueByKey = useMemo<Record<HardScoreComponentKey, number> | null>(() => {
    if (!hardDebugDetailCandidate) {
      return null
    }
    const b = hardDebugDetailCandidate.breakdown
    return {
      immediateValue: b.immediateValue,
      patternGrowth: b.patternGrowth,
      urgentThreatBlock: b.urgentThreatBlock,
      opponentReplyRisk: -b.opponentReplyRisk,
      selfReservedCompletionPenalty: -b.selfReservedCompletionPenalty,
      chainBackfirePenalty: -b.chainBackfirePenalty,
      endgameAdjustment: b.endgameAdjustment,
    }
  }, [hardDebugDetailCandidate])

  const debugComponentsByCategory = useMemo(() => {
    const grouped = new Map<DebugScoreCategoryKey, DebugScoreComponentDefinition[]>()
    for (const category of DEBUG_SCORE_CATEGORIES) {
      grouped.set(category.key, [])
    }
    for (const item of DEBUG_SCORE_COMPONENTS) {
      grouped.get(item.category)?.push(item)
    }
    return grouped
  }, [])

  const debugOverlayModeLabel = useMemo(() => {
    if (debugOverlayMode === 'total') {
      return 'Total'
    }
    if (debugOverlayMode === 'immediateValue') {
      return 'Immediate (base)'
    }
    return DEBUG_SCORE_COMPONENTS.find((item) => item.key === debugOverlayMode)?.label ?? 'Total'
  }, [debugOverlayMode])

  const debugHeatmapModeLabel = useMemo(() => {
    return debugOverlayMode === 'total' ? 'absolute' : 'relative'
  }, [debugOverlayMode])

  const hardDebugOverlayMap = useMemo(() => {
    const map = new Map<string, { value: number; text: string; style: CSSProperties }>()
    if (!hardDebugCandidates.length) {
      return { map }
    }

    const rawValues = hardDebugCandidates.map((candidate) => {
      const value = getDebugOverlayMetricValue(candidate, debugOverlayMode)
      return {
        key: toMoveKey(candidate.move.level, candidate.move.row, candidate.move.col),
        value,
      }
    })

    if (debugOverlayMode === 'total') {
      for (const entry of rawValues) {
        map.set(entry.key, {
          value: entry.value,
          text: Math.round(entry.value).toString(),
          style: {},
        })
      }
      return { map }
    }

    const sorted = rawValues.map((item) => item.value).sort((a, b) => a - b)
    const lowerIndex = Math.max(0, Math.floor((sorted.length - 1) * 0.1))
    const upperIndex = Math.max(0, Math.floor((sorted.length - 1) * 0.9))
    let lower = sorted[lowerIndex] ?? 0
    let upper = sorted[upperIndex] ?? 0

    if (upper - lower < 1e-6) {
      lower = sorted[0] ?? 0
      upper = sorted[sorted.length - 1] ?? 0
    }

    const spread = upper - lower

    for (const entry of rawValues) {
      const clipped = spread < 1e-6 ? 0 : Math.max(lower, Math.min(upper, entry.value))
      const normalized01 = spread < 1e-6 ? 0.5 : (clipped - lower) / spread
      const relative = normalized01 * 2 - 1
      const intensity = Math.sqrt(Math.abs(relative))
      let background = 'rgba(255, 255, 255, 0.84)'
      let border = 'rgba(170, 180, 198, 0.72)'
      let color = '#1f365f'

      if (Math.abs(relative) >= 0.03) {
        const alpha = 0.16 + intensity * 0.6
        if (relative > 0) {
          background = `rgba(44, 176, 102, ${alpha.toFixed(3)})`
          border = `rgba(29, 126, 71, ${(0.38 + intensity * 0.46).toFixed(3)})`
          color = '#0f2f20'
        } else {
          background = `rgba(232, 77, 86, ${alpha.toFixed(3)})`
          border = `rgba(159, 30, 47, ${(0.38 + intensity * 0.46).toFixed(3)})`
          color = '#4a0f1a'
        }
      }

      map.set(entry.key, {
        value: entry.value,
        text: entry.value.toFixed(1),
        style: {
          backgroundColor: background,
          borderColor: border,
          color,
        },
      })
    }

    return { map }
  }, [debugOverlayMode, hardDebugCandidates])

  const hardDebugCandidateMap = useMemo(() => {
    const map = new Map<string, HardMoveCandidate>()
    if (!showHardDebugOverlay || !hardDebugCandidates.length) {
      return map
    }
    for (const item of hardDebugCandidates) {
      map.set(toMoveKey(item.move.level, item.move.row, item.move.col), item)
    }
    return map
  }, [hardDebugCandidates, showHardDebugOverlay])

  useEffect(() => {
    if (!hardDebugAnalysis) {
      setSelectedDebugMoveKey(null)
      setHoveredDebugMoveKey(null)
      return
    }
    const selected = hardDebugAnalysis.candidates.find((item) => item.isSelected) ?? hardDebugAnalysis.candidates[0]
    if (selected) {
      setSelectedDebugMoveKey(toMoveKey(selected.move.level, selected.move.row, selected.move.col))
    } else {
      setSelectedDebugMoveKey(null)
    }
    setHoveredDebugMoveKey(null)
  }, [hardDebugAnalysis])

  useEffect(() => {
    if (!showHardDebugOverlay) {
      setIsDebugHudCollapsed(true)
    }
  }, [showHardDebugOverlay])

  useEffect(() => {
    const stage = boardStageRef.current
    if (!stage) {
      return
    }

    const updateBoardSize = () => {
      const rect = stage.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth
      const mobileHorizontalPadding = 12
      const faceoffOffset = mobilePanelMode === 'faceoff' && viewportWidth <= 979 ? 24 : 0
      const availableWidth = Math.min(stage.clientWidth - faceoffOffset, viewportWidth - mobileHorizontalPadding)
      const availableHeight = window.innerHeight - rect.top - 16
      const next = Math.floor(Math.max(MIN_BOARD_PIXELS, Math.min(availableWidth, availableHeight, MAX_BOARD_PIXELS)))
      setBoardSize(next)
    }

    updateBoardSize()

    const resizeObserver = new ResizeObserver(updateBoardSize)
    resizeObserver.observe(stage)
    window.addEventListener('resize', updateBoardSize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateBoardSize)
    }
  }, [isOnlineMockView, setupOpen, mobilePanelMode])

  useEffect(() => {
    return () => {
      clearAnimationTimers()
      clearPlaybackTimer()
      clearCpuTimer()
      clearChainBannerTimers()
      stopOnlineRoomSubscription()
      audioCtxRef.current?.close().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!setupOpen) {
      return
    }
    clearChainBannerTimers()
    setChainBanners([])
  }, [setupOpen])

  useEffect(() => {
    clearCpuTimer()
    pendingCpuMoveRef.current = null
    const actor = game.currentTurn
    const isCpuTurn =
      matchMode === 'cpu' &&
      (cpuMatchType === 'cpu_vs_cpu' || actor === 'yellow')

    const currentCpuDifficulty: CpuDifficulty =
      cpuMatchType === 'cpu_vs_cpu'
        ? actor === 'blue'
          ? cpu1Difficulty
          : cpu2Difficulty
        : cpuDifficulty
    if (
      setupOpen ||
      isAnimating ||
      isPlayback ||
      game.winner ||
      !isCpuTurn
    ) {
      setIsCpuThinking(false)
      return
    }

    setIsCpuThinking(true)

    if (debugMode && cpuMatchType === 'you_vs_cpu' && actor === 'yellow' && currentCpuDifficulty === 'hard') {
      const analyzed = chooseCpuMoveWithAnalysis(game, actor, 'hard', {
        enabledComponents: debugScoreComponents,
      })
      pendingCpuMoveRef.current = analyzed.move
      setHardDebugAnalysis(analyzed.analysis)
    } else {
      setHardDebugAnalysis(null)
    }

    const delayMs = 700 + Math.floor(Math.random() * 301)
    cpuTimeoutRef.current = window.setTimeout(() => {
      setIsCpuThinking(false)
      const cpuMove = pendingCpuMoveRef.current ?? chooseCpuMove(game, actor, currentCpuDifficulty)
      pendingCpuMoveRef.current = null
      if (!cpuMove) {
        return
      }
      commitMoveByMode(cpuMove.level, cpuMove.row, cpuMove.col)
    }, delayMs)

    return () => {
      clearCpuTimer()
    }
  }, [
    cpu1Difficulty,
    cpu2Difficulty,
    cpuDifficulty,
    cpuMatchType,
    debugMode,
    debugScoreComponents,
    game,
    isAnimating,
    isPlayback,
    matchMode,
    setupOpen,
  ])

  useEffect(() => {
    if (!winnerModalVisible || !game.winner || game.winner === lastWinnerRef.current) {
      return
    }
    lastWinnerRef.current = game.winner
    playWinnerSound()
  }, [game.winner, winnerModalVisible])

  useEffect(() => {
    gameRef.current = game
  }, [game])

  useEffect(() => {
    matchRecordRef.current = matchRecord
  }, [matchRecord])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    playbackStatusRef.current = playbackStatus
  }, [playbackStatus])

  useEffect(() => {
    if (!shouldWarnOnlineLeave) {
      return
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [shouldWarnOnlineLeave])

  useEffect(() => {
    const roomCode = onlineSession.roomCode
    const role = onlineSession.role
    if (!shouldWarnOnlineLeave || !roomCode || !role) {
      return
    }

    let active = true
    const runHeartbeat = () => {
      if (!active) {
        return
      }
      updateRoomHeartbeat(roomCode, role).catch(() => undefined)
    }

    runHeartbeat()
    const intervalId = window.setInterval(runHeartbeat, ONLINE_HEARTBEAT_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [shouldWarnOnlineLeave, onlineSession.roomCode, onlineSession.role])

  useEffect(() => {
    if (isOnlineMode && !setupOpen && game.winner) {
      setOnlineSession((prev) => ({ ...prev, phase: 'finished' }))
    }
  }, [game.winner, isOnlineMode, setupOpen])

  useEffect(() => {
    if (!isAnimating && !isPlayback) {
      setDisplayRemaining({ ...game.remaining })
    }
  }, [game.remaining, isAnimating, isPlayback])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(MOBILE_PANEL_MODE_KEY, mobilePanelMode)
  }, [mobilePanelMode])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(APP_LANGUAGE_KEY, language)
    document.title = t('app.title')
  }, [language])

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || !mobileMenuRef.current) {
        return
      }
      if (!mobileMenuRef.current.contains(target)) {
        setIsMobileMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [isMobileMenuOpen])

  useEffect(() => {
    if (!recordNotice) {
      return
    }
    const timeoutId = window.setTimeout(() => setRecordNotice(null), 2200)
    return () => window.clearTimeout(timeoutId)
  }, [recordNotice])

  const positions = useMemo(() => {
    const cells: Array<{
      level: number
      row: number
      col: number
      key: string
      left: number
      top: number
      legal: boolean
      pieceColor: 'blue' | 'yellow' | 'neutral' | null
      isLastMove: boolean
      isAnimatingSpawn: boolean
    }> = []

    for (let level = 0; level <= MAX_LEVEL; level += 1) {
      const size = getLevelSize(level)
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          const key = toMoveKey(level, row, col)
          const x = col * BASE_SPACING + level * (BASE_SPACING / 2)
          const y = row * BASE_SPACING + level * (BASE_SPACING / 2)
          const piece = getPiece(game.board, level, row, col)
          const normalizedX = x / MAX_COORDINATE
          const normalizedY = y / MAX_COORDINATE
          const left = TOKEN_INSET_PERCENT + normalizedX * (100 - TOKEN_INSET_PERCENT * 2)
          const top = TOKEN_INSET_PERCENT + normalizedY * (100 - TOKEN_INSET_PERCENT * 2)
          const hiddenAuto = hiddenAutoKeySet.has(key)

          cells.push({
            level,
            row,
            col,
            key,
            left,
            top,
            legal: legalSet.has(key),
            pieceColor: hiddenAuto ? null : piece?.color ?? null,
            isLastMove: game.lastMove?.level === level && game.lastMove?.row === row && game.lastMove?.col === col,
            isAnimatingSpawn: animatingKey === key,
          })
        }
      }
    }

    return cells
  }, [game.board, game.lastMove, legalSet, hiddenAutoKeySet, animatingKey])

  function commitResolvedMove(
    level: number,
    row: number,
    col: number,
    actor: PlayerColor,
    nextState: ReturnType<typeof placeManualPiece>,
  ): void {
    const moveRecord: MoveRecord = {
      turn: matchRecord.moves.length + 1,
      player: actor,
      manual: { level, row, col },
      autoPlacements: nextState.lastAutoPlacements,
    }

    const nextRecord: MatchRecord = {
      ...matchRecord,
      moves: [...matchRecord.moves, moveRecord],
      winner: nextState.winner,
    }

    setMatchRecord(nextRecord)
    setHistory((prev) => [...prev, { game: cloneGameState(nextState), matchRecord: cloneMatchRecord(nextRecord) }])
    playMoveSequence(nextState, game.remaining)
  }

  function showChainBanner(chainCount: number, anchorMoves: Move[]): void {
    if (chainCount < 3 || isPlayback || game.winner) {
      return
    }
    chainBannerSeqRef.current += 1
    const bannerId = chainBannerSeqRef.current
    const anchor = resolveChainAnchorPosition(anchorMoves)
    setChainBanners((prev) => [
      ...prev,
      {
        id: bannerId,
        count: chainCount,
        tone: resolveChainTone(chainCount),
        left: anchor.left,
        top: anchor.top,
      },
    ])
    const timeoutId = window.setTimeout(() => {
      setChainBanners((prev) => prev.filter((item) => item.id !== bannerId))
      chainBannerTimeoutIdsRef.current = chainBannerTimeoutIdsRef.current.filter((id) => id !== timeoutId)
    }, 640)
    chainBannerTimeoutIdsRef.current.push(timeoutId)
  }

  function handleLocalMoveCommit(level: number, row: number, col: number): void {
    const actor = game.currentTurn
    if (debugMode && matchMode === 'cpu' && actor === 'blue') {
      setHardDebugAnalysis(null)
    }
    const nextState = placeManualPiece(game, level, row, col)
    commitResolvedMove(level, row, col, actor, nextState)
  }

  function canSubmitOnlineMove(): boolean {
    return (
      matchMode === 'online' &&
      onlineSession.phase === 'playing' &&
      onlineSession.connectionState === 'connected' &&
      onlineSession.syncState === 'idle' &&
      Boolean(onlineSession.roomCode) &&
      onlineSession.role === game.currentTurn
    )
  }

  async function handleOnlineMoveRequest(level: number, row: number, col: number): Promise<void> {
    if (!canSubmitOnlineMove()) {
      return
    }
    const actor = onlineSession.role
    if (!actor) {
      return
    }

    setOnlineSession((prev) => ({
      ...prev,
      syncState: 'submitting',
      errorMessage: '',
    }))

    try {
      await submitRoomMove(onlineSession.roomCode, actor, { level, row, col })
    } catch (error) {
      setOnlineSession((prev) => ({
        ...prev,
        syncState: 'idle',
        errorMessage: mapRoomErrorMessage(error, t('online.failedSubmitMove')),
      }))
    }
  }

  function commitMoveByMode(level: number, row: number, col: number): void {
    clearCpuTimer()
    setIsCpuThinking(false)

    if (setupOpen || isAnimating || isPlayback || game.winner) {
      return
    }

    const key = toMoveKey(level, row, col)
    if (!legalSet.has(key)) {
      return
    }

    if (matchMode === 'online') {
      void handleOnlineMoveRequest(level, row, col)
      return
    }
    handleLocalMoveCommit(level, row, col)
  }

  function onCellClick(level: number, row: number, col: number): void {
    if (setupOpen || isAnimating || isPlayback || isCpuThinking) {
      return
    }
    if (matchMode === 'online' && onlineSession.phase !== 'playing') {
      return
    }
    if (matchMode === 'cpu' && (cpuMatchType === 'cpu_vs_cpu' || game.currentTurn === 'yellow')) {
      return
    }
    commitMoveByMode(level, row, col)
  }

  function playMoveSequence(
    nextState: ReturnType<typeof placeManualPiece>,
    startRemaining: Record<PlayerColor, number>,
  ): void {
    startResolvedAnimation(nextState, startRemaining, MANUAL_ANIM_MS, AUTO_STEP_MS)
  }

  function startResolvedAnimation(
    nextState: ReturnType<typeof placeManualPiece>,
    startRemaining: Record<PlayerColor, number>,
    manualAnimMs: number,
    autoStepMs: number,
    onComplete?: () => void,
  ): void {
    clearAnimationTimers()
    setWinnerModalVisible(false)
    setGame(nextState)
    setDisplayRemaining({ ...startRemaining })

    const manual = nextState.lastMove
    if (!manual) {
      setIsAnimating(false)
      setAnimatingKey(null)
      setRevealedAutoCount(nextState.lastAutoPlacements.length)
      setDisplayRemaining({ ...nextState.remaining })
      if (nextState.winner && !isPlayback) {
        setWinnerModalVisible(true)
      }
      return
    }

    setIsAnimating(true)
    setRevealedAutoCount(0)

    const manualKey = toMoveKey(manual.level, manual.row, manual.col)
    setAnimatingKey(manualKey)
    const manualSoundId = window.setTimeout(() => {
      const actor = nextState.lastActor
      if (actor) {
        setDisplayRemaining((prev) => ({
          ...prev,
          [actor]: Math.max(0, prev[actor] - 1),
        }))
      }
      playManualSound()
    }, Math.max(70, Math.floor((manualAnimMs / MANUAL_ANIM_MS) * MANUAL_SOUND_DELAY_MS)))
    timeoutIdsRef.current.push(manualSoundId)

    const autoMoves = nextState.lastAutoPlacements
    if (autoMoves.length === 0) {
      const id = window.setTimeout(() => {
        setAnimatingKey(null)
        setIsAnimating(false)
        setDisplayRemaining({ ...nextState.remaining })
        if (nextState.winner && !isPlayback) {
          setWinnerModalVisible(true)
        }
        onComplete?.()
      }, manualAnimMs)
      timeoutIdsRef.current.push(id)
      return
    }

    const startAutoId = window.setTimeout(() => {
      autoMoves.forEach((move, index) => {
        const stepId = window.setTimeout(() => {
          setRevealedAutoCount(index + 1)
          setAnimatingKey(toMoveKey(move.level, move.row, move.col))
          // Chain count is based on progression steps, not board level.
          // manual move = chain 1, first auto placement = chain 2, ...
          const stepChainCount = index + 2
          if (!isPlayback && stepChainCount >= 3) {
            showChainBanner(stepChainCount, [move])
          }
          const autoSoundId = window.setTimeout(() => {
            setDisplayRemaining((prev) => ({
              ...prev,
              [move.color]: Math.max(0, prev[move.color] - 1),
            }))
            playAutoSound(index)
          }, Math.max(45, Math.floor((autoStepMs / AUTO_STEP_MS) * AUTO_SOUND_DELAY_MS)))
          timeoutIdsRef.current.push(autoSoundId)

          if (index === autoMoves.length - 1) {
            const finishId = window.setTimeout(() => {
              setAnimatingKey(null)
              setIsAnimating(false)
              setDisplayRemaining({ ...nextState.remaining })
              if (nextState.winner && !isPlayback) {
                setWinnerModalVisible(true)
              }
              onComplete?.()
            }, autoStepMs)
            timeoutIdsRef.current.push(finishId)
          }
        }, index * autoStepMs)
        timeoutIdsRef.current.push(stepId)
      })
    }, manualAnimMs)

    timeoutIdsRef.current.push(startAutoId)
  }

  function clearAnimationTimers(): void {
    timeoutIdsRef.current.forEach((id) => window.clearTimeout(id))
    timeoutIdsRef.current = []
  }

  function clearCpuTimer(): void {
    if (cpuTimeoutRef.current !== null) {
      window.clearTimeout(cpuTimeoutRef.current)
      cpuTimeoutRef.current = null
    }
  }

  function clearChainBannerTimers(): void {
    chainBannerTimeoutIdsRef.current.forEach((id) => window.clearTimeout(id))
    chainBannerTimeoutIdsRef.current = []
  }

  function stopOnlineRoomSubscription(): void {
    if (onlineRoomUnsubRef.current) {
      onlineRoomUnsubRef.current()
      onlineRoomUnsubRef.current = null
    }
  }

  function resetOnlineSessionState(): void {
    stopOnlineRoomSubscription()
    onlineLastMoveSignatureRef.current = null
    setOnlineSession({
      ...INITIAL_ONLINE_SESSION,
      createColors: { ...playerColors },
    })
  }

  function mapRoomErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof RoomError) {
      return error.message
    }
    if (error instanceof Error && error.message) {
      return error.message
    }
    return fallback
  }

  function getTimestampMs(value: unknown): number | null {
    if (!value) {
      return null
    }
    if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
      return (value as { toMillis: () => number }).toMillis()
    }
    if (typeof value === 'object' && value !== null && 'seconds' in value && typeof (value as { seconds: unknown }).seconds === 'number') {
      return (value as { seconds: number }).seconds * 1000
    }
    return null
  }

  function isOpponentTimedOut(room: RoomDoc, myRole: PlayerColor): boolean {
    const opponentKey = myRole === 'blue' ? 'player2' : 'player1'
    const opponent = room.players[opponentKey]
    if (!opponent?.joined || opponent.status === 'left') {
      return false
    }
    const lastSeenMs = getTimestampMs(opponent.lastSeenAt)
    if (!lastSeenMs) {
      return false
    }
    return Date.now() - lastSeenMs >= ONLINE_HEARTBEAT_TIMEOUT_MS
  }

  async function leaveOnlineRoomExplicitly(): Promise<void> {
    const roomCode = onlineSession.roomCode
    const role = onlineSession.role
    if (onlineLeaveInFlightRef.current) {
      return
    }
    if (!shouldWarnOnlineLeave || !roomCode || !role) {
      return
    }

    onlineLeaveInFlightRef.current = true
    try {
      await markPlayerLeft(roomCode, role)
    } catch {
      // no-op: keep navigation possible even if leave update fails
    } finally {
      onlineLeaveInFlightRef.current = false
    }
  }

  function confirmLeaveOnlineIfNeeded(): boolean {
    if (!shouldWarnOnlineLeave) {
      return true
    }
    return window.confirm(`${t('confirm.leaveOnlineTitle')}\n${t('confirm.leaveOnlineBody')}`)
  }

  function hasBoardChanged(prev: GameState, next: GameState): boolean {
    for (let level = 0; level < prev.board.length; level += 1) {
      const prevRows = prev.board[level]
      const nextRows = next.board[level]
      for (let row = 0; row < prevRows.length; row += 1) {
        const prevCols = prevRows[row]
        const nextCols = nextRows[row]
        for (let col = 0; col < prevCols.length; col += 1) {
          const a = prevCols[col]
          const b = nextCols[col]
          if (!a && !b) {
            continue
          }
          if (!a || !b) {
            return true
          }
          if (a.color !== b.color || a.source !== b.source) {
            return true
          }
        }
      }
    }
    return false
  }

  function buildMoveSignature(state: GameState): string | null {
    if (!state.lastMove || !state.lastActor) {
      return null
    }
    const m = state.lastMove
    return JSON.stringify({
      actor: state.lastActor,
      move: [m.level, m.row, m.col],
      auto: state.lastAutoPlacements.map((item) => [item.level, item.row, item.col, item.color]),
      turn: state.currentTurn,
      remaining: state.remaining,
      winner: state.winner,
    })
  }

  function appendOnlineMoveRecordFromSnapshot(nextGame: GameState, prevRemaining: Record<PlayerColor, number>): void {
    if (!nextGame.lastMove || !nextGame.lastActor) {
      return
    }

    const signature = buildMoveSignature(nextGame)
    if (!signature || onlineLastMoveSignatureRef.current === signature) {
      return
    }
    onlineLastMoveSignatureRef.current = signature

    const currentRecord = matchRecordRef.current
    const moveRecord: MoveRecord = {
      turn: currentRecord.moves.length + 1,
      player: nextGame.lastActor,
      manual: { ...nextGame.lastMove },
      autoPlacements: nextGame.lastAutoPlacements.map((item) => ({ ...item })),
    }
    const nextRecord: MatchRecord = {
      ...currentRecord,
      moves: [...currentRecord.moves, moveRecord],
      winner: nextGame.winner,
    }

    setMatchRecord(nextRecord)
    setHistory((prevHistory) => [
      ...prevHistory,
      { game: cloneGameState(nextGame), matchRecord: cloneMatchRecord(nextRecord) },
    ])
    startResolvedAnimation(nextGame, prevRemaining, MANUAL_ANIM_MS, AUTO_STEP_MS)
  }

  function applyRoomSnapshot(room: RoomDoc): void {
    const nextGame = deserializeGameState(room.boardState)
    const prevGame = gameRef.current
    const boardChanged = hasBoardChanged(prevGame, nextGame)
    const nextRoomColors: PlayerColorConfig = {
      blue: isDisplayColorId(room.playerColors?.blue) ? room.playerColors.blue : DEFAULT_PLAYER_COLORS.blue,
      yellow: isDisplayColorId(room.playerColors?.yellow) ? room.playerColors.yellow : DEFAULT_PLAYER_COLORS.yellow,
    }

    setPlayerColors(nextRoomColors)
    if (boardChanged && nextGame.lastMove && !isPlayback) {
      appendOnlineMoveRecordFromSnapshot(nextGame, prevGame.remaining)
    } else {
      setGame(nextGame)
      setDisplayRemaining({ ...nextGame.remaining })
      setWinnerModalVisible(Boolean(nextGame.winner))
    }
    setOnlineSession((prev) => {
      let nextPhase: OnlinePhase = prev.phase
      let nextWaitMessage =
        room.status === 'waiting'
          ? t('online.waitingForOpponent')
          : room.status === 'playing'
            ? t('online.matchInProgress')
            : t('online.matchFinished')
      let nextConnectionState: OnlineConnectionState = room.status === 'waiting' ? 'waiting' : 'connected'

      const myRole = prev.role
      if (myRole) {
        const opponentKey = myRole === 'blue' ? 'player2' : 'player1'
        const opponent = room.players[opponentKey]
        const opponentLeft = opponent?.status === 'left'
        const opponentTimeout = isOpponentTimedOut(room, myRole)

        if (room.status === 'playing' && (opponentLeft || opponentTimeout)) {
          nextPhase = 'interrupted'
          nextConnectionState = 'disconnected'
          nextWaitMessage = opponentLeft ? t('online.opponentLeftMatch') : t('online.opponentDisconnected')
        } else if (room.status === 'waiting' && (opponentLeft || opponentTimeout)) {
          if (myRole === 'yellow') {
            nextPhase = 'closed'
            nextConnectionState = 'disconnected'
            nextWaitMessage = opponentLeft ? t('online.hostLeftRoom') : t('online.hostDisconnected')
          } else {
            nextPhase = 'waiting'
            nextConnectionState = 'waiting'
            nextWaitMessage = opponentLeft ? t('online.opponentLeftWaiting') : t('online.opponentDisconnectedWaiting')
          }
        }
      }

      if (room.status === 'finished') {
        nextPhase = 'finished'
        nextConnectionState = 'connected'
        nextWaitMessage = t('online.matchFinished')
      } else if (room.status === 'playing') {
        if (nextPhase !== 'interrupted') {
          nextPhase = 'playing'
        }
      } else if (room.status === 'waiting' && prev.phase !== 'create') {
        if (nextPhase !== 'closed') {
          nextPhase = 'waiting'
        }
      }

      return {
        ...prev,
        roomCode: room.roomCode,
        phase: nextPhase,
        connectionState: nextConnectionState,
        waitMessage: nextWaitMessage,
        errorMessage: '',
        syncState: 'idle',
        createColors: nextRoomColors,
      }
    })
  }

  function startOnlineRoomSubscription(roomCode: string): void {
    stopOnlineRoomSubscription()
    onlineRoomUnsubRef.current = subscribeRoom(
      roomCode,
      (room) => {
        if (!room) {
          setOnlineSession((prev) => ({
            ...prev,
            phase: 'error',
            connectionState: 'disconnected',
            errorMessage: t('online.roomNoLongerExists'),
            syncState: 'idle',
          }))
          return
        }
        applyRoomSnapshot(room)
      },
      (error) => {
        setOnlineSession((prev) => ({
          ...prev,
          phase: 'error',
          connectionState: 'disconnected',
          errorMessage: mapRoomErrorMessage(error, t('online.failedSubscribeRoom')),
          syncState: 'idle',
        }))
      },
    )
  }

  async function submitOnlineCreateFromSetup(): Promise<void> {
    if (!isFirebaseConfigured()) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'error',
        connectionState: 'disconnected',
        errorMessage: t('online.firebaseConfigMissing'),
      }))
      return
    }

    if (pendingColors.blue === pendingColors.yellow) {
      return
    }

    const hostStarts = pendingHostTurnOrder === 'host_first'
    const openingTurn: PlayerColor = hostStarts ? 'blue' : 'yellow'
    prepareFreshMatch(pendingColors, 'online', openingTurn)
    setSetupOpen(false)
    setSetupStep('mode')
    setPendingOnlineAction(null)
    setOnlineSession((prev) => ({
      ...prev,
      phase: 'waiting',
      roomCode: '',
      roomInput: '',
      role: 'blue',
      isHost: true,
      connectionState: 'connecting',
      syncState: 'idle',
      errorMessage: '',
      waitMessage: t('online.creatingRoom'),
      createColors: { ...pendingColors },
    }))

    try {
      const { roomCode } = await createRoom({
        blue: pendingColors.blue,
        yellow: pendingColors.yellow,
      }, hostStarts)
      startOnlineRoomSubscription(roomCode)
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'waiting',
        roomCode,
        role: 'blue',
        isHost: true,
        connectionState: 'waiting',
        waitMessage: t('online.waitingForOpponent'),
        errorMessage: '',
      }))
    } catch (error) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'error',
        connectionState: 'disconnected',
        errorMessage: mapRoomErrorMessage(error, t('online.failedCreateRoom')),
      }))
    }
  }

  function beginOnlineJoin(): void {
    setOnlineSession((prev) => ({
      ...prev,
      phase: 'join',
      roomCode: '',
      roomInput: '',
      role: 'yellow',
      isHost: false,
      connectionState: 'idle',
      syncState: 'idle',
      errorMessage: '',
      waitMessage: t('online.joinedWaitingForHost'),
    }))
  }

  async function confirmOnlineJoin(): Promise<void> {
    if (!isFirebaseConfigured()) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'error',
        connectionState: 'disconnected',
        errorMessage: t('online.firebaseConfigMissing'),
      }))
      return
    }

    const normalizedCode = normalizeRoomCode(onlineSession.roomInput)
    setOnlineSession((prev) => ({
      ...prev,
      phase: 'join',
      connectionState: 'connecting',
      errorMessage: '',
      syncState: 'idle',
    }))

    try {
      const { roomCode } = await joinRoom(normalizedCode)
      startOnlineRoomSubscription(roomCode)
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'waiting',
        roomCode,
        role: 'yellow',
        isHost: false,
        connectionState: 'waiting',
        errorMessage: '',
        waitMessage: t('online.joinedWaitingForMatch'),
      }))
    } catch (error) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'error',
        connectionState: 'disconnected',
        errorMessage: mapRoomErrorMessage(error, t('online.failedJoinRoom')),
      }))
    }
  }

  function openSetup(): boolean {
    if (!confirmLeaveOnlineIfNeeded()) {
      return false
    }
    if (shouldWarnOnlineLeave) {
      void leaveOnlineRoomExplicitly()
    }
    clearAnimationTimers()
    clearPlaybackTimer()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setPlaybackStatus(null)
    setPlaybackRenderer(null)
    setWinnerModalVisible(false)
    setIsCpuThinking(false)
    setHardDebugAnalysis(null)
    setDebugOverlayMode('total')
    setIsMobileMenuOpen(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    setDisplayRemaining({ ...game.remaining })
    setPendingColors(playerColors)
    setPendingMode(matchMode)
    setPendingOnlineAction(null)
    setPendingCpuMatchType(cpuMatchType)
    setPendingCpuDifficulty(cpuDifficulty)
    setPendingCpu1Difficulty(cpu1Difficulty)
    setPendingCpu2Difficulty(cpu2Difficulty)
    setBoardRenderer('2d')
    resetOnlineSessionState()
    setSetupStep('mode')
    setSetupOpen(true)
    return true
  }

  function openSetupForOnline(action: OnlineEntryAction): void {
    if (!openSetup()) {
      return
    }
    setPendingMode('online')
    setPendingOnlineAction(action)
  }

  function prepareFreshMatch(
    nextColors: PlayerColorConfig,
    nextMode: MatchMode,
    startingTurn: PlayerColor = 'blue',
  ): void {
    if (nextColors.blue === nextColors.yellow) {
      return
    }
    stopOnlineRoomSubscription()
    clearAnimationTimers()
    clearPlaybackTimer()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setPlaybackStatus(null)
    setPlaybackRenderer(null)
    setIsCpuThinking(false)
    setHardDebugAnalysis(null)
    setDebugOverlayMode('total')
    setIsMobileMenuOpen(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    lastWinnerRef.current = null
    setBoardRenderer('2d')
    setPlayerColors(nextColors)
    setMatchMode(nextMode)
    setCpuMatchType(pendingCpuMatchType)
    setCpuDifficulty(pendingCpuDifficulty)
    setCpu1Difficulty(pendingCpu1Difficulty)
    setCpu2Difficulty(pendingCpu2Difficulty)
    resetOnlineSessionState()
    const freshGame = createInitialGameState()
    freshGame.currentTurn = startingTurn
    freshGame.message = startingTurn === 'blue' ? "Player 1's turn" : "Player 2's turn"
    const freshRecord = {
      players: nextColors,
      moves: [],
      winner: null,
    } satisfies MatchRecord
    setGame(freshGame)
    setDisplayRemaining({ ...freshGame.remaining })
    setMatchRecord(freshRecord)
    setHistory([{ game: cloneGameState(freshGame), matchRecord: cloneMatchRecord(freshRecord) }])
    setWinnerModalVisible(false)
  }

  function proceedFromGameSetup(): void {
    if (pendingMode === 'online') {
      if (!pendingOnlineAction) {
        return
      }
      if (pendingOnlineAction === 'join') {
        prepareFreshMatch(playerColors, 'online')
        setSetupOpen(false)
        setSetupStep('mode')
        setOnlineSession({
          ...INITIAL_ONLINE_SESSION,
          createColors: { ...playerColors },
        })
        beginOnlineJoin()
        setPendingOnlineAction(null)
        return
      }
      setPendingColors(playerColors)
      setSetupStep('color')
      return
    }
    setPendingColors(playerColors)
    setSetupStep('color')
  }

  function startWithColorSetup(): void {
    if (pendingColors.blue === pendingColors.yellow) {
      return
    }
    if (pendingMode === 'online' && pendingOnlineAction === 'create') {
      void submitOnlineCreateFromSetup()
      return
    }
    const openingTurn: PlayerColor =
      pendingMode === 'cpu'
        ? pendingCpuMatchType === 'cpu_vs_cpu'
          ? 'blue'
          : pendingCpuTurnOrder === 'you_second'
            ? 'yellow'
            : 'blue'
        : 'blue'
    prepareFreshMatch(pendingColors, pendingMode, openingTurn)
    setSetupOpen(false)
    setSetupStep('mode')
    setPendingOnlineAction(null)
  }

  function clearPlaybackTimer(): void {
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current)
      playbackTimerRef.current = null
    }
  }

  function buildPlaybackFrames(baseRecord: MatchRecord): PlaybackBuildResult {
    const frames: PlaybackFrame[] = []
    const moveStartFrameIndices: number[] = []
    const moveEndFrameIndices: number[] = []
    const frameToMoveCursor: number[] = []
    let state = createInitialGameState()
    const openingTurn: PlayerColor = baseRecord.moves[0]?.player ?? 'blue'
    state.currentTurn = openingTurn
    state.message = openingTurn === 'blue' ? "Player 1's turn" : "Player 2's turn"
    const initialGame = cloneGameState(state)
    const initialRemaining = { ...state.remaining }

    for (const [moveIndex, record] of baseRecord.moves.entries()) {
      const moveStartFrameIndex = frames.length
      moveStartFrameIndices.push(moveStartFrameIndex)
      const resolved = placeManualPiece(state, record.manual.level, record.manual.row, record.manual.col)
      const manualState = cloneGameState(resolved)
      for (const placement of record.autoPlacements) {
        manualState.board[placement.level][placement.row][placement.col] = null
      }
      manualState.winner = null

      const manualRemaining = { ...state.remaining }
      manualRemaining[record.player] = Math.max(0, manualRemaining[record.player] - 1)
      frames.push({
        game: manualState,
        remaining: manualRemaining,
        animatingKey: toMoveKey(record.manual.level, record.manual.row, record.manual.col),
        revealedAutoCount: 0,
        sound: 'manual',
        autoChainIndex: 0,
        delayMs: PLAYBACK_MANUAL_MS,
      })
      frameToMoveCursor.push(record.autoPlacements.length === 0 ? moveIndex + 1 : moveIndex)

      let chainRemaining = { ...manualRemaining }
      const chainState = cloneGameState(manualState)
      record.autoPlacements.forEach((auto, chainIndex) => {
        chainState.board[auto.level][auto.row][auto.col] = { color: auto.color, source: 'auto' }
        chainRemaining = {
          ...chainRemaining,
          [auto.color]: Math.max(0, chainRemaining[auto.color] - 1),
        }
        frames.push({
          game: cloneGameState(chainState),
          remaining: { ...chainRemaining },
          animatingKey: toMoveKey(auto.level, auto.row, auto.col),
          revealedAutoCount: chainIndex + 1,
          sound: 'auto',
          autoChainIndex: chainIndex,
          delayMs: PLAYBACK_AUTO_MS,
        })
        frameToMoveCursor.push(chainIndex === record.autoPlacements.length - 1 ? moveIndex + 1 : moveIndex)
      })
      moveEndFrameIndices.push(frames.length - 1)
      state = resolved
    }

    return {
      frames,
      moveStartFrameIndices,
      moveEndFrameIndices,
      frameToMoveCursor,
      initialGame,
      initialRemaining,
      finalGame: cloneGameState(state),
      finalRemaining: { ...state.remaining },
    }
  }

  function applyPlaybackFrame(frame: PlaybackFrame): void {
    setIsAnimating(true)
    setGame(cloneGameState(frame.game))
    setDisplayRemaining({ ...frame.remaining })
    setAnimatingKey(frame.animatingKey)
    setRevealedAutoCount(frame.revealedAutoCount)
    if (frame.sound === 'manual') {
      playManualSound()
    } else if (frame.sound === 'auto') {
      playAutoSound(frame.autoChainIndex)
    }
  }

  function applyPlaybackFrameSnapshot(frame: PlaybackFrame): void {
    setIsAnimating(false)
    setGame(cloneGameState(frame.game))
    setDisplayRemaining({ ...frame.remaining })
    setAnimatingKey(null)
    setRevealedAutoCount(frame.revealedAutoCount)
  }

  function setPlaybackMovePosition(nextMoveCursor: number): void {
    const totalMoves = playbackMoveEndFrameIndicesRef.current.length
    const clamped = clamp(nextMoveCursor, 0, totalMoves)
    const frames = playbackFramesRef.current

    if (clamped <= 0) {
      const initialGame = playbackInitialGameRef.current
      const initialRemaining = playbackInitialRemainingRef.current
      if (initialGame && initialRemaining) {
        setIsAnimating(false)
        setGame(cloneGameState(initialGame))
        setDisplayRemaining({ ...initialRemaining })
        setAnimatingKey(null)
        setRevealedAutoCount(0)
      }
    } else {
      const frameIndex = playbackMoveEndFrameIndicesRef.current[clamped - 1]
      const frame = frames[frameIndex]
      if (frame) {
        applyPlaybackFrameSnapshot(frame)
      }
    }

    playbackMoveCursorRef.current = clamped
    setPlaybackMoveCursor(clamped)
    if (clamped >= totalMoves) {
      playbackCursorRef.current = frames.length
      return
    }
    const nextFrameIndex = playbackMoveStartFrameIndicesRef.current[clamped] ?? frames.length
    playbackCursorRef.current = nextFrameIndex
  }

  function stopPlaybackAutoplayForManualStep(): void {
    if (playbackStatusRef.current !== 'playing') {
      return
    }
    clearPlaybackTimer()
    setPlaybackStatus('paused')
    playbackStatusRef.current = 'paused'
  }

  function finalizePlayback(showWinnerModal: boolean): void {
    clearPlaybackTimer()
    setIsPlayback(false)
    setPlaybackStatus(null)
    setPlaybackRenderer(null)
    playbackStatusRef.current = null
    const finalGame = playbackFinalGameRef.current
    const finalRemaining = playbackFinalRemainingRef.current
    if (finalGame && finalRemaining) {
      setGame(cloneGameState(finalGame))
      setDisplayRemaining({ ...finalRemaining })
      setWinnerModalVisible(showWinnerModal)
    }
    setIsAnimating(false)
    setAnimatingKey(null)
    const finalAutoCount = finalGame ? finalGame.lastAutoPlacements.length : 0
    setRevealedAutoCount(finalAutoCount)
    const totalMoves = playbackMoveEndFrameIndicesRef.current.length
    playbackMoveCursorRef.current = totalMoves
    setPlaybackMoveCursor(totalMoves)
    setPlaybackTotalMoves(totalMoves)
  }

  function schedulePlaybackStep(delayMs: number): void {
    clearPlaybackTimer()
    playbackTimerRef.current = window.setTimeout(() => {
      if (playbackStatusRef.current !== 'playing') {
        return
      }

      const frames = playbackFramesRef.current
      const cursor = playbackCursorRef.current
      if (cursor >= frames.length) {
        playbackTimerRef.current = window.setTimeout(() => {
          finalizePlayback(true)
        }, PLAYBACK_GAP_MS)
        return
      }

      const frame = frames[cursor]
      applyPlaybackFrame(frame)
      const moveCursor = playbackFrameToMoveCursorRef.current[cursor] ?? playbackMoveCursorRef.current
      if (moveCursor !== playbackMoveCursorRef.current) {
        playbackMoveCursorRef.current = moveCursor
        setPlaybackMoveCursor(moveCursor)
      }
      playbackCursorRef.current = cursor + 1
      schedulePlaybackStep(frame.delayMs)
    }, delayMs)
  }

  function runPlaybackFromRecord(baseRecord: MatchRecord, renderer: BoardRendererMode): void {
    if (baseRecord.moves.length === 0 || isPlayback) {
      return
    }

    const {
      frames,
      moveStartFrameIndices,
      moveEndFrameIndices,
      frameToMoveCursor,
      initialGame,
      initialRemaining,
      finalGame,
      finalRemaining,
    } = buildPlaybackFrames(baseRecord)
    const openingTurn: PlayerColor = baseRecord.moves[0]?.player ?? 'blue'
    if (frames.length === 0) {
      return
    }

    clearAnimationTimers()
    clearPlaybackTimer()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(true)
    setPlaybackStatus('playing')
    setPlaybackRenderer(renderer)
    playbackStatusRef.current = 'playing'
    setWinnerModalVisible(false)
    setIsCpuThinking(false)
    setIsMobileMenuOpen(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    setBoardRenderer(renderer)
    lastWinnerRef.current = null
    playbackOpeningTurnRef.current = openingTurn

    playbackFramesRef.current = frames
    playbackMoveStartFrameIndicesRef.current = moveStartFrameIndices
    playbackMoveEndFrameIndicesRef.current = moveEndFrameIndices
    playbackFrameToMoveCursorRef.current = frameToMoveCursor
    playbackCursorRef.current = 0
    playbackMoveCursorRef.current = 0
    playbackInitialGameRef.current = initialGame
    playbackInitialRemainingRef.current = initialRemaining
    playbackFinalGameRef.current = finalGame
    playbackFinalRemainingRef.current = finalRemaining
    setPlaybackMoveCursor(0)
    setPlaybackTotalMoves(baseRecord.moves.length)

    setGame(cloneGameState(initialGame))
    setDisplayRemaining({ ...initialRemaining })
    schedulePlaybackStep(90)
  }

  function runPlayback(renderer: BoardRendererMode): void {
    runPlaybackFromRecord(matchRecord, renderer)
  }

  function createExportRecord(): MosaicRecordV1 {
    return {
      format: 'mosaic-record',
      version: 1,
      exportedAt: new Date().toISOString(),
      mode: matchMode,
      themeId: getThemeByAssignedColors(playerColors)?.key ?? null,
      playerColors: { ...matchRecord.players },
      openingTurn: matchRecord.moves[0]?.player ?? 'blue',
      moves: matchRecord.moves.map((move) => ({
        turn: move.turn,
        player: move.player,
        manual: { ...move.manual },
        autoPlacements: move.autoPlacements.map((item) => ({ ...item })),
      })),
      winner: matchRecord.winner,
      cpuSettings:
        matchMode === 'cpu'
          ? {
              matchType: cpuMatchType,
              cpuDifficulty,
              cpu1Difficulty,
              cpu2Difficulty,
            }
          : undefined,
      onlinePlayers:
        matchMode === 'online'
          ? {
              role: onlineSession.role,
              isHost: onlineSession.isHost,
            }
          : undefined,
    }
  }

  function scoreSheetModeLabel(mode: MosaicRecordV1['mode']): string {
    if (mode === 'online') {
      return t('mode.onlineMatch')
    }
    if (mode === 'cpu') {
      return t('mode.cpuMatch')
    }
    return t('mode.localMatch')
  }

  function scoreSheetWinnerLabel(record: MosaicRecordV1): string {
    if (!record.winner) {
      return t('sheet.winnerDraw')
    }
    return record.winner === record.openingTurn ? t('sheet.winnerFirst') : t('sheet.winnerSecond')
  }

  function buildScoreSheetRenderLabels(record: MosaicRecordV1): ScoreSheetRenderLabels {
    return {
      title: t('sheet.title'),
      modeLabel: t('sheet.metaMode'),
      modeValue: scoreSheetModeLabel(record.mode),
      winnerLabel: t('sheet.metaWinner'),
      winnerValue: scoreSheetWinnerLabel(record),
      movesLabel: t('sheet.metaMoves'),
      exportedAtLabel: t('sheet.metaExportedAt'),
    }
  }

  function handleSaveRecord(): void {
    if (matchRecord.moves.length === 0) {
      setRecordNotice({ kind: 'error', message: t('record.noMoves') })
      return
    }
    const record = createExportRecord()
    const fileName = createMosaicRecordFileName(record.mode)
    downloadMosaicRecord(record, fileName)
    setRecordNotice({ kind: 'success', message: t('record.saved') })
  }

  async function handleExportScoreSheet(): Promise<void> {
    if (matchRecord.moves.length === 0) {
      setRecordNotice({ kind: 'error', message: t('record.noMoves') })
      return
    }

    try {
      const record = createExportRecord()
      const fileName = createMosaicScoreSheetFileName(record.mode)
      await exportMosaicScoreSheetPng(record, buildScoreSheetRenderLabels(record), fileName)
      setRecordNotice({ kind: 'success', message: t('sheet.exported') })
    } catch {
      setRecordNotice({ kind: 'error', message: t('sheet.failedExport') })
    }
  }

  function handleLoadRecordClick(): void {
    recordFileInputRef.current?.click()
  }

  function applyImportedRecord(record: MosaicRecordV1): void {
    const importedColors: PlayerColorConfig = {
      blue: isDisplayColorId(record.playerColors.blue) ? record.playerColors.blue : DEFAULT_PLAYER_COLORS.blue,
      yellow: isDisplayColorId(record.playerColors.yellow) ? record.playerColors.yellow : DEFAULT_PLAYER_COLORS.yellow,
    }
    const importedMatchRecord: MatchRecord = {
      players: importedColors,
      moves: record.moves.map((move) => ({
        turn: move.turn,
        player: move.player,
        manual: { ...move.manual },
        autoPlacements: move.autoPlacements.map((item) => ({ ...item })),
      })),
      winner: record.winner,
    }

    stopOnlineRoomSubscription()
    clearAnimationTimers()
    clearPlaybackTimer()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setPlaybackStatus(null)
    setPlaybackRenderer(null)
    setIsCpuThinking(false)
    setHardDebugAnalysis(null)
    setDebugOverlayMode('total')
    setIsMobileMenuOpen(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    setBoardRenderer('2d')
    setWinnerModalVisible(false)
    setSetupOpen(false)
    setSetupStep('mode')
    setMatchMode(record.mode)
    if (record.mode === 'cpu') {
      if (record.cpuSettings?.matchType === 'you_vs_cpu' || record.cpuSettings?.matchType === 'cpu_vs_cpu') {
        setCpuMatchType(record.cpuSettings.matchType)
      }
      if (record.cpuSettings?.cpuDifficulty === 'easy' || record.cpuSettings?.cpuDifficulty === 'normal' || record.cpuSettings?.cpuDifficulty === 'hard') {
        setCpuDifficulty(record.cpuSettings.cpuDifficulty)
      }
      if (record.cpuSettings?.cpu1Difficulty === 'easy' || record.cpuSettings?.cpu1Difficulty === 'normal' || record.cpuSettings?.cpu1Difficulty === 'hard') {
        setCpu1Difficulty(record.cpuSettings.cpu1Difficulty)
      }
      if (record.cpuSettings?.cpu2Difficulty === 'easy' || record.cpuSettings?.cpu2Difficulty === 'normal' || record.cpuSettings?.cpu2Difficulty === 'hard') {
        setCpu2Difficulty(record.cpuSettings.cpu2Difficulty)
      }
    }
    setOnlineSession({
      ...INITIAL_ONLINE_SESSION,
      role: record.mode === 'online' ? (record.onlinePlayers?.role ?? null) : null,
      isHost: record.mode === 'online' ? Boolean(record.onlinePlayers?.isHost) : false,
      createColors: importedColors,
    })
    setPlayerColors(importedColors)
    setPendingColors(importedColors)
    setMatchRecord(importedMatchRecord)
    setHistory([
      {
        game: cloneGameState(createInitialGameState()),
        matchRecord: cloneMatchRecord(importedMatchRecord),
      },
    ])
    runPlaybackFromRecord(importedMatchRecord, '2d')
    setRecordNotice({ kind: 'success', message: t('record.import') })
  }

  async function handleImportRecordFile(file: File | null): Promise<void> {
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      const parsed = parseMosaicRecord(text)
      if (!parsed.ok || !parsed.record) {
        setRecordNotice({ kind: 'error', message: t('record.invalidFile') })
        return
      }
      applyImportedRecord(parsed.record)
    } catch {
      setRecordNotice({ kind: 'error', message: t('record.failedLoad') })
    }
  }

  function handlePlayback2D(): void {
    runPlayback('2d')
  }

  function handlePlayback3D(): void {
    runPlayback('3d')
  }

  function handlePauseResumePlayback(): void {
    if (!isPlayback) {
      return
    }
    if (playbackStatusRef.current === 'playing') {
      clearPlaybackTimer()
      setPlaybackStatus('paused')
      playbackStatusRef.current = 'paused'
      return
    }
    if (playbackMoveCursorRef.current >= playbackMoveEndFrameIndicesRef.current.length) {
      return
    }
    setPlaybackStatus('playing')
    playbackStatusRef.current = 'playing'
    schedulePlaybackStep(70)
  }

  function handlePlaybackJumpToStart(): void {
    if (!isPlayback) {
      return
    }
    stopPlaybackAutoplayForManualStep()
    setPlaybackMovePosition(0)
  }

  function handlePlaybackPreviousMove(): void {
    if (!isPlayback) {
      return
    }
    stopPlaybackAutoplayForManualStep()
    setPlaybackMovePosition(playbackMoveCursorRef.current - 1)
  }

  function handlePlaybackNextMove(): void {
    if (!isPlayback) {
      return
    }
    stopPlaybackAutoplayForManualStep()
    setPlaybackMovePosition(playbackMoveCursorRef.current + 1)
  }

  function handlePlaybackJumpToEnd(): void {
    if (!isPlayback) {
      return
    }
    stopPlaybackAutoplayForManualStep()
    setPlaybackMovePosition(playbackMoveEndFrameIndicesRef.current.length)
  }

  function handleStopPlayback(): void {
    if (!isPlayback) {
      return
    }
    finalizePlayback(true)
  }

  function handleUndo(): void {
    if (matchMode === 'online' || history.length <= 1 || isAnimating || isPlayback || setupOpen) {
      return
    }

    clearAnimationTimers()
    clearPlaybackTimer()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setPlaybackStatus(null)
    setPlaybackRenderer(null)
    setWinnerModalVisible(false)
    setIsCpuThinking(false)
    setIsMobileMenuOpen(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)

    const rewindCount =
      matchMode === 'cpu' && game.lastActor === 'yellow' && history.length > 2
        ? 2
        : 1
    const nextHistory = history.slice(0, -rewindCount)
    const prevSnapshot = nextHistory[nextHistory.length - 1]
    lastWinnerRef.current = prevSnapshot.game.winner
    setHistory(nextHistory)
    setGame(cloneGameState(prevSnapshot.game))
    setDisplayRemaining({ ...prevSnapshot.game.remaining })
    setMatchRecord(cloneMatchRecord(prevSnapshot.matchRecord))
    setWinnerModalVisible(Boolean(prevSnapshot.game.winner))
  }

  function ensureAudioContext(): AudioContext | null {
    if (!soundOn) {
      return null
    }

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) {
      return null
    }

    if (!audioCtxRef.current) {
      audioCtxRef.current = new Ctx()
    }

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => undefined)
    }

    return audioCtxRef.current
  }

  function playTone(freq: number, duration: number, volume: number): void {
    const ctx = ensureAudioContext()
    if (!ctx) {
      return
    }

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.value = freq

    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  }

  function playManualSound(): void {
    playTone(300, 0.075, 0.07)
    playTone(220, 0.055, 0.04)
  }

  function playAutoSound(chainIndex: number): void {
    const freq = 430 + Math.min(chainIndex, 8) * 28
    playTone(freq, 0.048, 0.045)
  }

  function playWinnerSound(): void {
    if (!soundOn) {
      return
    }
    playTone(520, 0.08, 0.06)
    const id1 = window.setTimeout(() => playTone(660, 0.08, 0.055), 90)
    const id2 = window.setTimeout(() => playTone(820, 0.11, 0.05), 185)
    timeoutIdsRef.current.push(id1, id2)
  }

  return (
    <main className={`page mobile-panels-${mobilePanelMode}`} style={themeStyle}>
      {!isOnlineMockView ? (
        <section className="advantage-strip" aria-label="advantage bar">
          <div className="advantage-meta">
            <span className="left-label">{matchMode === 'cpu' && cpuMatchType === 'cpu_vs_cpu' ? 'CPU 2' : matchMode === 'cpu' ? 'CPU' : '2P'} {leftPercent}%</span>
            <span className="right-label">{rightPercent}% {matchMode === 'cpu' && cpuMatchType === 'cpu_vs_cpu' ? 'CPU 1' : '1P'}</span>
          </div>
          <div className="advantage-track">
            <div className="advantage-left" style={{ width: `${leftPercent}%` }} />
            <div className="advantage-divider" />
          </div>
        </section>
      ) : null}

      {isOnlineMockView ? (
        <OnlineMockPanel
          t={t}
          phase={onlineSession.phase}
          roomCode={onlineSession.roomCode}
          roomInput={onlineSession.roomInput}
          waitMessage={onlineSession.waitMessage}
          errorMessage={onlineSession.errorMessage}
          createColors={onlineSession.createColors}
          role={onlineSession.role}
          isHost={onlineSession.isHost}
          connectionState={onlineSession.connectionState}
          syncState={onlineSession.syncState}
          onInputRoomCode={(value) =>
            setOnlineSession((prev) => ({
              ...prev,
              roomInput: value,
            }))
          }
          onConfirmJoin={() => {
            void confirmOnlineJoin()
          }}
          onBackToCreateSetup={() => {
            stopOnlineRoomSubscription()
            openSetupForOnline('create')
          }}
          onBackFromJoinOrError={() => {
            stopOnlineRoomSubscription()
            openSetupForOnline('join')
          }}
          onCancelWaiting={() => {
            if (!confirmLeaveOnlineIfNeeded()) {
              return
            }
            void leaveOnlineRoomExplicitly()
            stopOnlineRoomSubscription()
            openSetupForOnline('create')
          }}
        />
      ) : (
      <section className="table-layout">
        <PlayerPanel
          playerKey="yellow"
          playerLabel={
            matchMode === 'cpu'
              ? cpuMatchType === 'cpu_vs_cpu'
                ? `CPU 2 (${cpuDifficultyLabel(cpu2Difficulty, language)})`
                : `CPU (${cpuDifficultyLabel(cpuDifficulty, language)})`
              : matchMode === 'online'
                ? onlineSession.role === 'yellow'
                  ? 'Player 2 (You)'
                  : 'Player 2'
                : INTERNAL_LABEL.yellow
          }
          colorHex={yellowTheme.hex}
          colorSoft={hexToRgba(yellowTheme.hex, 0.28)}
          remaining={displayRemaining.yellow}
          isTurn={!game.winner && displayTurnPlayer === 'yellow'}
          isWinner={game.winner === 'yellow'}
          isThinking={matchMode === 'cpu' && !game.winner && game.currentTurn === 'yellow' && isCpuThinking}
          thinkingLabel={t('status.thinking')}
          winnerLabel={t('status.winner')}
          turnLabel={turnBadgeLabel}
        />

        <section className="board-stage" aria-label="mosaic board" ref={boardStageRef}>
          {boardRenderer === '3d' ? (
            <div className="board-wrap board-wrap-3d" style={{ width: `${boardSize}px`, height: `${boardSize}px` }}>
              <Board3DViewport
                board={game.board}
                colors={pieceColorMap}
                onStartPlayback={game.winner && !isPlayback ? handlePlayback3D : undefined}
                playbackLabel={t('action.playback')}
                rotateOnLabel={t('action.rotateOn')}
                rotateOffLabel={t('action.rotateOff')}
                view2dLabel={t('action.view2d')}
                onSwitchTo2D={
                  !isPlayback
                    ? () => {
                        setBoardRenderer('2d')
                        if (game.winner) {
                          setWinnerModalVisible(true)
                        }
                      }
                    : undefined
                }
              />
            </div>
          ) : (
            <div className="board-wrap" style={{ width: `${boardSize}px`, height: `${boardSize}px` }}>
              <div className="board">
                {positions.map((cell) => {
                  const visibleLegal = cell.legal && !(suppressDeeperCpuLegalIndicators && cell.level > 0)

                  if (!cell.pieceColor && !visibleLegal) {
                    return null
                  }

                  const visualZ = 10 + cell.level * 10 + (cell.pieceColor ? 1 : 0)
                  const hitZ = 200 + cell.level

                  return (
                    <div key={cell.key}>
                      {visibleLegal &&
                      !game.winner &&
                      !cell.pieceColor &&
                      !setupOpen &&
                      !isAnimating &&
                      !(matchMode === 'cpu' && (cpuMatchType === 'cpu_vs_cpu' || game.currentTurn === 'yellow')) &&
                      (!isOnlineMode || (onlineSession.phase === 'playing' && isOnlineMyTurn)) ? (
                        <button
                          className="token-hit"
                          data-turn={game.currentTurn}
                          style={{ left: `${cell.left}%`, top: `${cell.top}%`, zIndex: `${hitZ}` }}
                          onClick={() => onCellClick(cell.level, cell.row, cell.col)}
                          onMouseEnter={() => {
                            if (!showHardDebugOverlay) {
                              return
                            }
                            setHoveredDebugMoveKey(cell.key)
                          }}
                          onMouseLeave={() => {
                            if (!showHardDebugOverlay) {
                              return
                            }
                            setHoveredDebugMoveKey((prev) => (prev === cell.key ? null : prev))
                          }}
                          type="button"
                          aria-label={`L${cell.level} row ${cell.row + 1} col ${cell.col + 1}`}
                        />
                      ) : null}
                      {showHardDebugOverlay ? (
                        (() => {
                          const debug = hardDebugCandidateMap.get(cell.key)
                          const overlay = hardDebugOverlayMap.map.get(cell.key)
                          if (!debug) {
                            return null
                          }
                          return (
                            <div
                              className={[
                                'cpu-debug-marker',
                                debug.rank <= 5 ? 'top' : '',
                                selectedDebugMoveKey === cell.key ? 'selected' : '',
                                hoveredDebugMoveKey === cell.key ? 'hovered' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              style={{
                                left: `${cell.left}%`,
                                top: `${cell.top}%`,
                                zIndex: `${hitZ + 1}`,
                                ...(overlay?.style ?? {}),
                              }}
                            >
                              {debug.rank <= 5 ? <span className="rank">#{debug.rank}</span> : null}
                              <span className="score">{overlay?.text ?? Math.round(debug.score)}</span>
                            </div>
                          )
                        })()
                      ) : null}

                      <div
                        className={[
                          'token-visual',
                          cell.pieceColor ? 'filled' : visibleLegal ? 'empty legal' : 'empty',
                          cell.isLastMove ? 'last-move' : '',
                          cell.isAnimatingSpawn ? 'appear' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ left: `${cell.left}%`, top: `${cell.top}%`, zIndex: `${visualZ}` }}
                      >
                        {cell.pieceColor ? <span className={`piece ${cell.pieceColor}`} /> : visibleLegal ? <span className="guide" /> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {showCpuThinkingOverlay ? (
            <div className="board-thinking-overlay" aria-live="polite">
              <span className="board-thinking-chip">
                <span className="thinking-text">{t('status.thinking').replace(/(\.{1,3}|…)+$/u, '')}</span>
                <span className="thinking-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            </div>
          ) : null}
          {boardRenderer === '2d' ? chainBanners.map((banner, index) => {
            const lane = (banner.id % 3) - 1
            const offsetX = lane * 7
            const offsetY = Math.min(index, 5) * 4
            return (
              <div
                key={banner.id}
                className="chain-banner"
                aria-live="polite"
                aria-label={`${banner.count} chain`}
                style={{
                  left: `${banner.left}%`,
                  top: `${banner.top}%`,
                  transform: `translate(calc(-50% + ${offsetX}px), calc(-100% - ${offsetY}px))`,
                }}
              >
                <span className={['chain-banner-text', `tone-${banner.tone}`].join(' ')}>
                  {banner.count} CHAIN!
                </span>
              </div>
            )
          }) : null}
          {mobilePanelMode === 'faceoff' ? (
            <div className="mobile-side-influence" style={{ height: `${boardSize}px` }} aria-label="mobile influence bar">
              <div className="mobile-side-meta top">{leftPercent}%</div>
              <div className="mobile-side-track">
                <div className="mobile-side-fill" style={{ height: `${rightPercent}%` }} />
                <div className="mobile-side-divider" />
              </div>
              <div className="mobile-side-meta bottom">{rightPercent}%</div>
            </div>
          ) : null}
        </section>

        <PlayerPanel
          playerKey="blue"
          playerLabel={
            matchMode === 'cpu'
              ? cpuMatchType === 'cpu_vs_cpu'
                ? `CPU 1 (${cpuDifficultyLabel(cpu1Difficulty, language)})`
                : INTERNAL_LABEL.blue
              : matchMode === 'online'
              ? onlineSession.role === 'blue'
                ? 'Player 1 (You)'
                : 'Player 1'
              : INTERNAL_LABEL.blue
          }
          colorHex={blueTheme.hex}
          colorSoft={hexToRgba(blueTheme.hex, 0.28)}
          remaining={displayRemaining.blue}
          isTurn={!game.winner && displayTurnPlayer === 'blue'}
          isWinner={game.winner === 'blue'}
          isThinking={matchMode === 'cpu' && cpuMatchType === 'cpu_vs_cpu' && !game.winner && game.currentTurn === 'blue' && isCpuThinking}
          thinkingLabel={t('status.thinking')}
          winnerLabel={t('status.winner')}
          turnLabel={turnBadgeLabel}
        />
      </section>
      )}

      {!isOnlineMockView ? (
      <div className="mobile-menu" ref={mobileMenuRef}>
        <button
          type="button"
          className="mobile-menu-toggle"
          aria-label={t('menu.gameSetup')}
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
        {isMobileMenuOpen ? (
          <div className="mobile-menu-panel" role="menu" aria-label={t('menu.gameSetup')}>
            <div className="mobile-menu-group">
              <div className="mobile-menu-group-title">{t('menu.language')}</div>
              <div className="mobile-menu-segment" role="radiogroup" aria-label="language">
                <button
                  type="button"
                  className={['mobile-segment-btn', language === 'en' ? 'selected' : ''].filter(Boolean).join(' ')}
                  aria-pressed={language === 'en'}
                  onClick={() => setLanguage('en')}
                >
                  {t('menu.english')}
                </button>
                <button
                  type="button"
                  className={['mobile-segment-btn', language === 'ja' ? 'selected' : ''].filter(Boolean).join(' ')}
                  aria-pressed={language === 'ja'}
                  onClick={() => setLanguage('ja')}
                >
                  {t('menu.japanese')}
                </button>
              </div>
            </div>
            <div className="mobile-menu-group">
              <div className="mobile-menu-group-title">{t('menu.infoPanel')}</div>
              <div className="mobile-menu-segment" role="radiogroup" aria-label="info panel mode">
                <button
                  type="button"
                  className={['mobile-segment-btn', mobilePanelMode === 'standard' ? 'selected' : ''].filter(Boolean).join(' ')}
                  aria-pressed={mobilePanelMode === 'standard'}
                  onClick={() => setMobilePanelMode('standard')}
                >
                  {t('menu.standard')}
                </button>
                <button
                  type="button"
                  className={['mobile-segment-btn', mobilePanelMode === 'faceoff' ? 'selected' : ''].filter(Boolean).join(' ')}
                  aria-pressed={mobilePanelMode === 'faceoff'}
                  onClick={() => setMobilePanelMode('faceoff')}
                >
                  {t('menu.faceoff')}
                </button>
              </div>
            </div>
            <button
              type="button"
              role="menuitem"
              className="mobile-menu-item"
              onClick={() => {
                setSoundOn((prev) => !prev)
              }}
            >
              {soundOn ? t('action.soundOn') : t('action.soundOff')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="mobile-menu-item"
              onClick={handleLoadRecordClick}
            >
              {t('action.loadRecord')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="mobile-menu-item"
              onClick={handleUndo}
              disabled={matchMode === 'online' || history.length <= 1 || isAnimating || isPlayback || setupOpen || isCpuThinking}
            >
              {t('action.undo')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="mobile-menu-item danger"
              onClick={openSetup}
            >
              {t('action.reset')}
            </button>
          </div>
        ) : null}
      </div>
      ) : null}

      {!isOnlineMockView ? (
      <button type="button" className="sound-fixed" onClick={() => setSoundOn((prev) => !prev)}>
        {soundOn ? t('action.soundOn') : t('action.soundOff')}
      </button>
      ) : null}
      {!isOnlineMockView ? (
      <button
        type="button"
        className="language-fixed"
        onClick={() => setLanguage((prev) => (prev === 'en' ? 'ja' : 'en'))}
        aria-label={t('menu.language')}
      >
        {t('menu.language')}: {language === 'en' ? t('menu.english') : t('menu.japanese')}
      </button>
      ) : null}
      {!isOnlineMockView ? (
      <button type="button" className="load-fixed" onClick={handleLoadRecordClick}>
        {t('action.loadRecord')}
      </button>
      ) : null}
      {!isOnlineMockView ? (
      <button
        type="button"
        className="undo-fixed"
        onClick={handleUndo}
        disabled={matchMode === 'online' || history.length <= 1 || isAnimating || isPlayback || setupOpen || isCpuThinking}
      >
        {t('action.undo')}
      </button>
      ) : null}
      {!isOnlineMockView ? (
      <button type="button" className="reset-fixed" onClick={openSetup}>
        {t('action.reset')}
      </button>
      ) : null}
      <input
        ref={recordFileInputRef}
        type="file"
        accept=".mosaic,application/json"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          void handleImportRecordFile(file)
          event.currentTarget.value = ''
        }}
      />
      {recordNotice ? (
        <div className={['record-notice', recordNotice.kind].join(' ')} role="status" aria-live="polite">
          {recordNotice.message}
        </div>
      ) : null}
      {showHardDebugOverlay ? (
        <aside className={['cpu-debug-hud', isDebugHudCollapsed ? 'collapsed' : ''].filter(Boolean).join(' ')} aria-live="polite">
          <div className="cpu-debug-header">
            <div className="cpu-debug-title">CPU Debug (Hard)</div>
            <button
              type="button"
              className="cpu-debug-toggle"
              onClick={() => {
                setIsDebugHudCollapsed((prev) => !prev)
              }}
              aria-label={isDebugHudCollapsed ? 'Expand debug HUD' : 'Collapse debug HUD'}
            >
              {isDebugHudCollapsed ? '+' : '-'}
            </button>
          </div>
          <div className="cpu-debug-body">
            <div className="cpu-debug-overlay-status">
              <span className="cpu-debug-overlay-chip">
                Board overlay: {debugOverlayModeLabel}
              </span>
              <span className="cpu-debug-overlay-chip">
                Heatmap: {debugHeatmapModeLabel}
              </span>
              {!isDebugHudCollapsed ? (
                <label className="cpu-debug-overlay-total-row">
                  <input
                    type="radio"
                    name="board-overlay-mode"
                    checked={debugOverlayMode === 'total'}
                    onChange={() => setDebugOverlayMode('total')}
                  />
                  <span>Total</span>
                </label>
              ) : null}
              {!isDebugHudCollapsed ? (
                <span className="cpu-debug-overlay-legend">
                  negative
                  <span className="heat-neg" />
                  <span className="heat-mid" />
                  <span className="heat-pos" />
                  positive
                </span>
              ) : null}
            </div>
            {!isDebugHudCollapsed ? (
              <>
              <div className="cpu-debug-controls">
                {DEBUG_SCORE_CATEGORIES.map((category) => {
                  const items = debugComponentsByCategory.get(category.key) ?? []
                  const enabledCount = items.filter((item) => debugScoreComponents[item.key]).length
                  const allEnabled = enabledCount === items.length
                  const someEnabled = enabledCount > 0 && !allEnabled
                  return (
                    <section key={category.key} className="cpu-debug-group">
                      <button
                        type="button"
                        className={['cpu-debug-group-toggle', allEnabled ? 'all-on' : '', someEnabled ? 'some-on' : '']
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          setDebugScoreComponents((prev) => {
                            const nextEnabled = !allEnabled
                            const next = { ...prev }
                            for (const item of items) {
                              next[item.key] = nextEnabled
                            }
                            return next
                          })
                        }}
                        aria-pressed={allEnabled}
                      >
                        <span>{category.label}</span>
                        <span>{allEnabled ? 'On' : someEnabled ? 'Some' : 'Off'}</span>
                      </button>
                      <div className="cpu-debug-component-list">
                        {items.map((item) => (
                          <label
                            key={item.key}
                            className={[
                              'cpu-debug-component-row',
                              !debugScoreComponents[item.key] ? 'off' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <input
                              className="cpu-debug-overlay-radio"
                              type="radio"
                              name="board-overlay-mode"
                              checked={debugOverlayMode === item.key}
                              onChange={() => setDebugOverlayMode(item.key)}
                            />
                            <span className="cpu-debug-component-name">{item.label}</span>
                            <span className="cpu-debug-help" title={item.description} aria-label={`${item.label} help`}>
                              ?
                            </span>
                            <span className="cpu-debug-component-value">
                              {hardDebugComponentValueByKey
                                ? hardDebugComponentValueByKey[item.key].toFixed(1)
                                : '-'}
                            </span>
                            <input
                              className="cpu-debug-component-enable"
                              type="checkbox"
                              checked={debugScoreComponents[item.key]}
                              onChange={(event) => {
                                const checked = event.target.checked
                                setDebugScoreComponents((prev) => ({ ...prev, [item.key]: checked }))
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
              {hardDebugDetailCandidate ? (
                <div className="cpu-debug-selected">
              <div className="line">
              {hardDebugHoveredCandidate ? 'Hovering' : 'Selected'}: L{hardDebugDetailCandidate.move.level} ({hardDebugDetailCandidate.move.row + 1},{hardDebugDetailCandidate.move.col + 1})
              </div>
              <div className="line">Phase: {hardDebugAnalysis ? hardEndgamePhaseLabel(hardDebugAnalysis.phase) : 'Normal'}</div>
              <div className="line">
                Endgame gate tolerance:{' '}
                {hardDebugAnalysis && Number.isFinite(hardDebugAnalysis.endgameGateTolerance)
                  ? hardDebugAnalysis.endgameGateTolerance.toFixed(1)
                  : '--'}
              </div>
              <div className="line">Total: {hardDebugDetailCandidate.score.toFixed(1)}</div>
              <div className="line">
                Endgame: {hardDebugDetailCandidate.endgameScore.toFixed(1)} ({hardDebugDetailCandidate.endgameGatePassed ? 'gate: pass' : 'gate: out'})
              </div>
              <div className="line">
                Immediate: {hardDebugDetailCandidate.breakdown.immediateBaseValue.toFixed(1)} x {hardDebugDetailCandidate.breakdown.immediateMultiplier.toFixed(2)} x {hardDebugDetailCandidate.breakdown.immediatePhaseMultiplier.toFixed(2)} = {hardDebugDetailCandidate.breakdown.immediateAppliedValue.toFixed(1)}
              </div>
              <div className="line">
                Pattern Growth: {hardDebugDetailCandidate.breakdown.patternGrowthBaseValue.toFixed(1)} x{' '}
                {(hardDebugAnalysis?.phasePatternGrowthMultiplier ?? 1).toFixed(2)} ={' '}
                {hardDebugDetailCandidate.breakdown.patternGrowthAppliedValue.toFixed(1)}
              </div>
              <div className="line">
                Reply Risk: -{hardDebugDetailCandidate.breakdown.opponentReplyRiskBaseValue.toFixed(1)} x{' '}
                {(hardDebugAnalysis?.phaseReplyRiskMultiplier ?? 1).toFixed(2)} = -{hardDebugDetailCandidate.breakdown.opponentReplyRiskAppliedValue.toFixed(1)}
              </div>
              <div className="line sub">
                enemy best reply: {hardDebugDetailCandidate.breakdown.replyRiskBestMoveLabel}
              </div>
              <div className="line sub">
                enemy reply raw: {hardDebugDetailCandidate.breakdown.replyRiskBestMoveRawScore.toFixed(1)} / instant win:{' '}
                {hardDebugDetailCandidate.breakdown.replyRiskBestMoveInstantWin ? 'yes' : 'no'}
              </div>
              <div className="line sub">
                reply breakdown: immediate {hardDebugDetailCandidate.breakdown.replyRiskEnemyImmediate.toFixed(1)} / pattern{' '}
                {hardDebugDetailCandidate.breakdown.replyRiskEnemyPatternGrowth.toFixed(1)} / potential{' '}
                {hardDebugDetailCandidate.breakdown.replyRiskEnemyPatternPotential.toFixed(1)} / suppression{' '}
                {hardDebugDetailCandidate.breakdown.replyRiskEnemySuppression.toFixed(1)}
              </div>
              <div className="line sub">
                reply transform: raw {hardDebugDetailCandidate.breakdown.replyRiskRawBeforeCompression.toFixed(1)} x{' '}
                {hardDebugDetailCandidate.breakdown.replyRiskFactor.toFixed(2)} = compressed{' '}
                {hardDebugDetailCandidate.breakdown.replyRiskCompressedValue.toFixed(1)}
              </div>
              <div className="line sub">reply compression: {hardDebugDetailCandidate.breakdown.replyRiskCompressionInfo}</div>
              <div className="line">
                Phase multipliers: Immediate {(hardDebugAnalysis?.phaseImmediateMultiplier ?? 1).toFixed(2)} / Pattern{' '}
                {(hardDebugAnalysis?.phasePatternGrowthMultiplier ?? 1).toFixed(2)} / Reply{' '}
                {(hardDebugAnalysis?.phaseReplyRiskMultiplier ?? 1).toFixed(2)}
              </div>
                </div>
              ) : (
                <div className="cpu-debug-selected">
                  <div className="line">No analysis yet.</div>
                  <div className="line">CPU values will appear on its next evaluation.</div>
                  <div className="line">Total: --</div>
                </div>
              )}
              <div className="cpu-debug-list">
                {hardDebugTopCandidates.map((item) => (
                  <button
                    key={toMoveKey(item.move.level, item.move.row, item.move.col)}
                    type="button"
                    className={[
                      'cpu-debug-item',
                      selectedDebugMoveKey === toMoveKey(item.move.level, item.move.row, item.move.col) ? 'selected' : '',
                      hoveredDebugMoveKey === toMoveKey(item.move.level, item.move.row, item.move.col) ? 'hovered' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setSelectedDebugMoveKey(toMoveKey(item.move.level, item.move.row, item.move.col))}
                  >
                    <span>#{item.rank}</span>
                    <span>L{item.move.level} ({item.move.row + 1},{item.move.col + 1})</span>
                    <span>{item.score.toFixed(1)}</span>
                  </button>
                ))}
              </div>
              </>
            ) : null}
          </div>
        </aside>
      ) : null}
      {isPlayback ? (
        <div className="playback-chip playback-controls">
          <div className="playback-row playback-row-meta">
            <span className="playback-label">{playbackRenderer === '3d' ? t('playback.playback3d') : t('playback.playback')}</span>
            <span className="playback-progress" aria-label="playback progress">
              {playbackMoveCursor} / {playbackTotalMoves}
            </span>
          </div>
          <div className="playback-row playback-row-actions">
            <div className="playback-step-group">
              <button
                type="button"
                className="playback-control-btn step"
                onClick={handlePlaybackJumpToStart}
                disabled={playbackAtStart}
                aria-label={t('playback.jumpToStart')}
                title={t('playback.jumpToStart')}
              >
                ⏮
              </button>
              <button
                type="button"
                className="playback-control-btn step"
                onClick={handlePlaybackPreviousMove}
                disabled={playbackAtStart}
                aria-label={t('playback.previousMove')}
                title={t('playback.previousMove')}
              >
                ◀
              </button>
              <button
                type="button"
                className="playback-control-btn step"
                onClick={handlePlaybackNextMove}
                disabled={playbackAtEnd}
                aria-label={t('playback.nextMove')}
                title={t('playback.nextMove')}
              >
                ▶
              </button>
              <button
                type="button"
                className="playback-control-btn step"
                onClick={handlePlaybackJumpToEnd}
                disabled={playbackAtEnd}
                aria-label={t('playback.jumpToEnd')}
                title={t('playback.jumpToEnd')}
              >
                ⏭
              </button>
            </div>
            <button
              type="button"
              className="playback-control-btn"
              onClick={handlePauseResumePlayback}
              disabled={playbackAtEnd && playbackStatus === 'paused'}
            >
              {playbackStatus === 'paused' ? t('action.resume') : t('action.pause')}
            </button>
            <button type="button" className="playback-control-btn stop" onClick={handleStopPlayback}>
              {t('action.exit')}
            </button>
          </div>
        </div>
      ) : null}

      {game.winner && winnerModalVisible ? (
        <div className="winner-overlay" aria-live="polite">
          <div className="winner-card">
            <div className="winner-title">{winnerHeadline(game.winner, matchMode, onlineSession.role, cpuMatchType, language)}</div>
            <div
              className="winner-color-dot"
              style={{ background: colorById.get(playerColors[game.winner])?.hex ?? '#8f9aae' }}
              aria-label={t('status.winner')}
            />
            <div className="winner-actions">
              <div className="winner-actions-row winner-actions-row-primary">
                <button
                  type="button"
                  className="winner-btn view3d"
                  onClick={() => {
                    setBoardRenderer('3d')
                    setWinnerModalVisible(false)
                  }}
                >
                  {t('action.view3d')}
                </button>
                <button type="button" className="winner-btn playback" onClick={handlePlayback2D}>
                  {t('action.playback')}
                </button>
                <button type="button" className="winner-btn restart" onClick={openSetup}>
                  {t('action.restart')}
                </button>
              </div>
              <div className="winner-actions-row winner-actions-row-secondary">
                <button type="button" className="winner-btn playback" onClick={handleSaveRecord}>
                  {t('action.saveRecord')}
                </button>
                <button type="button" className="winner-btn playback" onClick={() => void handleExportScoreSheet()}>
                  {t('action.exportScoreSheet')}
                </button>
              </div>
            </div>
            <div className="winner-sparkles" aria-hidden="true">
              {Array.from({ length: 14 }, (_, i) => (
                <span key={i} style={{ '--i': i } as CSSProperties} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {setupOpen ? (
        <div className="setup-overlay" role="dialog" aria-modal="true">
          <div className="setup-modal">
            {setupStep === 'mode' ? (
              <>
                <h2>{t('menu.gameSetup')}</h2>
                <p>{t('menu.choosePlayStyle')}</p>
                <div className="mode-row">
                  <div className="picker-label">{t('mode.gameMode')}</div>
                  <div className="mode-options" role="radiogroup" aria-label="game mode">
                    <button
                      type="button"
                      className={['mode-option', pendingMode === 'pvp' ? 'selected' : ''].filter(Boolean).join(' ')}
                      onClick={() => {
                        setPendingMode('pvp')
                        setPendingOnlineAction(null)
                      }}
                      aria-pressed={pendingMode === 'pvp'}
                    >
                      {t('mode.localMatch')}
                    </button>
                    <button
                      type="button"
                      className={['mode-option', pendingMode === 'cpu' ? 'selected' : ''].filter(Boolean).join(' ')}
                      onClick={() => {
                        setPendingMode('cpu')
                        setPendingOnlineAction(null)
                      }}
                      aria-pressed={pendingMode === 'cpu'}
                    >
                      {t('mode.cpuMatch')}
                    </button>
                    <button
                      type="button"
                      className={['mode-option', pendingMode === 'online' ? 'selected' : ''].filter(Boolean).join(' ')}
                      onClick={() => setPendingMode('online')}
                      aria-pressed={pendingMode === 'online'}
                    >
                      {t('mode.onlineMatch')}
                    </button>
                  </div>
                </div>
                {pendingMode === 'cpu' ? (
                  <div className="mode-row">
                    <div className="picker-label">{t('mode.matchType')}</div>
                    <div className="mode-options" role="radiogroup" aria-label="cpu match type">
                      <button
                        type="button"
                        className={['mode-option', pendingCpuMatchType === 'you_vs_cpu' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingCpuMatchType('you_vs_cpu')}
                        aria-pressed={pendingCpuMatchType === 'you_vs_cpu'}
                      >
                        {t('mode.youVsCpu')}
                      </button>
                      <button
                        type="button"
                        className={['mode-option', pendingCpuMatchType === 'cpu_vs_cpu' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingCpuMatchType('cpu_vs_cpu')}
                        aria-pressed={pendingCpuMatchType === 'cpu_vs_cpu'}
                      >
                        {t('mode.cpuVsCpu')}
                      </button>
                    </div>
                  </div>
                ) : null}
                {pendingMode === 'cpu' && pendingCpuMatchType === 'you_vs_cpu' ? (
                  <div className="mode-row">
                    <div className="picker-label">{t('mode.cpuDifficulty')}</div>
                    <div className="mode-options difficulty-options" role="radiogroup" aria-label="cpu difficulty">
                      <button
                        type="button"
                        className={['mode-option', pendingCpuDifficulty === 'easy' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingCpuDifficulty('easy')}
                        aria-pressed={pendingCpuDifficulty === 'easy'}
                      >
                        {t('mode.easy')}
                      </button>
                      <button
                        type="button"
                        className={['mode-option', pendingCpuDifficulty === 'normal' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingCpuDifficulty('normal')}
                        aria-pressed={pendingCpuDifficulty === 'normal'}
                      >
                        {t('mode.normal')}
                      </button>
                      <button
                        type="button"
                        className={['mode-option', pendingCpuDifficulty === 'hard' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingCpuDifficulty('hard')}
                        aria-pressed={pendingCpuDifficulty === 'hard'}
                      >
                        {t('mode.hard')}
                      </button>
                    </div>
                  </div>
                ) : null}
                {pendingMode === 'cpu' && pendingCpuMatchType === 'cpu_vs_cpu' ? (
                  <>
                    <div className="mode-row">
                      <div className="picker-label">{t('mode.cpu1Difficulty')}</div>
                      <div className="mode-options difficulty-options" role="radiogroup" aria-label="cpu 1 difficulty">
                        <button
                          type="button"
                          className={['mode-option', pendingCpu1Difficulty === 'easy' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingCpu1Difficulty('easy')}
                          aria-pressed={pendingCpu1Difficulty === 'easy'}
                        >
                          {t('mode.easy')}
                        </button>
                        <button
                          type="button"
                          className={['mode-option', pendingCpu1Difficulty === 'normal' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingCpu1Difficulty('normal')}
                          aria-pressed={pendingCpu1Difficulty === 'normal'}
                        >
                          {t('mode.normal')}
                        </button>
                        <button
                          type="button"
                          className={['mode-option', pendingCpu1Difficulty === 'hard' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingCpu1Difficulty('hard')}
                          aria-pressed={pendingCpu1Difficulty === 'hard'}
                        >
                          {t('mode.hard')}
                        </button>
                      </div>
                    </div>
                    <div className="mode-row">
                      <div className="picker-label">{t('mode.cpu2Difficulty')}</div>
                      <div className="mode-options difficulty-options" role="radiogroup" aria-label="cpu 2 difficulty">
                        <button
                          type="button"
                          className={['mode-option', pendingCpu2Difficulty === 'easy' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingCpu2Difficulty('easy')}
                          aria-pressed={pendingCpu2Difficulty === 'easy'}
                        >
                          {t('mode.easy')}
                        </button>
                        <button
                          type="button"
                          className={['mode-option', pendingCpu2Difficulty === 'normal' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingCpu2Difficulty('normal')}
                          aria-pressed={pendingCpu2Difficulty === 'normal'}
                        >
                          {t('mode.normal')}
                        </button>
                        <button
                          type="button"
                          className={['mode-option', pendingCpu2Difficulty === 'hard' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingCpu2Difficulty('hard')}
                          aria-pressed={pendingCpu2Difficulty === 'hard'}
                        >
                          {t('mode.hard')}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
                {pendingMode === 'online' ? (
                  <div className="mode-row">
                    <div className="picker-label">{t('mode.onlineAction')}</div>
                    <div className="mode-options" role="radiogroup" aria-label="online action">
                      <button
                        type="button"
                        className={['mode-option', pendingOnlineAction === 'create' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingOnlineAction('create')}
                        aria-pressed={pendingOnlineAction === 'create'}
                      >
                        {t('mode.createRoom')}
                      </button>
                      <button
                        type="button"
                        className={['mode-option', pendingOnlineAction === 'join' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingOnlineAction('join')}
                        aria-pressed={pendingOnlineAction === 'join'}
                      >
                        {t('mode.joinRoom')}
                      </button>
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="start-button"
                  onClick={proceedFromGameSetup}
                  disabled={pendingMode === 'online' && !pendingOnlineAction}
                >
                  {t('action.continue')}
                </button>
              </>
            ) : (
              <>
                <h2>{pendingMode === 'online' ? t('setup.onlineMatchSetup') : t('setup.matchSetup')}</h2>
                <p>
                  {pendingMode === 'online'
                    ? t('setup.chooseOnlineTurnAndColors')
                    : pendingMode === 'cpu' && pendingCpuMatchType === 'cpu_vs_cpu'
                      ? t('setup.chooseCpuVsCpuColors')
                      : t('setup.chooseTurnAndColors')}
                </p>

                <div className="setup-config-grid">
                  <div className="setup-config-left">
                    <div className="picker-label">{t('setup.turnOrder')}</div>
                    {pendingMode === 'online' ? (
                      <div className="mode-options" role="radiogroup" aria-label="host turn order">
                        <button
                          type="button"
                          className={['mode-option', pendingHostTurnOrder === 'host_first' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingHostTurnOrder('host_first')}
                          aria-pressed={pendingHostTurnOrder === 'host_first'}
                        >
                          {t('setup.hostGoesFirst')}
                        </button>
                        <button
                          type="button"
                          className={['mode-option', pendingHostTurnOrder === 'host_second' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingHostTurnOrder('host_second')}
                          aria-pressed={pendingHostTurnOrder === 'host_second'}
                        >
                          {t('setup.hostGoesSecond')}
                        </button>
                      </div>
                    ) : pendingMode === 'cpu' && pendingCpuMatchType === 'you_vs_cpu' ? (
                      <div className="mode-options" role="radiogroup" aria-label="cpu turn order">
                        <button
                          type="button"
                          className={['mode-option', pendingCpuTurnOrder === 'you_first' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingCpuTurnOrder('you_first')}
                          aria-pressed={pendingCpuTurnOrder === 'you_first'}
                        >
                          {t('setup.youGoFirst')}
                        </button>
                        <button
                          type="button"
                          className={['mode-option', pendingCpuTurnOrder === 'you_second' ? 'selected' : ''].filter(Boolean).join(' ')}
                          onClick={() => setPendingCpuTurnOrder('you_second')}
                          aria-pressed={pendingCpuTurnOrder === 'you_second'}
                        >
                          {t('setup.youGoSecond')}
                        </button>
                      </div>
                    ) : pendingMode === 'cpu' && pendingCpuMatchType === 'cpu_vs_cpu' ? (
                      <div className="mode-options" aria-label="cpu vs cpu turn order">
                        <button type="button" className="mode-option selected" disabled>
                          {t('setup.cpu1GoesFirst')}
                        </button>
                      </div>
                    ) : (
                      <div className="mode-options" aria-label="local turn order">
                        <button type="button" className="mode-option selected" disabled>
                          {t('setup.player1GoesFirst')}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="setup-config-right">
                    <div className="picker-row">
                      <div className="picker-label">{t('setup.colorTheme')}</div>
                      <div className="theme-grid" role="radiogroup" aria-label="color theme">
                        {COLOR_PAIR_THEMES.map((theme) => {
                          const isSelected = selectedColorTheme?.key === theme.key
                          return (
                            <button
                              key={theme.key}
                              type="button"
                              className={['theme-option', isSelected ? 'selected' : ''].filter(Boolean).join(' ')}
                              aria-pressed={isSelected}
                              onClick={() =>
                                setPendingColors({
                                  blue: theme.colors[0],
                                  yellow: theme.colors[1],
                                })
                              }
                            >
                              <span className="theme-option-label">{t(`theme.${theme.key}`)}</span>
                              <span className="theme-option-chips" aria-hidden="true">
                                {theme.colors.map((id) => {
                                  const option = COLOR_OPTION_BY_ID.get(id)
                                  if (!option) {
                                    return null
                                  }
                                  return (
                                    <span
                                      key={option.id}
                                      className="theme-preview-chip"
                                      style={{ background: option.hex }}
                                    />
                                  )
                                })}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="theme-assignment">
                      <div className="theme-assignment-item">
                        <span className="theme-assignment-label">
                          {pendingMode === 'online'
                            ? t('setup.hostColor')
                            : pendingMode === 'cpu'
                              ? pendingCpuMatchType === 'cpu_vs_cpu'
                                ? t('setup.cpu1Color')
                                : t('setup.yourColor')
                              : t('setup.player1Color')}
                        </span>
                        <span
                          className="theme-assignment-chip"
                          style={{ background: (COLOR_OPTION_BY_ID.get(pendingColors.blue)?.hex ?? '#000000') }}
                          aria-hidden="true"
                        />
                        <span className="theme-assignment-name">{colorLabel(pendingColors.blue)}</span>
                      </div>
                      <button
                        type="button"
                        className="theme-swap-button"
                        onClick={() => setPendingColors((prev) => ({ blue: prev.yellow, yellow: prev.blue }))}
                        aria-label={t('setup.swap')}
                        title={t('setup.swap')}
                      >
                        ⇄
                      </button>
                      <div className="theme-assignment-item">
                        <span className="theme-assignment-label">
                          {pendingMode === 'online'
                            ? t('setup.guestColor')
                            : pendingMode === 'cpu'
                              ? pendingCpuMatchType === 'cpu_vs_cpu'
                                ? t('setup.cpu2Color')
                                : t('setup.cpuColor')
                              : t('setup.player2Color')}
                        </span>
                        <span
                          className="theme-assignment-chip"
                          style={{ background: (COLOR_OPTION_BY_ID.get(pendingColors.yellow)?.hex ?? '#000000') }}
                          aria-hidden="true"
                        />
                        <span className="theme-assignment-name">{colorLabel(pendingColors.yellow)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="setup-actions">
                  <button
                    type="button"
                    className="mode-option"
                    onClick={() => setSetupStep('mode')}
                  >
                    {t('action.back')}
                  </button>
                  <button
                    type="button"
                    className="start-button"
                    onClick={startWithColorSetup}
                    disabled={pendingColors.blue === pendingColors.yellow}
                  >
                    {pendingMode === 'online' ? t('action.createRoom') : t('action.startMatch')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  )
}

interface PlayerPanelProps {
  playerKey: PlayerColor
  playerLabel: string
  colorHex: string
  colorSoft: string
  remaining: number
  isTurn: boolean
  isWinner: boolean
  isThinking: boolean
  thinkingLabel: string
  winnerLabel: string
  turnLabel: string
}

interface OnlineMockPanelProps {
  t: (key: string) => string
  phase: OnlinePhase
  roomCode: string
  roomInput: string
  waitMessage: string
  errorMessage: string
  createColors: PlayerColorConfig
  role: PlayerColor | null
  isHost: boolean
  connectionState: OnlineConnectionState
  syncState: OnlineSyncState
  onInputRoomCode: (value: string) => void
  onConfirmJoin: () => void
  onBackToCreateSetup: () => void
  onBackFromJoinOrError: () => void
  onCancelWaiting: () => void
}

function OnlineMockPanel({
  t,
  phase,
  roomCode,
  roomInput,
  waitMessage,
  errorMessage,
  createColors,
  role,
  isHost,
  connectionState,
  syncState,
  onInputRoomCode,
  onConfirmJoin,
  onBackToCreateSetup,
  onBackFromJoinOrError,
  onCancelWaiting,
}: OnlineMockPanelProps) {
  const [copyFeedback, setCopyFeedback] = useState('')

  function handleCopyRoomCode(): void {
    if (!roomCode) {
      return
    }

    if (!navigator.clipboard?.writeText) {
      setCopyFeedback(t('online.copyFeedbackUnavailable'))
      return
    }

    navigator.clipboard
      .writeText(roomCode)
      .then(() => {
        setCopyFeedback(t('online.copyFeedbackCopied'))
      })
      .catch(() => {
        setCopyFeedback(t('online.copyFeedbackFailed'))
      })
  }

  useEffect(() => {
    if (!copyFeedback) {
      return
    }
    const timeoutId = window.setTimeout(() => setCopyFeedback(''), 1400)
    return () => window.clearTimeout(timeoutId)
  }, [copyFeedback])

  return (
    <section className="setup-overlay online-setup-overlay" aria-label="online setup">
      <div className="setup-modal online-setup-modal">
        <div className="online-head">
          <h2>{t('online.title')}</h2>
          <p>{t('online.subtitle')}</p>
        </div>

        <div className="online-session-meta" aria-live="polite">
          <span>{t('online.you')}: {role === 'blue' ? 'Player 1' : role === 'yellow' ? 'Player 2' : t('status.notAssigned')}</span>
          <span>{isHost ? t('online.host') : t('online.guest')}</span>
          <span>
            {t('online.status')}:{' '}
            {connectionState === 'connected'
              ? t('status.connected')
              : connectionState === 'connecting'
                ? t('status.connecting')
                : connectionState === 'waiting'
                  ? t('status.waiting')
                  : t('status.disconnected')}
          </span>
          {syncState === 'submitting' ? <span>{t('status.sendingMove')}</span> : null}
        </div>

        <div className={['online-error-slot', errorMessage ? 'has-error' : ''].filter(Boolean).join(' ')} role="status" aria-live="polite">
          {errorMessage ? <span className="online-error-text">{errorMessage}</span> : null}
        </div>

        {phase === 'join' ? (
          <div className="online-section">
            <h3>{t('online.joinTitle')}</h3>
            <p className="online-waiting-copy">{t('online.joinDescription')}</p>
            <label className="online-input-wrap">
              <span>{t('online.roomCode')}</span>
              <input
                type="text"
                value={roomInput}
                onChange={(event) => onInputRoomCode(event.target.value)}
                placeholder={t('online.roomCodePlaceholder')}
                maxLength={12}
              />
            </label>
            <div className="online-actions">
              <button type="button" className="online-btn primary" onClick={onConfirmJoin}>
                {t('action.join')}
              </button>
              <button type="button" className="online-btn ghost" onClick={onBackFromJoinOrError}>
                {t('action.back')}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'waiting' ? (
          <div className="online-section">
            <h3>{t('online.waitingTitle')}</h3>
            <div className="waiting-room-code">
              <div className="waiting-room-code-head">{t('online.roomCode')}</div>
              <div className="waiting-room-code-main">
                <span className="waiting-room-code-value">{roomCode || t('online.roomCodeUnavailable')}</span>
                <button type="button" className="online-btn ghost copy" onClick={handleCopyRoomCode} disabled={!roomCode}>
                  {t('action.copy')}
                </button>
              </div>
              <div className="waiting-room-code-sub">{t('online.shareCode')}</div>
              {copyFeedback ? <div className="waiting-room-copy-feedback">{copyFeedback}</div> : null}
            </div>
            <p className="online-waiting-copy">{t('online.waitingDescription')}</p>
            <div className="online-status-list">
              <div className="online-status-item">
                {t('online.colors')}: {t('online.host')} {colorLabel(createColors.blue)} / {t('online.guest')} {colorLabel(createColors.yellow)}
              </div>
              <div className="online-status-item">{waitMessage}</div>
              <div className="online-status-item">
                {t('online.connection')}:{' '}
                {connectionState === 'connected'
                  ? t('status.connected')
                  : connectionState === 'connecting'
                    ? t('status.connecting')
                    : connectionState === 'waiting'
                      ? t('status.waiting')
                      : t('status.disconnected')}
              </div>
            </div>
            <div className="online-actions">
              <button type="button" className="online-btn ghost" onClick={onCancelWaiting}>
                {t('action.cancel')}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="online-section">
            <h3>{t('online.errorTitle')}</h3>
            <p className="online-waiting-copy">{t('online.errorDescription')}</p>
            <div className="online-actions">
              <button type="button" className="online-btn primary" onClick={onBackFromJoinOrError}>
                {t('action.back')}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'closed' ? (
          <div className="online-section">
            <h3>{t('online.roomClosedTitle')}</h3>
            <p className="online-waiting-copy">{waitMessage || t('online.hostLeftRoom')}</p>
            <div className="online-actions">
              <button type="button" className="online-btn primary" onClick={onBackToCreateSetup}>
                {t('action.createRoomAgain')}
              </button>
              <button type="button" className="online-btn ghost" onClick={onBackFromJoinOrError}>
                {t('action.joinAnotherRoom')}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'interrupted' ? (
          <div className="online-section">
            <h3>{t('online.matchInterruptedTitle')}</h3>
            <p className="online-waiting-copy">{waitMessage || t('online.opponentDisconnected')}</p>
            <div className="online-actions">
              <button type="button" className="online-btn primary" onClick={onBackFromJoinOrError}>
                {t('action.backToMenu')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function PlayerPanel({
  playerKey,
  playerLabel,
  colorHex,
  colorSoft,
  remaining,
  isTurn,
  isWinner,
  isThinking,
  thinkingLabel,
  winnerLabel,
  turnLabel,
}: PlayerPanelProps) {
  const percentage = Math.max(0, Math.min(100, (remaining / TOTAL_PIECES) * 100))
  const columns = Array.from({ length: 7 }, (_, col) => {
    const remainingInColumn = Math.max(0, Math.min(10, remaining - col * 10))
    return Array.from({ length: 10 }, (_, row) => ({
      key: `${col}-${row}`,
      filled: row >= 10 - remainingInColumn,
      zIndex: 20 - row,
    }))
  })

  return (
    <aside
      className={['player-panel', playerKey, isTurn ? 'is-turn' : '', isWinner ? 'is-winner' : ''].filter(Boolean).join(' ')}
      style={{ '--accent': colorHex, '--accent-soft': colorSoft } as CSSProperties}
    >
      <div className="panel-badges left">
        {isThinking ? <span className="state-badge thinking">{thinkingLabel}</span> : null}
      </div>
      <div className="panel-badges right">
        {isWinner ? <span className="state-badge winner">{winnerLabel}</span> : null}
        {!isWinner && isTurn ? <span className="state-badge turn">{turnLabel}</span> : null}
      </div>

      <div className="panel-head">
        <div className="player-name">{playerLabel}</div>
      </div>

      <div className="remaining-text">
        {remaining} / {TOTAL_PIECES}
      </div>

      <div className="remaining-stack-grid" aria-hidden="true">
        {columns.map((column, colIdx) => (
          <div className="stack-column" key={`col-${colIdx}`}>
            {column.map((cell) => (
              <span
                key={cell.key}
                className={['stack-piece', cell.filled ? 'filled' : 'empty'].join(' ')}
                style={{ zIndex: cell.zIndex }}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="remaining-mini-track" aria-hidden="true">
        <div className="remaining-mini-fill" style={{ width: `${percentage}%` }} />
      </div>
    </aside>
  )
}

function isDisplayColorId(value: unknown): value is DisplayColorId {
  return typeof value === 'string' && COLOR_OPTIONS.some((option) => option.id === value)
}

function colorLabel(id: DisplayColorId): string {
  const found = COLOR_OPTIONS.find((option) => option.id === id)
  return found ? found.label : id
}

function getThemeByAssignedColors(colors: PlayerColorConfig): ColorPairTheme | null {
  return (
    COLOR_PAIR_THEMES.find(
      (theme) =>
        (theme.colors[0] === colors.blue && theme.colors[1] === colors.yellow) ||
        (theme.colors[0] === colors.yellow && theme.colors[1] === colors.blue),
    ) ?? null
  )
}

function toMoveKey(level: number, row: number, col: number): string {
  return `${level}-${row}-${col}`
}

function getNextTurnNumber(
  isPlayback: boolean,
  playbackMoveCursor: number,
  playbackTotalMoves: number,
  completedMoves: number,
): number {
  if (isPlayback) {
    const maxTurn = Math.max(1, playbackTotalMoves + 1)
    return clamp(playbackMoveCursor + 1, 1, maxTurn)
  }
  return Math.max(1, completedMoves + 1)
}

function getPlaybackTurnPlayer(openingTurn: PlayerColor, completedMoves: number): PlayerColor {
  const normalizedMoves = Math.max(0, completedMoves)
  if (normalizedMoves % 2 === 0) {
    return openingTurn
  }
  return openingTurn === 'blue' ? 'yellow' : 'blue'
}

function getDebugOverlayMetricValue(candidate: HardMoveCandidate, mode: DebugOverlayMode): number {
  const b = candidate.breakdown
  if (mode === 'total') {
    return candidate.score
  }
  if (mode === 'immediateValue') {
    return b.immediateBaseValue
  }
  if (mode === 'patternGrowth') {
    return b.patternGrowth
  }
  if (mode === 'urgentThreatBlock') {
    return b.urgentThreatBlock
  }
  if (mode === 'opponentReplyRisk') {
    return -b.opponentReplyRisk
  }
  if (mode === 'selfReservedCompletionPenalty') {
    return -b.selfReservedCompletionPenalty
  }
  if (mode === 'chainBackfirePenalty') {
    return -b.chainBackfirePenalty
  }
  return b.endgameAdjustment
}

function resolveChainTone(chainCount: number): ChainTone {
  if (chainCount <= 3) {
    return 'cool'
  }
  if (chainCount === 4) {
    return 'violet'
  }
  if (chainCount === 5) {
    return 'magenta'
  }
  if (chainCount === 6) {
    return 'orange'
  }
  return 'hot'
}

function resolveChainAnchorPosition(moves: Move[]): { left: number; top: number } {
  if (moves.length === 0) {
    return { left: 50, top: 22 }
  }

  let sumLeft = 0
  let sumTop = 0
  for (const move of moves) {
    const point = moveToBoardPercent(move.level, move.row, move.col)
    sumLeft += point.left
    sumTop += point.top
  }

  const avgLeft = sumLeft / moves.length
  const avgTop = sumTop / moves.length

  return {
    left: clamp(avgLeft, 10, 90),
    top: clamp(avgTop - 2.8, 12, 92),
  }
}

function moveToBoardPercent(level: number, row: number, col: number): { left: number; top: number } {
  const x = col * BASE_SPACING + level * (BASE_SPACING / 2)
  const y = row * BASE_SPACING + level * (BASE_SPACING / 2)
  const normalizedX = x / MAX_COORDINATE
  const normalizedY = y / MAX_COORDINATE
  return {
    left: TOKEN_INSET_PERCENT + normalizedX * (100 - TOKEN_INSET_PERCENT * 2),
    top: TOKEN_INSET_PERCENT + normalizedY * (100 - TOKEN_INSET_PERCENT * 2),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((v) => v + v)
          .join('')
      : normalized

  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    board: state.board.map((levelRows) =>
      levelRows.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
    ),
    remaining: { ...state.remaining },
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastAutoPlacements: state.lastAutoPlacements.map((item) => ({ ...item })),
  }
}

function cloneMatchRecord(record: MatchRecord): MatchRecord {
  return {
    players: { ...record.players },
    moves: record.moves.map((move) => ({
      ...move,
      manual: { ...move.manual },
      autoPlacements: move.autoPlacements.map((item) => ({ ...item })),
    })),
    winner: record.winner,
  }
}

function cpuDifficultyLabel(difficulty: CpuDifficulty, language: AppLanguage): string {
  if (difficulty === 'hard') {
    return translate(language, 'mode.hard')
  }
  if (difficulty === 'normal') {
    return translate(language, 'mode.normal')
  }
  return translate(language, 'mode.easy')
}

function hardEndgamePhaseLabel(phase: 'normal' | 'endgame' | 'late_endgame'): string {
  if (phase === 'late_endgame') {
    return 'Late Endgame'
  }
  if (phase === 'endgame') {
    return 'Endgame'
  }
  return 'Normal'
}

function winnerHeadline(
  winner: PlayerColor,
  mode: MatchMode,
  onlineRole: PlayerColor | null,
  cpuMatchType: CpuMatchType,
  language: AppLanguage,
): string {
  if (mode === 'cpu') {
    if (cpuMatchType === 'cpu_vs_cpu') {
      return winner === 'blue' ? translate(language, 'winner.cpu1Wins') : translate(language, 'winner.cpu2Wins')
    }
    return winner === 'blue' ? translate(language, 'winner.youWin') : translate(language, 'winner.youLose')
  }
  if (mode === 'online') {
    return winner === onlineRole ? translate(language, 'winner.youWin') : translate(language, 'winner.youLose')
  }
  return winner === 'blue' ? translate(language, 'winner.player1Wins') : translate(language, 'winner.player2Wins')
}
