export type BoardVariant = 'mini' | 'standard' | 'pro'

export interface BoardSpec {
  variant: BoardVariant
  baseSize: number
  maxLevel: number
  totalPieces: number
}

export const DEFAULT_BOARD_VARIANT: BoardVariant = 'standard'
export const BASE_SIZE = 7
export const MAX_LEVEL = BASE_SIZE - 1
export const TOTAL_PIECES = 70

const BOARD_SPECS: Record<BoardVariant, BoardSpec> = {
  mini: {
    variant: 'mini',
    baseSize: 5,
    maxLevel: 4,
    totalPieces: 27,
  },
  standard: {
    variant: 'standard',
    baseSize: 7,
    maxLevel: 6,
    totalPieces: 50,
  },
  pro: {
    variant: 'pro',
    baseSize: 9,
    maxLevel: 8,
    totalPieces: 142,
  },
}

export function getBoardSpec(variant: BoardVariant = DEFAULT_BOARD_VARIANT): BoardSpec {
  return BOARD_SPECS[variant]
}

export function normalizeBoardVariant(value: unknown): BoardVariant {
  if (value === 'mini' || value === 'pro' || value === 'standard') {
    return value
  }
  return DEFAULT_BOARD_VARIANT
}

export function getLevelSizeForVariant(variant: BoardVariant, level: number): number {
  return getBoardSpec(variant).baseSize - level
}

export type PlayerColor = 'blue' | 'yellow'
export type PieceColor = PlayerColor | 'neutral'
export type PieceSource = 'initial' | 'manual' | 'auto'

export interface Piece {
  color: PieceColor
  source: PieceSource
}

export type LevelBoard = Array<Array<Piece | null>>
export type Board = LevelBoard[]

export interface Move {
  level: number
  row: number
  col: number
}

export interface AutoPlacement extends Move {
  color: PlayerColor
  basedOnLevel: number
}

export interface GameState {
  boardVariant: BoardVariant
  board: Board
  currentTurn: PlayerColor
  remaining: Record<PlayerColor, number>
  winner: PlayerColor | null
  message: string
  lastMove: Move | null
  lastAutoPlacements: AutoPlacement[]
  lastActor: PlayerColor | null
}
