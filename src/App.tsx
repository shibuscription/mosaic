import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BASE_SIZE, MAX_LEVEL, TOTAL_PIECES, type AutoPlacement, type GameState, type Move, type PlayerColor } from './game/types'
import { createInitialGameState, getLegalMoves, getLevelSize, getPiece, placeManualPiece } from './game/logic'
import { chooseCpuMove, type CpuDifficulty } from './game/cpu'
import { FinalBoard3DModal } from './components/FinalBoard3DModal'
import { isFirebaseConfigured } from './firebase'
import {
  RoomError,
  createRoom,
  joinRoom,
  normalizeRoomCode,
  submitRoomMove,
  subscribeRoom,
  type RoomDoc,
  deserializeGameState,
} from './online/room'
import './style.css'

type DisplayColorId =
  | 'blue'
  | 'yellow'
  | 'red'
  | 'green'
  | 'orange'
  | 'purple'
  | 'pink'
  | 'brown'
  | 'cyan'
  | 'lime'

interface ColorOption {
  id: DisplayColorId
  label: string
  hex: string
}

interface PlayerColorConfig {
  blue: DisplayColorId
  yellow: DisplayColorId
}
type MatchMode = 'pvp' | 'cpu' | 'online'
type SetupStep = 'mode' | 'color'
type OnlineEntryAction = 'create' | 'join' | null
type MobilePanelMode = 'standard' | 'faceoff'
type OnlinePhase = 'create' | 'join' | 'waiting' | 'playing' | 'error' | 'finished'
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

const COLOR_OPTIONS: ColorOption[] = [
  { id: 'blue', label: 'Royal Blue', hex: '#2563eb' },
  { id: 'cyan', label: 'Pastel Sky', hex: '#8ecae6' },
  { id: 'yellow', label: 'Cream Yellow', hex: '#ffe08a' },
  { id: 'red', label: 'Coral', hex: '#ff6f61' },
  { id: 'pink', label: 'Pastel Pink', hex: '#f4a8c8' },
  { id: 'green', label: 'Mint', hex: '#7bdcb5' },
  { id: 'lime', label: 'Olive', hex: '#7a8f3a' },
  { id: 'purple', label: 'Lavender', hex: '#b39ddb' },
  { id: 'orange', label: 'Deep Violet', hex: '#5b2a86' },
  { id: 'brown', label: 'Walnut', hex: '#7b5e57' },
]

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
const INITIAL_ONLINE_SESSION: OnlineSessionState = {
  phase: 'create',
  roomCode: '',
  roomInput: '',
  role: null,
  isHost: false,
  connectionState: 'idle',
  syncState: 'idle',
  errorMessage: '',
  waitMessage: 'Waiting for opponent...',
  createColors: { blue: 'blue', yellow: 'yellow' },
}

export default function App() {
  const initialGame = useMemo(() => createInitialGameState(), [])
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
  const [playerColors, setPlayerColors] = useState<PlayerColorConfig>({ blue: 'blue', yellow: 'yellow' })
  const [pendingColors, setPendingColors] = useState<PlayerColorConfig>({ blue: 'blue', yellow: 'yellow' })
  const [matchMode, setMatchMode] = useState<MatchMode>('pvp')
  const [pendingMode, setPendingMode] = useState<MatchMode>('pvp')
  const [pendingOnlineAction, setPendingOnlineAction] = useState<OnlineEntryAction>(null)
  const [cpuDifficulty, setCpuDifficulty] = useState<CpuDifficulty>('easy')
  const [pendingCpuDifficulty, setPendingCpuDifficulty] = useState<CpuDifficulty>('easy')
  const [onlineSession, setOnlineSession] = useState<OnlineSessionState>(INITIAL_ONLINE_SESSION)

  const [soundOn, setSoundOn] = useState(true)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isPlayback, setIsPlayback] = useState(false)
  const [is3DOpen, setIs3DOpen] = useState(false)
  const [winnerModalVisible, setWinnerModalVisible] = useState(false)
  const [isCpuThinking, setIsCpuThinking] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
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
    players: { blue: 'blue', yellow: 'yellow' },
    moves: [],
    winner: null,
  })
  const [history, setHistory] = useState<UndoSnapshot[]>([
    {
      game: cloneGameState(initialGame),
      matchRecord: cloneMatchRecord({
        players: { blue: 'blue', yellow: 'yellow' },
        moves: [],
        winner: null,
      }),
    },
  ])

  const boardStageRef = useRef<HTMLElement | null>(null)
  const mobileMenuRef = useRef<HTMLDivElement | null>(null)
  const timeoutIdsRef = useRef<number[]>([])
  const cpuTimeoutRef = useRef<number | null>(null)
  const onlineRoomUnsubRef = useRef<(() => void) | null>(null)
  const onlineLastMoveSignatureRef = useRef<string | null>(null)
  const gameRef = useRef<GameState>(initialGame)
  const matchRecordRef = useRef<MatchRecord>({
    players: { blue: 'blue', yellow: 'yellow' },
    moves: [],
    winner: null,
  })
  const historyRef = useRef<UndoSnapshot[]>([
    {
      game: cloneGameState(initialGame),
      matchRecord: cloneMatchRecord({
        players: { blue: 'blue', yellow: 'yellow' },
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
  const isOnlineMode = matchMode === 'online'
  const isOnlineMyTurn = isOnlineMode && onlineSession.role === game.currentTurn
  const isOnlineMockView =
    !setupOpen && isOnlineMode && onlineSession.phase !== 'playing' && onlineSession.phase !== 'finished'

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

  useEffect(() => {
    const stage = boardStageRef.current
    if (!stage) {
      return
    }

    const updateBoardSize = () => {
      const rect = stage.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth
      const mobileHorizontalPadding = 12
      const availableWidth = Math.min(stage.clientWidth, viewportWidth - mobileHorizontalPadding)
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
      clearCpuTimer()
      stopOnlineRoomSubscription()
      audioCtxRef.current?.close().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    clearCpuTimer()
    if (
      setupOpen ||
      isAnimating ||
      isPlayback ||
      is3DOpen ||
      game.winner ||
      matchMode !== 'cpu' ||
      game.currentTurn !== 'yellow'
    ) {
      setIsCpuThinking(false)
      return
    }

    setIsCpuThinking(true)
    const delayMs = 700 + Math.floor(Math.random() * 301)
    cpuTimeoutRef.current = window.setTimeout(() => {
      setIsCpuThinking(false)
      const cpuMove = chooseCpuMove(game, 'yellow', cpuDifficulty)
      if (!cpuMove) {
        return
      }
      commitMoveByMode(cpuMove.level, cpuMove.row, cpuMove.col)
    }, delayMs)

    return () => {
      clearCpuTimer()
    }
  }, [cpuDifficulty, game, is3DOpen, isAnimating, isPlayback, matchMode, setupOpen])

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

  function handleLocalMoveCommit(level: number, row: number, col: number): void {
    const actor = game.currentTurn
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
        errorMessage: mapRoomErrorMessage(error, 'Failed to submit move.'),
      }))
    }
  }

  function commitMoveByMode(level: number, row: number, col: number): void {
    clearCpuTimer()
    setIsCpuThinking(false)

    if (setupOpen || isAnimating || isPlayback || is3DOpen || game.winner) {
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
    if (matchMode === 'online' && onlineSession.phase !== 'playing' && onlineSession.phase !== 'finished') {
      return
    }
    if (matchMode === 'cpu' && game.currentTurn === 'yellow') {
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
      blue: isDisplayColorId(room.playerColors?.blue) ? room.playerColors.blue : 'blue',
      yellow: isDisplayColorId(room.playerColors?.yellow) ? room.playerColors.yellow : 'yellow',
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
      if (room.status === 'finished') {
        nextPhase = 'finished'
      } else if (room.status === 'playing') {
        nextPhase = 'playing'
      } else if (room.status === 'waiting' && prev.phase !== 'create') {
        nextPhase = 'waiting'
      }

      return {
        ...prev,
        roomCode: room.roomCode,
        phase: nextPhase,
        connectionState: room.status === 'waiting' ? 'waiting' : 'connected',
        waitMessage:
          room.status === 'waiting'
            ? 'Waiting for opponent...'
            : room.status === 'playing'
              ? 'Match is in progress.'
              : 'Match finished.',
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
            errorMessage: 'Room no longer exists.',
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
          errorMessage: mapRoomErrorMessage(error, 'Failed to subscribe room updates.'),
          syncState: 'idle',
        }))
      },
    )
  }

  function beginOnlineCreate(): void {
    setOnlineSession((prev) => ({
      ...prev,
      phase: 'create',
      roomCode: '',
      roomInput: '',
      role: 'blue',
      isHost: true,
      connectionState: 'idle',
      errorMessage: '',
      waitMessage: 'Set colors and create a room.',
      createColors: { ...playerColors },
    }))
  }

  async function submitOnlineCreateRoom(): Promise<void> {
    if (!isFirebaseConfigured()) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'error',
        connectionState: 'disconnected',
        errorMessage: 'Firebase config is missing. Set VITE_FIREBASE_* variables.',
      }))
      return
    }

    if (onlineSession.createColors.blue === onlineSession.createColors.yellow) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'create',
        errorMessage: 'Player 1 and Player 2 must use different colors.',
      }))
      return
    }

    setOnlineSession((prev) => ({
      ...prev,
      connectionState: 'connecting',
      errorMessage: '',
      waitMessage: 'Creating room...',
    }))

    try {
      const { roomCode } = await createRoom({
        blue: onlineSession.createColors.blue,
        yellow: onlineSession.createColors.yellow,
      })
      startOnlineRoomSubscription(roomCode)
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'waiting',
        roomCode,
        role: 'blue',
        isHost: true,
        connectionState: 'waiting',
        waitMessage: 'Waiting for opponent...',
        errorMessage: '',
      }))
      setPlayerColors({ ...onlineSession.createColors })
    } catch (error) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'error',
        connectionState: 'disconnected',
        errorMessage: mapRoomErrorMessage(error, 'Failed to create room.'),
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
      waitMessage: 'Joined. Waiting for host to start...',
    }))
  }

  async function confirmOnlineJoin(): Promise<void> {
    if (!isFirebaseConfigured()) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'error',
        connectionState: 'disconnected',
        errorMessage: 'Firebase config is missing. Set VITE_FIREBASE_* variables.',
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
        waitMessage: 'Joined. Waiting for match start...',
      }))
    } catch (error) {
      setOnlineSession((prev) => ({
        ...prev,
        phase: 'error',
        connectionState: 'disconnected',
        errorMessage: mapRoomErrorMessage(error, 'Failed to join room.'),
      }))
    }
  }

  function openSetup(): void {
    clearAnimationTimers()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setIs3DOpen(false)
    setWinnerModalVisible(false)
    setIsCpuThinking(false)
    setIsMobileMenuOpen(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    setDisplayRemaining({ ...game.remaining })
    setPendingColors(playerColors)
    setPendingMode(matchMode)
    setPendingOnlineAction(null)
    setPendingCpuDifficulty(cpuDifficulty)
    resetOnlineSessionState()
    setSetupStep('mode')
    setSetupOpen(true)
  }

  function openSetupForOnline(action: OnlineEntryAction): void {
    openSetup()
    setPendingMode('online')
    setPendingOnlineAction(action)
  }

  function prepareFreshMatch(nextColors: PlayerColorConfig, nextMode: MatchMode): void {
    if (nextColors.blue === nextColors.yellow) {
      return
    }
    stopOnlineRoomSubscription()
    clearAnimationTimers()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setIs3DOpen(false)
    setIsCpuThinking(false)
    setIsMobileMenuOpen(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    lastWinnerRef.current = null
    setPlayerColors(nextColors)
    setMatchMode(nextMode)
    setCpuDifficulty(pendingCpuDifficulty)
    resetOnlineSessionState()
    const freshGame = createInitialGameState()
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
      prepareFreshMatch(playerColors, 'online')
      setSetupOpen(false)
      setSetupStep('mode')
      setOnlineSession({
        ...INITIAL_ONLINE_SESSION,
        createColors: { ...playerColors },
      })
      if (pendingOnlineAction === 'create') {
        beginOnlineCreate()
      } else if (pendingOnlineAction === 'join') {
        beginOnlineJoin()
      }
      setPendingOnlineAction(null)
      return
    }
    setPendingColors(playerColors)
    setSetupStep('color')
  }

  function startWithColorSetup(): void {
    if (pendingColors.blue === pendingColors.yellow) {
      return
    }
    prepareFreshMatch(pendingColors, pendingMode)
    setSetupOpen(false)
    setSetupStep('mode')
    setPendingOnlineAction(null)
  }

  function handlePlayback(): void {
    if (matchRecord.moves.length === 0 || isPlayback) {
      return
    }

    clearAnimationTimers()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(true)
    setIs3DOpen(false)
    setWinnerModalVisible(false)
    setIsCpuThinking(false)
    setIsMobileMenuOpen(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    lastWinnerRef.current = null

    const initial = createInitialGameState()
    setGame(initial)
    setDisplayRemaining({ ...initial.remaining })

    const startId = window.setTimeout(() => {
      runPlaybackMove(0, initial)
    }, 80)
    timeoutIdsRef.current.push(startId)
  }

  function handleUndo(): void {
    if (matchMode === 'online' || history.length <= 1 || isAnimating || isPlayback || setupOpen) {
      return
    }

    clearAnimationTimers()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setIs3DOpen(false)
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

  function runPlaybackMove(index: number, stateAtTurnStart: ReturnType<typeof createInitialGameState>): void {
    if (index >= matchRecord.moves.length) {
      setIsPlayback(false)
      return
    }

    const record = matchRecord.moves[index]
    const resolved = placeManualPiece(
      stateAtTurnStart,
      record.manual.level,
      record.manual.row,
      record.manual.col,
    )

    startResolvedAnimation(resolved, stateAtTurnStart.remaining, PLAYBACK_MANUAL_MS, PLAYBACK_AUTO_MS, () => {
      const id = window.setTimeout(() => {
        runPlaybackMove(index + 1, resolved)
      }, PLAYBACK_GAP_MS)
      timeoutIdsRef.current.push(id)
    })
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
            <span className="left-label">{matchMode === 'cpu' ? 'CPU' : matchMode === 'online' ? 'ONLINE' : '2P'} {leftPercent}%</span>
            <span className="right-label">{rightPercent}% 1P</span>
          </div>
          <div className="advantage-track">
            <div className="advantage-left" style={{ width: `${leftPercent}%` }} />
            <div className="advantage-divider" />
          </div>
        </section>
      ) : null}

      <div className="mini-title">Mosaic</div>

      {isOnlineMockView ? (
        <OnlineMockPanel
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
          onSelectCreateColor={(player, id) =>
            setOnlineSession((prev) => ({
              ...prev,
              createColors: {
                ...prev.createColors,
                [player]: id,
              },
            }))
          }
          onCreateRoom={() => {
            void submitOnlineCreateRoom()
          }}
          onConfirmJoin={() => {
            void confirmOnlineJoin()
          }}
          onBackFromCreate={() => {
            stopOnlineRoomSubscription()
            openSetupForOnline('create')
          }}
          onBackFromJoinOrError={() => {
            stopOnlineRoomSubscription()
            openSetupForOnline('join')
          }}
          onCancelWaiting={() => {
            stopOnlineRoomSubscription()
            setOnlineSession((prev) => ({
              ...prev,
              phase: 'create',
              roomCode: '',
              connectionState: 'idle',
              syncState: 'idle',
              waitMessage: 'Set colors and create a room.',
              errorMessage: '',
            }))
          }}
        />
      ) : (
      <section className="table-layout">
        <PlayerPanel
          playerKey="yellow"
          playerLabel={
            matchMode === 'cpu'
              ? `CPU (${cpuDifficultyLabel(cpuDifficulty)})`
              : matchMode === 'online'
                ? onlineSession.role === 'yellow'
                  ? 'Player 2 (You)'
                  : 'Player 2'
                : INTERNAL_LABEL.yellow
          }
          colorHex={yellowTheme.hex}
          colorSoft={hexToRgba(yellowTheme.hex, 0.28)}
          remaining={displayRemaining.yellow}
          isTurn={!game.winner && game.currentTurn === 'yellow'}
          isWinner={game.winner === 'yellow'}
          isThinking={matchMode === 'cpu' && !game.winner && game.currentTurn === 'yellow' && isCpuThinking}
        />

        <section className="board-stage" aria-label="mosaic board" ref={boardStageRef}>
          <div className="board-wrap" style={{ width: `${boardSize}px`, height: `${boardSize}px` }}>
            <div className="board">
              {positions.map((cell) => {
                if (!cell.pieceColor && !cell.legal) {
                  return null
                }

                const visualZ = 10 + cell.level * 10 + (cell.pieceColor ? 1 : 0)
                const hitZ = 200 + cell.level

                return (
                  <div key={cell.key}>
                    {cell.legal &&
                    !game.winner &&
                    !cell.pieceColor &&
                    !setupOpen &&
                    !isAnimating &&
                    (!isOnlineMode || isOnlineMyTurn) ? (
                      <button
                        className="token-hit"
                        data-turn={game.currentTurn}
                        style={{ left: `${cell.left}%`, top: `${cell.top}%`, zIndex: `${hitZ}` }}
                        onClick={() => onCellClick(cell.level, cell.row, cell.col)}
                        type="button"
                        aria-label={`L${cell.level} row ${cell.row + 1} col ${cell.col + 1}`}
                      />
                    ) : null}

                    <div
                      className={[
                        'token-visual',
                        cell.pieceColor ? 'filled' : 'empty legal',
                        cell.isLastMove ? 'last-move' : '',
                        cell.isAnimatingSpawn ? 'appear' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ left: `${cell.left}%`, top: `${cell.top}%`, zIndex: `${visualZ}` }}
                    >
                      {cell.pieceColor ? <span className={`piece ${cell.pieceColor}`} /> : <span className="guide" />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
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
            matchMode === 'online'
              ? onlineSession.role === 'blue'
                ? 'Player 1 (You)'
                : 'Player 1'
              : INTERNAL_LABEL.blue
          }
          colorHex={blueTheme.hex}
          colorSoft={hexToRgba(blueTheme.hex, 0.28)}
          remaining={displayRemaining.blue}
          isTurn={!game.winner && game.currentTurn === 'blue'}
          isWinner={game.winner === 'blue'}
          isThinking={false}
        />
      </section>
      )}

      {!isOnlineMockView ? (
      <div className="mobile-menu" ref={mobileMenuRef}>
        <button
          type="button"
          className="mobile-menu-toggle"
          aria-label="Open menu"
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
        {isMobileMenuOpen ? (
          <div className="mobile-menu-panel" role="menu" aria-label="Quick actions">
            <div className="mobile-menu-group">
              <div className="mobile-menu-group-title">Info Panel</div>
              <div className="mobile-menu-segment" role="radiogroup" aria-label="info panel mode">
                <button
                  type="button"
                  className={['mobile-segment-btn', mobilePanelMode === 'standard' ? 'selected' : ''].filter(Boolean).join(' ')}
                  aria-pressed={mobilePanelMode === 'standard'}
                  onClick={() => setMobilePanelMode('standard')}
                >
                  Standard
                </button>
                <button
                  type="button"
                  className={['mobile-segment-btn', mobilePanelMode === 'faceoff' ? 'selected' : ''].filter(Boolean).join(' ')}
                  aria-pressed={mobilePanelMode === 'faceoff'}
                  onClick={() => setMobilePanelMode('faceoff')}
                >
                  Face-off
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
              Sound: {soundOn ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              role="menuitem"
              className="mobile-menu-item"
              onClick={handleUndo}
              disabled={matchMode === 'online' || history.length <= 1 || isAnimating || isPlayback || setupOpen || isCpuThinking}
            >
              Undo
            </button>
            <button
              type="button"
              role="menuitem"
              className="mobile-menu-item danger"
              onClick={openSetup}
            >
              Reset
            </button>
          </div>
        ) : null}
      </div>
      ) : null}

      {!isOnlineMockView ? (
      <button type="button" className="sound-fixed" onClick={() => setSoundOn((prev) => !prev)}>
        Sound: {soundOn ? 'On' : 'Off'}
      </button>
      ) : null}
      {!isOnlineMockView ? (
      <button
        type="button"
        className="undo-fixed"
        onClick={handleUndo}
        disabled={matchMode === 'online' || history.length <= 1 || isAnimating || isPlayback || setupOpen || isCpuThinking}
      >
        Undo
      </button>
      ) : null}
      {!isOnlineMockView ? (
      <button type="button" className="reset-fixed" onClick={openSetup}>
        Reset
      </button>
      ) : null}
      {isPlayback ? <div className="playback-chip">Playback</div> : null}

      {game.winner && winnerModalVisible ? (
        <div className="winner-overlay" aria-live="polite">
          <div className="winner-card">
            <div className="winner-title">WINNER!</div>
            <div className="winner-name">{winnerLabel(game.winner, matchMode, cpuDifficulty, onlineSession.role)} Wins</div>
            <div className="winner-sub">Color: {colorById.get(playerColors[game.winner])?.label ?? playerColors[game.winner]}</div>
            <div className="winner-actions">
              <button type="button" className="winner-btn view3d" onClick={() => setIs3DOpen(true)}>
                3D View
              </button>
              <button type="button" className="winner-btn playback" onClick={handlePlayback}>
                Playback
              </button>
              <button type="button" className="winner-btn restart" onClick={openSetup}>
                Restart
              </button>
            </div>
            <div className="winner-sparkles" aria-hidden="true">
              {Array.from({ length: 14 }, (_, i) => (
                <span key={i} style={{ '--i': i } as CSSProperties} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {is3DOpen && game.winner ? (
        <FinalBoard3DModal
          board={game.board}
          moves={matchRecord.moves}
          colors={pieceColorMap}
          onManualSound={playManualSound}
          onAutoSound={playAutoSound}
          onClose={() => setIs3DOpen(false)}
        />
      ) : null}

      {setupOpen ? (
        <div className="setup-overlay" role="dialog" aria-modal="true">
          <div className="setup-modal">
            {setupStep === 'mode' ? (
              <>
                <h2>Game Setup</h2>
                <p>Choose how you want to play.</p>
                <div className="mode-row">
                  <div className="picker-label">Game Mode</div>
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
                      Local Match
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
                      CPU Match
                    </button>
                    <button
                      type="button"
                      className={['mode-option', pendingMode === 'online' ? 'selected' : ''].filter(Boolean).join(' ')}
                      onClick={() => setPendingMode('online')}
                      aria-pressed={pendingMode === 'online'}
                    >
                      Online Match
                    </button>
                  </div>
                </div>
                {pendingMode === 'cpu' ? (
                  <div className="mode-row">
                    <div className="picker-label">CPU Difficulty</div>
                    <div className="mode-options difficulty-options" role="radiogroup" aria-label="cpu difficulty">
                      <button
                        type="button"
                        className={['mode-option', pendingCpuDifficulty === 'easy' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingCpuDifficulty('easy')}
                        aria-pressed={pendingCpuDifficulty === 'easy'}
                      >
                        Easy
                      </button>
                      <button
                        type="button"
                        className={['mode-option', pendingCpuDifficulty === 'normal' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingCpuDifficulty('normal')}
                        aria-pressed={pendingCpuDifficulty === 'normal'}
                      >
                        Normal
                      </button>
                      <button
                        type="button"
                        className={['mode-option', pendingCpuDifficulty === 'hard' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingCpuDifficulty('hard')}
                        aria-pressed={pendingCpuDifficulty === 'hard'}
                      >
                        Hard
                      </button>
                    </div>
                  </div>
                ) : null}
                {pendingMode === 'online' ? (
                  <div className="mode-row">
                    <div className="picker-label">Online Action</div>
                    <div className="mode-options" role="radiogroup" aria-label="online action">
                      <button
                        type="button"
                        className={['mode-option', pendingOnlineAction === 'create' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingOnlineAction('create')}
                        aria-pressed={pendingOnlineAction === 'create'}
                      >
                        Create Room
                      </button>
                      <button
                        type="button"
                        className={['mode-option', pendingOnlineAction === 'join' ? 'selected' : ''].filter(Boolean).join(' ')}
                        onClick={() => setPendingOnlineAction('join')}
                        aria-pressed={pendingOnlineAction === 'join'}
                      >
                        Join Room
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
                  Continue
                </button>
              </>
            ) : (
              <>
                <h2>Color Setup</h2>
                <p>Choose colors for Player 1 and Player 2.</p>

                <ColorPickerRow
                  label={pendingMode === 'cpu' ? 'Player 1 (You)' : 'Player 1'}
                  selected={pendingColors.blue}
                  blocked={pendingColors.yellow}
                  onSelect={(id) => setPendingColors((prev) => ({ ...prev, blue: id }))}
                />

                <ColorPickerRow
                  label={pendingMode === 'cpu' ? 'Player 2 (CPU)' : 'Player 2'}
                  selected={pendingColors.yellow}
                  blocked={pendingColors.blue}
                  onSelect={(id) => setPendingColors((prev) => ({ ...prev, yellow: id }))}
                />

                <div className="setup-actions">
                  <button
                    type="button"
                    className="mode-option"
                    onClick={() => setSetupStep('mode')}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="start-button"
                    onClick={startWithColorSetup}
                    disabled={pendingColors.blue === pendingColors.yellow}
                  >
                    Start Match
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
}

interface OnlineMockPanelProps {
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
  onSelectCreateColor: (player: PlayerColor, id: DisplayColorId) => void
  onCreateRoom: () => void
  onConfirmJoin: () => void
  onBackFromCreate: () => void
  onBackFromJoinOrError: () => void
  onCancelWaiting: () => void
}

function OnlineMockPanel({
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
  onSelectCreateColor,
  onCreateRoom,
  onConfirmJoin,
  onBackFromCreate,
  onBackFromJoinOrError,
  onCancelWaiting,
}: OnlineMockPanelProps) {
  const [copyFeedback, setCopyFeedback] = useState('')

  function handleCopyRoomCode(): void {
    if (!roomCode) {
      return
    }

    if (!navigator.clipboard?.writeText) {
      setCopyFeedback('Clipboard unavailable.')
      return
    }

    navigator.clipboard
      .writeText(roomCode)
      .then(() => {
        setCopyFeedback('Copied!')
      })
      .catch(() => {
        setCopyFeedback('Copy failed.')
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
    <section className="online-shell" aria-label="online mock">
      <div className="online-card">
        <div className="online-head">
          <h2>Online Match</h2>
          <p>Private room battle for two players.</p>
        </div>

        <div className="online-session-meta" aria-live="polite">
          <span>You: {role === 'blue' ? 'Player 1' : role === 'yellow' ? 'Player 2' : 'Not assigned'}</span>
          <span>{isHost ? 'Host' : 'Guest'}</span>
          <span>Status: {connectionState === 'connected' ? 'Connected' : connectionState === 'connecting' ? 'Connecting...' : connectionState === 'waiting' ? 'Waiting...' : 'Disconnected'}</span>
          {syncState === 'submitting' ? <span>Sending move...</span> : null}
        </div>

        <div className={['online-error-slot', errorMessage ? 'has-error' : ''].filter(Boolean).join(' ')} role="status" aria-live="polite">
          {errorMessage ? <span className="online-error-text">{errorMessage}</span> : null}
        </div>

        {phase === 'create' ? (
          <div className="online-section">
            <h3>Create Room</h3>
            <p className="online-waiting-copy">Choose colors, then create a room.</p>
            <ColorPickerRow
              label="Player 1 Color"
              selected={createColors.blue}
              blocked={createColors.yellow}
              onSelect={(id) => onSelectCreateColor('blue', id)}
            />
            <ColorPickerRow
              label="Player 2 Color"
              selected={createColors.yellow}
              blocked={createColors.blue}
              onSelect={(id) => onSelectCreateColor('yellow', id)}
            />
            <div className="online-actions">
              <button
                type="button"
                className="online-btn primary"
                onClick={onCreateRoom}
                disabled={createColors.blue === createColors.yellow || connectionState === 'connecting'}
              >
                Create Room
              </button>
              <button type="button" className="online-btn ghost" onClick={onBackFromCreate}>
                Back
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'join' ? (
          <div className="online-section">
            <h3>Join Room</h3>
            <p className="online-waiting-copy">Enter a room code to join an existing match.</p>
            <label className="online-input-wrap">
              <span>Room Code</span>
              <input
                type="text"
                value={roomInput}
                onChange={(event) => onInputRoomCode(event.target.value)}
                placeholder="e.g. AB12CD"
                maxLength={12}
              />
            </label>
            <div className="online-actions">
              <button type="button" className="online-btn primary" onClick={onConfirmJoin}>
                Join
              </button>
              <button type="button" className="online-btn ghost" onClick={onBackFromJoinOrError}>
                Back
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'waiting' ? (
          <div className="online-section">
            <h3>Waiting Room</h3>
            <div className="waiting-room-code">
              <div className="waiting-room-code-head">Room Code</div>
              <div className="waiting-room-code-main">
                <span className="waiting-room-code-value">{roomCode || 'N/A'}</span>
                <button type="button" className="online-btn ghost copy" onClick={handleCopyRoomCode} disabled={!roomCode}>
                  Copy
                </button>
              </div>
              <div className="waiting-room-code-sub">Share this code with your opponent.</div>
              {copyFeedback ? <div className="waiting-room-copy-feedback">{copyFeedback}</div> : null}
            </div>
            <p className="online-waiting-copy">Waiting for opponent to join and start the match.</p>
            <div className="online-status-list">
              <div className="online-status-item">
                Colors: P1 {colorLabel(createColors.blue)} / P2 {colorLabel(createColors.yellow)}
              </div>
              <div className="online-status-item">{waitMessage}</div>
              <div className="online-status-item">Connection: {connectionState === 'connected' ? 'Connected' : connectionState === 'connecting' ? 'Connecting...' : connectionState === 'waiting' ? 'Waiting...' : 'Disconnected'}</div>
            </div>
            <div className="online-actions">
              <button type="button" className="online-btn ghost" onClick={onCancelWaiting}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="online-section">
            <h3>Error</h3>
            <p className="online-waiting-copy">Unable to continue this online match. Please try again.</p>
            <div className="online-actions">
              <button type="button" className="online-btn primary" onClick={onBackFromJoinOrError}>
                Back
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
        {isThinking ? <span className="state-badge thinking">THINKING</span> : null}
      </div>
      <div className="panel-badges right">
        {isWinner ? <span className="state-badge winner">WINNER</span> : null}
        {!isWinner && isTurn ? <span className="state-badge turn">TURN</span> : null}
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

interface ColorPickerRowProps {
  label: string
  selected: DisplayColorId
  blocked: DisplayColorId
  onSelect: (id: DisplayColorId) => void
}

function ColorPickerRow({ label, selected, blocked, onSelect }: ColorPickerRowProps) {
  return (
    <div className="picker-row">
      <div className="picker-label">{label}</div>
      <div className="chip-list">
        {COLOR_OPTIONS.map((option) => {
          const disabled = option.id === blocked && option.id !== selected
          return (
            <button
              key={option.id}
              type="button"
              className={['color-chip', selected === option.id ? 'selected' : ''].filter(Boolean).join(' ')}
              style={{ background: option.hex }}
              onClick={() => onSelect(option.id)}
              disabled={disabled}
              aria-label={`${label} color ${option.label}`}
              title={option.label}
            />
          )
        })}
      </div>
    </div>
  )
}

function isDisplayColorId(value: unknown): value is DisplayColorId {
  return typeof value === 'string' && COLOR_OPTIONS.some((option) => option.id === value)
}

function colorLabel(id: DisplayColorId): string {
  const found = COLOR_OPTIONS.find((option) => option.id === id)
  return found ? found.label : id
}

function toMoveKey(level: number, row: number, col: number): string {
  return `${level}-${row}-${col}`
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

function cpuDifficultyLabel(difficulty: CpuDifficulty): string {
  if (difficulty === 'hard') {
    return 'Hard'
  }
  if (difficulty === 'normal') {
    return 'Normal'
  }
  return 'Easy'
}

function winnerLabel(
  winner: PlayerColor,
  mode: MatchMode,
  difficulty: CpuDifficulty,
  onlineRole: PlayerColor | null,
): string {
  if (mode === 'cpu') {
    return winner === 'blue' ? 'Player 1' : `CPU (${cpuDifficultyLabel(difficulty)})`
  }
  if (mode === 'online') {
    if (winner === 'blue') {
      return onlineRole === 'blue' ? 'Player 1 (You)' : 'Player 1'
    }
    return onlineRole === 'yellow' ? 'Player 2 (You)' : 'Player 2'
  }
  return INTERNAL_LABEL[winner]
}
