export const BASE_SIZE = 7
export const MAX_LEVEL = BASE_SIZE - 1
export const TOTAL_PIECES = 70

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
  board: Board
  currentTurn: PlayerColor
  remaining: Record<PlayerColor, number>
  winner: PlayerColor | null
  message: string
  lastMove: Move | null
  lastAutoPlacements: AutoPlacement[]
  lastActor: PlayerColor | null
}