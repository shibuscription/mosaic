import { normalizeBoardVariant, type AutoPlacement, type BoardVariant, type Move, type PlayerColor } from '../game/types'

export type MosaicRecordMode = 'pvp' | 'cpu' | 'online'

export interface MosaicRecordMove {
  turn: number
  player: PlayerColor
  manual: Move
  autoPlacements: AutoPlacement[]
}

export interface MosaicRecordV1 {
  format: 'mosaic-record'
  version: 1
  exportedAt: string
  mode: MosaicRecordMode
  boardVariant?: BoardVariant
  themeId: string | null
  playerColors: {
    blue: string
    yellow: string
  }
  openingTurn: PlayerColor
  moves: MosaicRecordMove[]
  winner: PlayerColor | null
  cpuSettings?: {
    matchType?: string
    cpuDifficulty?: string
    cpu1Difficulty?: string
    cpu2Difficulty?: string
  }
  onlinePlayers?: {
    role?: PlayerColor | null
    isHost?: boolean
  }
  appVersion?: string
}

export interface RecordParseResult {
  ok: boolean
  record?: MosaicRecordV1
  error?: string
}

export function createMosaicRecordFileName(mode: MosaicRecordMode, date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const modeName = mode === 'online' ? 'online' : mode === 'cpu' ? 'cpu' : 'local'
  return `mosaic-${modeName}-${y}-${m}-${d}-${hh}${mm}.mosaic`
}

export function downloadMosaicRecord(record: MosaicRecordV1, fileName?: string): void {
  const json = JSON.stringify(record, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName ?? createMosaicRecordFileName(record.mode)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function parseMosaicRecord(jsonText: string): RecordParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'invalid-root' }
  }

  if (parsed.format !== 'mosaic-record') {
    return { ok: false, error: 'invalid-format' }
  }

  if (parsed.version !== 1) {
    return { ok: false, error: 'invalid-version' }
  }

  if (!isMosaicRecordMode(parsed.mode)) {
    return { ok: false, error: 'invalid-mode' }
  }

  if (typeof parsed.boardVariant !== 'undefined' && !isBoardVariant(parsed.boardVariant)) {
    return { ok: false, error: 'invalid-board-variant' }
  }

  if (!isPlayerColor(parsed.openingTurn)) {
    return { ok: false, error: 'invalid-opening-turn' }
  }

  if (!isPlayerColorOrNull(parsed.winner)) {
    return { ok: false, error: 'invalid-winner' }
  }

  if (!isPlainObject(parsed.playerColors) || typeof parsed.playerColors.blue !== 'string' || typeof parsed.playerColors.yellow !== 'string') {
    return { ok: false, error: 'invalid-player-colors' }
  }

  if (!Array.isArray(parsed.moves)) {
    return { ok: false, error: 'invalid-moves' }
  }

  for (const move of parsed.moves) {
    if (!isRecordMove(move)) {
      return { ok: false, error: 'invalid-move-shape' }
    }
  }

  return {
    ok: true,
    record: {
      ...(parsed as MosaicRecordV1),
      boardVariant: normalizeBoardVariant(parsed.boardVariant),
    },
  }
}

function isRecordMove(value: unknown): value is MosaicRecordMove {
  if (!isPlainObject(value)) {
    return false
  }
  if (!Number.isFinite(value.turn)) {
    return false
  }
  if (!isPlayerColor(value.player)) {
    return false
  }
  if (!isMove(value.manual)) {
    return false
  }
  if (!Array.isArray(value.autoPlacements)) {
    return false
  }
  return value.autoPlacements.every((item) => isAutoPlacement(item))
}

function isMove(value: unknown): value is Move {
  return isPlainObject(value) && Number.isFinite(value.level) && Number.isFinite(value.row) && Number.isFinite(value.col)
}

function isAutoPlacement(value: unknown): value is AutoPlacement {
  return (
    isPlainObject(value) &&
    Number.isFinite(value.level) &&
    Number.isFinite(value.row) &&
    Number.isFinite(value.col) &&
    isPlayerColor(value.color)
  )
}

function isPlayerColor(value: unknown): value is PlayerColor {
  return value === 'blue' || value === 'yellow'
}

function isPlayerColorOrNull(value: unknown): value is PlayerColor | null {
  return value === null || isPlayerColor(value)
}

function isMosaicRecordMode(value: unknown): value is MosaicRecordMode {
  return value === 'pvp' || value === 'cpu' || value === 'online'
}

function isBoardVariant(value: unknown): value is BoardVariant {
  return value === 'mini' || value === 'standard' || value === 'pro'
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
