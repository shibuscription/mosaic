import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BASE_SIZE, MAX_LEVEL, TOTAL_PIECES, type AutoPlacement, type GameState, type Move, type PlayerColor } from './game/types'
import { createInitialGameState, getLegalMoves, getLevelSize, getPiece, placeManualPiece } from './game/logic'
import { chooseCpuMove, type CpuDifficulty } from './game/cpu'
import { FinalBoard3DModal } from './components/FinalBoard3DModal'
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
type MatchMode = 'pvp' | 'cpu'

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
  blue: '1 Player',
  yellow: '2 Player',
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
  const [playerColors, setPlayerColors] = useState<PlayerColorConfig>({ blue: 'blue', yellow: 'yellow' })
  const [pendingColors, setPendingColors] = useState<PlayerColorConfig>({ blue: 'blue', yellow: 'yellow' })
  const [matchMode, setMatchMode] = useState<MatchMode>('pvp')
  const [pendingMode, setPendingMode] = useState<MatchMode>('pvp')
  const [cpuDifficulty, setCpuDifficulty] = useState<CpuDifficulty>('easy')
  const [pendingCpuDifficulty, setPendingCpuDifficulty] = useState<CpuDifficulty>('easy')

  const [soundOn, setSoundOn] = useState(true)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isPlayback, setIsPlayback] = useState(false)
  const [is3DOpen, setIs3DOpen] = useState(false)
  const [isCpuThinking, setIsCpuThinking] = useState(false)
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
  const timeoutIdsRef = useRef<number[]>([])
  const cpuTimeoutRef = useRef<number | null>(null)
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
  }, [])

  useEffect(() => {
    return () => {
      clearAnimationTimers()
      clearCpuTimer()
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
      executeMove(cpuMove.level, cpuMove.row, cpuMove.col)
    }, delayMs)

    return () => {
      clearCpuTimer()
    }
  }, [cpuDifficulty, game, is3DOpen, isAnimating, isPlayback, matchMode, setupOpen])

  useEffect(() => {
    if (!game.winner || game.winner === lastWinnerRef.current) {
      return
    }
    lastWinnerRef.current = game.winner
    playWinnerSound()
  }, [game.winner])

  useEffect(() => {
    if (!isAnimating && !isPlayback) {
      setDisplayRemaining({ ...game.remaining })
    }
  }, [game.remaining, isAnimating, isPlayback])

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

  function executeMove(level: number, row: number, col: number): void {
    clearCpuTimer()
    setIsCpuThinking(false)

    if (setupOpen || isAnimating || isPlayback || is3DOpen || game.winner) {
      return
    }

    const key = toMoveKey(level, row, col)
    if (!legalSet.has(key)) {
      return
    }

    const actor = game.currentTurn
    const nextState = placeManualPiece(game, level, row, col)
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

  function onCellClick(level: number, row: number, col: number): void {
    if (setupOpen || isAnimating || isPlayback || isCpuThinking) {
      return
    }
    if (matchMode === 'cpu' && game.currentTurn === 'yellow') {
      return
    }
    executeMove(level, row, col)
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
    setGame(nextState)
    setDisplayRemaining({ ...startRemaining })

    const manual = nextState.lastMove
    if (!manual) {
      setIsAnimating(false)
      setAnimatingKey(null)
      setRevealedAutoCount(nextState.lastAutoPlacements.length)
      setDisplayRemaining({ ...nextState.remaining })
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

  function openSetup(): void {
    clearAnimationTimers()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setIs3DOpen(false)
    setIsCpuThinking(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    setDisplayRemaining({ ...game.remaining })
    setPendingColors(playerColors)
    setPendingMode(matchMode)
    setPendingCpuDifficulty(cpuDifficulty)
    setSetupOpen(true)
  }

  function startWithSelectedColors(): void {
    if (pendingColors.blue === pendingColors.yellow) {
      return
    }
    clearAnimationTimers()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setIs3DOpen(false)
    setIsCpuThinking(false)
    setAnimatingKey(null)
    setRevealedAutoCount(0)
    lastWinnerRef.current = null
    setPlayerColors(pendingColors)
    setMatchMode(pendingMode)
    setCpuDifficulty(pendingCpuDifficulty)
    const freshGame = createInitialGameState()
    const freshRecord = {
      players: pendingColors,
      moves: [],
      winner: null,
    } satisfies MatchRecord
    setGame(freshGame)
    setDisplayRemaining({ ...freshGame.remaining })
    setMatchRecord(freshRecord)
    setHistory([{ game: cloneGameState(freshGame), matchRecord: cloneMatchRecord(freshRecord) }])
    setSetupOpen(false)
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
    setIsCpuThinking(false)
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
    if (history.length <= 1 || isAnimating || isPlayback || setupOpen) {
      return
    }

    clearAnimationTimers()
    clearCpuTimer()
    setIsAnimating(false)
    setIsPlayback(false)
    setIs3DOpen(false)
    setIsCpuThinking(false)
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
    <main className="page" style={themeStyle}>
      <div className="mini-title">Mosaic</div>

      <section className="table-layout">
        <PlayerPanel
          playerKey="yellow"
          playerLabel={matchMode === 'cpu' ? `${INTERNAL_LABEL.yellow} (CPU)` : INTERNAL_LABEL.yellow}
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
                    {cell.legal && !game.winner && !cell.pieceColor && !setupOpen && !isAnimating ? (
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
        </section>

        <PlayerPanel
          playerKey="blue"
          playerLabel={INTERNAL_LABEL.blue}
          colorHex={blueTheme.hex}
          colorSoft={hexToRgba(blueTheme.hex, 0.28)}
          remaining={displayRemaining.blue}
          isTurn={!game.winner && game.currentTurn === 'blue'}
          isWinner={game.winner === 'blue'}
          isThinking={false}
        />
      </section>

      <button type="button" className="sound-fixed" onClick={() => setSoundOn((prev) => !prev)}>
        Sound: {soundOn ? 'On' : 'Off'}
      </button>
      <button
        type="button"
        className="undo-fixed"
        onClick={handleUndo}
        disabled={history.length <= 1 || isAnimating || isPlayback || setupOpen || isCpuThinking}
      >
        Undo
      </button>
      <button type="button" className="reset-fixed" onClick={openSetup}>
        Reset
      </button>
      {isPlayback ? <div className="playback-chip">Playback</div> : null}

      {game.winner ? (
        <div className="winner-overlay" aria-live="polite">
          <div className="winner-card">
            <div className="winner-title">WINNER!</div>
            <div className="winner-name">{INTERNAL_LABEL[game.winner]} Wins</div>
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
        <FinalBoard3DModal board={game.board} colors={pieceColorMap} onClose={() => setIs3DOpen(false)} />
      ) : null}

      {setupOpen ? (
        <div className="setup-overlay" role="dialog" aria-modal="true">
          <div className="setup-modal">
            <h2>Player Colors</h2>
            <p>Pick colors for 1P and 2P. Same color is not allowed.</p>
            <div className="mode-row">
              <div className="picker-label">Game Mode</div>
              <div className="mode-options" role="radiogroup" aria-label="game mode">
                <button
                  type="button"
                  className={['mode-option', pendingMode === 'pvp' ? 'selected' : ''].filter(Boolean).join(' ')}
                  onClick={() => setPendingMode('pvp')}
                  aria-pressed={pendingMode === 'pvp'}
                >
                  2 Player
                </button>
                <button
                  type="button"
                  className={['mode-option', pendingMode === 'cpu' ? 'selected' : ''].filter(Boolean).join(' ')}
                  onClick={() => setPendingMode('cpu')}
                  aria-pressed={pendingMode === 'cpu'}
                >
                  vs CPU
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

            <ColorPickerRow
              label="1 Player"
              selected={pendingColors.blue}
              blocked={pendingColors.yellow}
              onSelect={(id) => setPendingColors((prev) => ({ ...prev, blue: id }))}
            />

            <ColorPickerRow
              label="2 Player"
              selected={pendingColors.yellow}
              blocked={pendingColors.blue}
              onSelect={(id) => setPendingColors((prev) => ({ ...prev, yellow: id }))}
            />

            <button
              type="button"
              className="start-button"
              onClick={startWithSelectedColors}
              disabled={pendingColors.blue === pendingColors.yellow}
            >
              Start
            </button>
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

function PlayerPanel({ playerKey, playerLabel, colorHex, colorSoft, remaining, isTurn, isWinner, isThinking }: PlayerPanelProps) {
  const percentage = Math.max(0, Math.min(100, (remaining / TOTAL_PIECES) * 100))

  return (
    <aside
      className={['player-panel', playerKey, isTurn ? 'is-turn' : '', isWinner ? 'is-winner' : ''].filter(Boolean).join(' ')}
      style={{ '--accent': colorHex, '--accent-soft': colorSoft } as CSSProperties}
    >
      <div className="panel-topline">
        <div className="player-name">{playerLabel}</div>
        {isWinner ? <span className="state-badge winner">WINNER</span> : null}
        {!isWinner && isThinking ? <span className="state-badge thinking">Thinking...</span> : null}
        {!isWinner && isTurn && !isThinking ? <span className="state-badge turn">TURN</span> : null}
      </div>

      <div className="remaining-text">
        {remaining} / {TOTAL_PIECES}
      </div>

      <div className="remaining-bar" aria-hidden="true">
        <div className="remaining-fill" style={{ width: `${percentage}%` }} />
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
