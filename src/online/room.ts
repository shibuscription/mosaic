import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import { canPlaceAt, createInitialGameState, placeManualPiece } from '../game/logic'
import {
  type AutoPlacement,
  type GameState,
  type Move,
  type PieceColor,
  type PieceSource,
  type PlayerColor,
} from '../game/types'

export type RoomStatus = 'waiting' | 'playing' | 'finished'
export type RoomPlayerStatus = 'connected' | 'left'

export interface RoomSlot {
  role: PlayerColor
  joined: boolean
  status: RoomPlayerStatus
  joinedAt?: unknown
  lastSeenAt?: unknown
}

export interface RoomPlayers {
  player1: RoomSlot
  player2: RoomSlot
}

export interface SerializedPiece {
  color: PieceColor
  source: PieceSource
}

export interface SerializedBoardCell extends SerializedPiece {
  level: number
  row: number
  col: number
}

export interface SerializedGameState {
  boardCells: SerializedBoardCell[]
  currentTurn: PlayerColor
  remaining: Record<PlayerColor, number>
  winner: PlayerColor | null
  message: string
  lastMove: Move | null
  lastAutoPlacements: AutoPlacement[]
  lastActor: PlayerColor | null
}

export interface RoomDoc {
  roomCode: string
  status: RoomStatus
  hostStarts: boolean
  players: RoomPlayers
  playerColors: {
    blue: string
    yellow: string
  }
  currentTurn: PlayerColor
  boardState: SerializedGameState
  winner: PlayerColor | null
  createdAt?: unknown
  updatedAt?: unknown
}

export interface OnlineMoveInput {
  level: number
  row: number
  col: number
}

export class RoomError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const ROOM_COLLECTION = 'rooms'
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const ROOM_CODE_LENGTH = 6

function roleToPlayerKey(role: PlayerColor): 'player1' | 'player2' {
  return role === 'blue' ? 'player1' : 'player2'
}

export function generateRoomCode(): string {
  let code = ''
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)
    code += ROOM_CODE_ALPHABET[randomIndex]
  }
  return code
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase()
}

export function serializeGameState(state: GameState): SerializedGameState {
  const boardCells: SerializedBoardCell[] = []
  state.board.forEach((levelRows, level) => {
    levelRows.forEach((rowCells, row) => {
      rowCells.forEach((piece, col) => {
        if (!piece) {
          return
        }
        boardCells.push({
          level,
          row,
          col,
          color: piece.color,
          source: piece.source,
        })
      })
    })
  })

  return {
    boardCells,
    currentTurn: state.currentTurn,
    remaining: { ...state.remaining },
    winner: state.winner,
    message: state.message,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastAutoPlacements: state.lastAutoPlacements.map((item) => ({ ...item })),
    lastActor: state.lastActor,
  }
}

export function deserializeGameState(data: SerializedGameState): GameState {
  const emptyBoard = createInitialGameState().board.map((levelRows) =>
    levelRows.map((rowCells) =>
      rowCells.map(() => null as GameState['board'][number][number][number]),
    ),
  )
  const boardCells = extractBoardCells(data)

  for (const cell of boardCells) {
    if (!emptyBoard[cell.level] || !emptyBoard[cell.level][cell.row] || typeof emptyBoard[cell.level][cell.row][cell.col] === 'undefined') {
      continue
    }
    emptyBoard[cell.level][cell.row][cell.col] = {
      color: cell.color,
      source: cell.source,
    }
  }

  return {
    board: emptyBoard,
    currentTurn: data.currentTurn,
    remaining: { ...data.remaining },
    winner: data.winner,
    message: data.message,
    lastMove: data.lastMove ? { ...data.lastMove } : null,
    lastAutoPlacements: data.lastAutoPlacements.map((item) => ({ ...item })),
    lastActor: data.lastActor,
  }
}

function extractBoardCells(data: SerializedGameState): SerializedBoardCell[] {
  if (Array.isArray(data.boardCells)) {
    return data.boardCells
  }

  const legacyBoard = (data as SerializedGameState & { board?: Array<Array<Array<SerializedPiece | null>>> }).board
  if (!Array.isArray(legacyBoard)) {
    return []
  }

  const cells: SerializedBoardCell[] = []
  legacyBoard.forEach((levelRows, level) => {
    levelRows.forEach((rowCells, row) => {
      rowCells.forEach((piece, col) => {
        if (!piece) {
          return
        }
        cells.push({
          level,
          row,
          col,
          color: piece.color,
          source: piece.source,
        })
      })
    })
  })
  return cells
}

export async function createRoom(
  playerColors: { blue: string; yellow: string },
  hostStarts = true,
): Promise<{ roomCode: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomCode = generateRoomCode()
    const roomRef = doc(db, ROOM_COLLECTION, roomCode)
    const existing = await getDoc(roomRef)
    if (existing.exists()) {
      continue
    }

    const initial = createInitialGameState()
    initial.currentTurn = hostStarts ? 'blue' : 'yellow'
    initial.message = hostStarts ? "Player 1's turn" : "Player 2's turn"
    const payload: RoomDoc = {
      roomCode,
      status: 'waiting',
      hostStarts,
      players: {
        player1: {
          role: 'blue',
          joined: true,
          status: 'connected',
          joinedAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
        },
        player2: { role: 'yellow', joined: false, status: 'connected' },
      },
      playerColors: {
        blue: playerColors.blue,
        yellow: playerColors.yellow,
      },
      currentTurn: initial.currentTurn,
      boardState: serializeGameState(initial),
      winner: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }

    await setDoc(roomRef, payload)
    return { roomCode }
  }

  throw new RoomError('create_failed', 'Failed to generate room code. Please retry.')
}

export async function joinRoom(rawCode: string): Promise<{ roomCode: string }> {
  const roomCode = normalizeRoomCode(rawCode)
  if (roomCode.length < 4) {
    throw new RoomError('invalid_code', 'Invalid room code. Enter at least 4 characters.')
  }

  const roomRef = doc(db, ROOM_COLLECTION, roomCode)
  await runTransaction(db, async (txn) => {
    const snap = await txn.get(roomRef)
    if (!snap.exists()) {
      throw new RoomError('not_found', 'Room not found.')
    }

    const room = snap.data() as RoomDoc
    if (room.status !== 'waiting') {
      throw new RoomError('not_joinable', 'Room is not joinable.')
    }

    if (room.players.player2.joined) {
      throw new RoomError('room_full', 'Room is already full.')
    }

    txn.update(roomRef, {
      status: 'playing',
      'players.player2.joined': true,
      'players.player2.status': 'connected',
      'players.player2.joinedAt': serverTimestamp(),
      'players.player2.lastSeenAt': serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })

  return { roomCode }
}

export function subscribeRoom(
  roomCode: string,
  onData: (room: RoomDoc | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const roomRef = doc(db, ROOM_COLLECTION, roomCode)
  return onSnapshot(
    roomRef,
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      onData(snap.data() as RoomDoc)
    },
    (error) => {
      onError(error as Error)
    },
  )
}

export async function submitRoomMove(
  roomCode: string,
  actor: PlayerColor,
  move: OnlineMoveInput,
): Promise<void> {
  const roomRef = doc(db, ROOM_COLLECTION, roomCode)

  await runTransaction(db, async (txn) => {
    const snap = await txn.get(roomRef)
    if (!snap.exists()) {
      throw new RoomError('not_found', 'Room not found.')
    }

    const room = snap.data() as RoomDoc
    if (room.status !== 'playing') {
      throw new RoomError('not_playing', 'Room is not in playing status.')
    }

    if (room.currentTurn !== actor) {
      throw new RoomError('not_turn', 'It is not your turn.')
    }

    const currentState = deserializeGameState(room.boardState)
    if (!canPlaceAt(currentState.board, move.level, move.row, move.col)) {
      throw new RoomError('illegal_move', 'Illegal move.')
    }

    const nextState = placeManualPiece(currentState, move.level, move.row, move.col)
    txn.update(roomRef, {
      boardState: serializeGameState(nextState),
      currentTurn: nextState.currentTurn,
      winner: nextState.winner,
      status: nextState.winner ? 'finished' : 'playing',
      updatedAt: serverTimestamp(),
    })
  })
}

export async function updateRoomHeartbeat(roomCode: string, role: PlayerColor): Promise<void> {
  const roomRef = doc(db, ROOM_COLLECTION, roomCode)
  const playerKey = roleToPlayerKey(role)
  await updateDoc(roomRef, {
    [`players.${playerKey}.lastSeenAt`]: serverTimestamp(),
    [`players.${playerKey}.status`]: 'connected',
    updatedAt: serverTimestamp(),
  })
}

export async function markPlayerLeft(roomCode: string, role: PlayerColor): Promise<void> {
  const roomRef = doc(db, ROOM_COLLECTION, roomCode)
  const playerKey = roleToPlayerKey(role)
  await updateDoc(roomRef, {
    [`players.${playerKey}.status`]: 'left',
    updatedAt: serverTimestamp(),
  })
}
