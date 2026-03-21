import { BASE_SIZE, type GameState, type Move } from './types'
import { canPlaceAt } from './logic'

type KobalabStatus = -1 | 0 | 1 | 2 | null

interface KobalabGameSnapshot {
  status: KobalabStatus[]
  ball: [number, number, number]
  next: 1 | 2
}

interface TemplateData {
  child: number[][]
  moves: Move[]
  initialStatus: KobalabStatus[]
}

const KOBALAB_LEVEL = 3
const KOBALAB_TEMPLATE = buildTemplate(BASE_SIZE)
const KOBALAB_WEIGHT = getWeight(KOBALAB_TEMPLATE.child, KOBALAB_TEMPLATE.statusLength)
const KOBALAB_PRIORITY = makePriorityOfPosition(KOBALAB_WEIGHT)

class KobalabGame {
  private readonly _size = BASE_SIZE
  private _status: KobalabStatus[]
  private _ball: [number, number, number]
  private _next: 1 | 2

  constructor(snapshot: KobalabGameSnapshot) {
    this._status = snapshot.status
    this._ball = snapshot.ball
    this._next = snapshot.next
  }

  clone(): KobalabGame {
    return new KobalabGame({
      status: this._status.slice(),
      ball: [...this._ball] as [number, number, number],
      next: this._next,
    })
  }

  get length(): number {
    return this._status.length
  }

  get size(): number {
    return this._size
  }

  get next(): 1 | 2 | undefined {
    if (this._ball[1] === 0 || this._ball[2] === 0) {
      return undefined
    }
    return this._next
  }

  status(position: number): KobalabStatus {
    return this._status[position]
  }

  child(position: number): number[] {
    return KOBALAB_TEMPLATE.child[position]
  }

  ball(player: 0 | 1 | 2): number {
    return this._ball[player]
  }

  moves(): number[] {
    return this._status.flatMap((status, position) => (status === -1 ? [position] : []))
  }

  makeMove(position: number): KobalabGame {
    const put = (target: number, player: 1 | 2) => {
      if (this._ball[player] > 0) {
        this._ball[player] -= 1
        this._status[target] = player
      }
    }

    const next = this.next
    if (!next) {
      throw new Error('No legal next player.')
    }
    if (this._status[position] !== -1) {
      throw new Error(`Illegal move at ${position}.`)
    }

    put(position, next)

    for (let q = 0; q < this._status.length; q += 1) {
      if (this._status[q] !== null) {
        continue
      }
      let n0 = 0
      let n1 = 0
      let n2 = 0
      for (const child of this.child(q)) {
        const status = this._status[child]
        if (status === 0) {
          n0 += 1
        } else if (status === 1) {
          n1 += 1
        } else if (status === 2) {
          n2 += 1
        }
      }
      if (n0 + n1 + n2 < 4) {
        continue
      }
      if (n1 >= 3) {
        put(q, 1)
      } else if (n2 >= 3) {
        put(q, 2)
      } else {
        this._status[q] = -1
      }
    }

    this._next = this._next === 1 ? 2 : 1
    return this
  }
}

export function chooseKobalabMove(state: GameState): Move | null {
  // Ported from UpperHand's game.js/player.js into MOSAIC's TypeScript runtime.
  const game = createKobalabGameFromState(state)
  const player = new KobalabCpu(game, KOBALAB_LEVEL)
  const position = player.selectMove()
  if (position == null) {
    return null
  }
  return KOBALAB_TEMPLATE.moves[position] ?? null
}

class KobalabCpu {
  private readonly game: KobalabGame
  private readonly level: number
  private readonly position: number[]

  constructor(game: KobalabGame, level = 2) {
    this.game = game
    this.level = level
    this.position = KOBALAB_PRIORITY
  }

  depth(): number {
    if (!this.hasPlayer2Stone()) {
      return 0
    }
    if (this.level < 3) {
      return this.level
    }
    return Math.max(Math.floor(50 / Math.max(1, this.game.moves().length)), 3)
  }

  selectMove(): number | undefined {
    const depth = this.depth()

    if (depth === 0) {
      for (const position of this.position) {
        if (this.game.status(position) === -1) {
          return position
        }
      }
      return undefined
    }

    let selected: number | undefined
    let max = 0
    let min = this.game.length

    for (const position of this.position) {
      if (this.game.status(position) !== -1) {
        continue
      }
      const ev = evaluate(this.game.clone().makeMove(position), this.game.next ?? 1, depth - 1, this.position, max, min)
      if (ev > max) {
        max = ev
        selected = position
      }
    }

    return selected
  }

  private hasPlayer2Stone(): boolean {
    for (let position = 0; position < this.game.length; position += 1) {
      if (this.game.status(position) === 2) {
        return true
      }
    }
    return false
  }
}

function createKobalabGameFromState(state: GameState): KobalabGame {
  // Adapter layer: MOSAIC board state -> UpperHand-style flat state representation.
  const status = KOBALAB_TEMPLATE.initialStatus.slice()

  for (let position = 0; position < KOBALAB_TEMPLATE.moves.length; position += 1) {
    const move = KOBALAB_TEMPLATE.moves[position]
    const piece = state.board[move.level][move.row][move.col]
    if (piece) {
      status[position] = piece.color === 'neutral' ? 0 : piece.color === 'blue' ? 1 : 2
      continue
    }

    status[position] = canPlaceAt(state.board, move.level, move.row, move.col) ? -1 : null
  }

  return new KobalabGame({
    status,
    ball: [countNeutralPieces(state), state.remaining.blue, state.remaining.yellow],
    next: state.currentTurn === 'blue' ? 1 : 2,
  })
}

function countNeutralPieces(state: GameState): number {
  let count = 0
  for (const level of state.board) {
    for (const row of level) {
      for (const cell of row) {
        if (cell?.color === 'neutral') {
          count += 1
        }
      }
    }
  }
  return count
}

function getWeight(child: number[][], length: number): number[] {
  // Reference origin: UpperHand src/js/player.js getWeight()
  const weight: number[] = []
  for (let p = 0; p < length; p += 1) {
    const pos: boolean[] = []
    let w = 0
    pos[p] = true
    for (let q = BASE_SIZE * BASE_SIZE; q < length; q += 1) {
      for (const c of child[q]) {
        if (pos[c]) {
          pos[q] = true
          w += 1
          break
        }
      }
    }
    weight[p] = w
  }
  return weight
}

function makePriorityOfPosition(weight: number[]): number[] {
  // UpperHand shuffles ties, but MOSAIC keeps deterministic ordering for reproducible play.
  const position = Array.from({ length: weight.length }, (_, index) => index)
  position.sort((a, b) => {
    if (weight[a] !== weight[b]) {
      return weight[b] - weight[a]
    }
    return a - b
  })
  return position
}

function getValue(game: KobalabGame): number {
  // Reference origin: UpperHand src/js/player.js getValue()
  if (!game.next) {
    return game.length / 2 - game.ball(1) + game.ball(2)
  }

  const ev: number[] = []
  let rv = 0

  for (let p = 0; p < game.length; p += 1) {
    const status = game.status(p)
    if (status === -1 || status === 0) {
      ev[p] = 0.5
    } else if (status === 1) {
      ev[p] = 1.0
    } else if (status === 2) {
      ev[p] = 0.0
    } else {
      const [e1, e2, e3, e4] = game.child(p).map((q) => ev[q])
      ev[p] =
        e1 * e2 * e3 * e4 +
        (1 - e1) * e2 * e3 * e4 +
        e1 * (1 - e2) * e3 * e4 +
        e1 * e2 * (1 - e3) * e4 +
        e1 * e2 * e3 * (1 - e4) +
        (1 - e1) * (1 - e2) * e3 * e4 * 0.5 +
        (1 - e1) * e2 * (1 - e3) * e4 * 0.5 +
        (1 - e1) * e2 * e3 * (1 - e4) * 0.5 +
        e1 * (1 - e2) * (1 - e3) * e4 * 0.5 +
        e1 * (1 - e2) * e3 * (1 - e4) * 0.5 +
        e1 * e2 * (1 - e3) * (1 - e4) * 0.5
    }
    rv += ev[p]
  }

  return rv
}

function evaluate(
  game: KobalabGame,
  player: 1 | 2,
  depth: number,
  position: number[],
  a: number,
  b: number,
): number {
  // Reference origin: UpperHand src/js/player.js evaluate()
  if (!game.next || depth === 0) {
    return player === 1 ? getValue(game) : game.length - getValue(game)
  }

  let max = a
  let min = b
  for (const candidate of position) {
    if (game.status(candidate) !== -1) {
      continue
    }
    const ev = evaluate(game.clone().makeMove(candidate), player, depth - 1, position, max, min)
    if (game.next === player) {
      if (ev >= b) {
        return b
      }
      max = ev > max ? ev : max
    } else {
      if (ev <= a) {
        return a
      }
      min = ev < min ? ev : min
    }
  }
  return game.next === player ? max : min
}

function buildTemplate(size: number): TemplateData & { statusLength: number } {
  // Reference origin: UpperHand src/js/game.js constructor()
  const child: number[][] = []
  const moves: Move[] = []
  const initialStatus: KobalabStatus[] = []

  const center = Math.floor(size / 2) * (size % 2)
  for (let z = size; z > 0; z -= 1) {
    const base = child.length - (z + 1) * (z + 1)
    const level = size - z
    for (let row = 0; row < z; row += 1) {
      for (let col = 0; col < z; col += 1) {
        moves.push({ level, row, col })
        if (base < 0) {
          child.push([-1, -1, -1, -1])
          if (center && row === center && col === center) {
            initialStatus.push(0)
          } else {
            initialStatus.push(-1)
          }
        } else {
          child.push([
            base + row * (z + 1) + col,
            base + row * (z + 1) + col + 1,
            base + (row + 1) * (z + 1) + col,
            base + (row + 1) * (z + 1) + col + 1,
          ])
          initialStatus.push(null)
        }
      }
    }
  }

  return {
    child,
    moves,
    initialStatus,
    statusLength: initialStatus.length,
  }
}
