import { getBoardSpec, type BoardVariant, type GameState, type Move } from './types'
import { canPlaceAt } from './logic'

type KobalabStatus = -1 | 0 | 1 | 2 | null

interface KobalabGameSnapshot {
  template: TemplateData & { statusLength: number }
  status: KobalabStatus[]
  ball: [number, number, number]
  next: 1 | 2
}

interface TemplateData {
  baseSize: number
  child: number[][]
  moves: Move[]
  initialStatus: KobalabStatus[]
}

const KOBALAB_LEVEL = 3

interface KobalabRuntime {
  template: TemplateData & { statusLength: number }
  weight: number[]
  priority: number[]
  priorityRank: number[]
}

const KOBALAB_RUNTIME_CACHE = new Map<BoardVariant, KobalabRuntime>()

export interface KobalabDebugCandidate {
  move: Move
  position: number
  finalScore: number
  rank: number
  currentRv: number
  afterMoveRv: number
  deltaRv: number
  valueScore: number
  priorityWeight: number
  priorityRank: number
  searchedOrder: number
  legalMoves: number
  legalMovesAfterMove: number
  depth: number
  bestReply: Move | null
  bestReplyPosition: number | null
  bestReplyScore: number | null
  afterReplyRv: number | null
  nodes: number
  leaves: number
  prunes: number
}

export interface KobalabDebugAnalysis {
  selected: Move | null
  selectedPosition: number | null
  currentRv: number
  depth: number
  legalMoves: number
  selectionMode: 'priority_only' | 'search' | 'terminal'
  isTerminal: boolean
  terminalMessage: string | null
  candidates: KobalabDebugCandidate[]
  totalNodes: number
  totalLeaves: number
  totalPrunes: number
}

class KobalabGame {
  private readonly _template: TemplateData & { statusLength: number }
  private _status: KobalabStatus[]
  private _ball: [number, number, number]
  private _next: 1 | 2

  constructor(snapshot: KobalabGameSnapshot) {
    this._template = snapshot.template
    this._status = snapshot.status
    this._ball = snapshot.ball
    this._next = snapshot.next
  }

  clone(): KobalabGame {
    return new KobalabGame({
      template: this._template,
      status: this._status.slice(),
      ball: [...this._ball] as [number, number, number],
      next: this._next,
    })
  }

  get length(): number {
    return this._status.length
  }

  get size(): number {
    return this._template.baseSize
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
    return this._template.child[position]
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
  const runtime = getKobalabRuntime(state.boardVariant)
  const game = createKobalabGameFromState(state, runtime)
  const player = new KobalabCpu(game, runtime, KOBALAB_LEVEL)
  const position = player.selectMove()
  if (position == null) {
    return null
  }
  return runtime.template.moves[position] ?? null
}

export function analyzeKobalabMove(state: GameState): KobalabDebugAnalysis {
  const runtime = getKobalabRuntime(state.boardVariant)
  const game = createKobalabGameFromState(state, runtime)
  const player = new KobalabCpu(game, runtime, KOBALAB_LEVEL)
  const depth = player.depth()
  const currentRv = getValue(game)
  const legalPositions = new Set(game.moves())
  const legalMoves = legalPositions.size
  const noNextPlayer = !game.next
  const isTerminal = Boolean(state.winner) || noNextPlayer || legalMoves <= 0
  const currentPlayer = game.next ?? 1
  const selectionMode: 'priority_only' | 'search' | 'terminal' = isTerminal
    ? 'terminal'
    : depth === 0
      ? 'priority_only'
      : 'search'

  if (isTerminal) {
    let terminalMessage = 'Preview unavailable on terminal position.'
    if (state.winner) {
      terminalMessage = 'Game over.'
    } else if (legalMoves <= 0) {
      terminalMessage = 'No legal moves.'
    } else if (noNextPlayer) {
      terminalMessage = 'No legal next player.'
    }
    return {
      selected: null,
      selectedPosition: null,
      currentRv,
      depth: 0,
      legalMoves,
      selectionMode,
      isTerminal: true,
      terminalMessage,
      candidates: [],
      totalNodes: 0,
      totalLeaves: 0,
      totalPrunes: 0,
    }
  }

  let selectedPosition: number | null = null
  let selectedMove: Move | null = null
  let max = 0
  let totalNodes = 0
  let totalLeaves = 0
  let totalPrunes = 0

  const candidates: KobalabDebugCandidate[] = []

  for (const [index, position] of runtime.priority.entries()) {
    if (!legalPositions.has(position)) {
      continue
    }

    const afterMoveGame = game.clone().makeMove(position)
    const afterMoveRv = getValue(afterMoveGame)
    const deltaRv = afterMoveRv - currentRv
    const evaluation =
      depth === 0
        ? {
            score: evaluatePositionForPlayer(afterMoveGame, currentPlayer),
            nodes: 1,
            leaves: 1,
            prunes: 0,
          }
        : evaluateWithStats(afterMoveGame, currentPlayer, depth - 1, runtime.priority, max, game.length)

    const bestReply = analyzeBestReply(afterMoveGame, runtime, currentPlayer, depth)
    totalNodes += evaluation.nodes
    totalLeaves += evaluation.leaves
    totalPrunes += evaluation.prunes

    if (depth === 0) {
      if (selectedPosition == null) {
        selectedPosition = position
        selectedMove = runtime.template.moves[position] ?? null
      }
    } else if (evaluation.score > max) {
      max = evaluation.score
      selectedPosition = position
      selectedMove = runtime.template.moves[position] ?? null
    }

    candidates.push({
      move: runtime.template.moves[position],
      position,
      finalScore: evaluation.score,
      rank: 0,
      currentRv,
      afterMoveRv,
      deltaRv,
      valueScore: afterMoveRv,
      priorityWeight: runtime.weight[position] ?? 0,
      priorityRank: runtime.priorityRank[position] ?? index + 1,
      searchedOrder: index + 1,
      legalMoves,
      legalMovesAfterMove: afterMoveGame.moves().length,
      depth,
      bestReply: bestReply.position != null ? (runtime.template.moves[bestReply.position] ?? null) : null,
      bestReplyPosition: bestReply.position,
      bestReplyScore: bestReply.score,
      afterReplyRv: bestReply.afterReplyRv,
      nodes: evaluation.nodes,
      leaves: evaluation.leaves,
      prunes: evaluation.prunes,
    })
  }

  candidates.sort((a, b) => {
    if (b.finalScore !== a.finalScore) {
      return b.finalScore - a.finalScore
    }
    return a.priorityRank - b.priorityRank
  })

  candidates.forEach((candidate, index) => {
    candidate.rank = index + 1
  })

  if (!selectedMove && candidates.length > 0) {
    selectedMove = candidates[0].move
    selectedPosition = candidates[0].position
  }

  return {
    selected: selectedMove,
    selectedPosition,
    currentRv,
    depth,
    legalMoves,
    selectionMode,
    isTerminal: false,
    terminalMessage: null,
    candidates,
    totalNodes,
    totalLeaves,
    totalPrunes,
  }
}

class KobalabCpu {
  private readonly game: KobalabGame
  private readonly level: number
  private readonly position: number[]

  constructor(game: KobalabGame, runtime: KobalabRuntime, level = 2) {
    this.game = game
    this.level = level
    this.position = runtime.priority
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

function createKobalabGameFromState(state: GameState, runtime: KobalabRuntime): KobalabGame {
  // Adapter layer: MOSAIC board state -> UpperHand-style flat state representation.
  const status = runtime.template.initialStatus.slice()

  for (let position = 0; position < runtime.template.moves.length; position += 1) {
    const move = runtime.template.moves[position]
    const piece = state.board[move.level][move.row][move.col]
    if (piece) {
      status[position] = piece.color === 'neutral' ? 0 : piece.color === 'blue' ? 1 : 2
      continue
    }

    status[position] = canPlaceAt(state.board, move.level, move.row, move.col) ? -1 : null
  }

  return new KobalabGame({
    template: runtime.template,
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

function getWeight(child: number[][], length: number, baseSize: number): number[] {
  // Reference origin: UpperHand src/js/player.js getWeight()
  const weight: number[] = []
  for (let p = 0; p < length; p += 1) {
    const pos: boolean[] = []
    let w = 0
    pos[p] = true
    for (let q = baseSize * baseSize; q < length; q += 1) {
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

function buildPriorityRankMap(priority: number[]): number[] {
  const rankMap: number[] = []
  for (let index = 0; index < priority.length; index += 1) {
    rankMap[priority[index]] = index + 1
  }
  return rankMap
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

function evaluatePositionForPlayer(game: KobalabGame, player: 1 | 2): number {
  const rv = getValue(game)
  return player === 1 ? rv : game.length - rv
}

function evaluateWithStats(
  game: KobalabGame,
  player: 1 | 2,
  depth: number,
  position: number[],
  a: number,
  b: number,
): {
  score: number
  nodes: number
  leaves: number
  prunes: number
} {
  if (!game.next || depth === 0) {
    return {
      score: evaluatePositionForPlayer(game, player),
      nodes: 1,
      leaves: 1,
      prunes: 0,
    }
  }

  let max = a
  let min = b
  let nodes = 1
  let leaves = 0
  let prunes = 0

  for (const candidate of position) {
    if (game.status(candidate) !== -1) {
      continue
    }
    const child = evaluateWithStats(game.clone().makeMove(candidate), player, depth - 1, position, max, min)
    nodes += child.nodes
    leaves += child.leaves
    prunes += child.prunes

    if (game.next === player) {
      if (child.score >= b) {
        prunes += 1
        return { score: b, nodes, leaves, prunes }
      }
      max = child.score > max ? child.score : max
    } else {
      if (child.score <= a) {
        prunes += 1
        return { score: a, nodes, leaves, prunes }
      }
      min = child.score < min ? child.score : min
    }
  }

  return {
    score: game.next === player ? max : min,
    nodes,
    leaves,
    prunes,
  }
}

function analyzeBestReply(
  game: KobalabGame,
  runtime: KobalabRuntime,
  player: 1 | 2,
  depth: number,
): {
  position: number | null
  score: number | null
  afterReplyRv: number | null
} {
  if (!game.next) {
    return { position: null, score: null, afterReplyRv: null }
  }

  let bestPosition: number | null = null
  let bestScore = Number.POSITIVE_INFINITY
  let bestAfterReplyRv: number | null = null
  const remainingDepth = Math.max(depth - 2, 0)

  for (const candidate of runtime.priority) {
    if (game.status(candidate) !== -1) {
      continue
    }
    const afterReplyGame = game.clone().makeMove(candidate)
    const score = evaluateWithStats(afterReplyGame, player, remainingDepth, runtime.priority, 0, game.length).score
    if (score < bestScore) {
      bestScore = score
      bestPosition = candidate
      bestAfterReplyRv = getValue(afterReplyGame)
    }
  }

  if (bestPosition == null) {
    return { position: null, score: null, afterReplyRv: null }
  }

  return {
    position: bestPosition,
    score: bestScore,
    afterReplyRv: bestAfterReplyRv,
  }
}

function getKobalabRuntime(boardVariant: BoardVariant): KobalabRuntime {
  const cached = KOBALAB_RUNTIME_CACHE.get(boardVariant)
  if (cached) {
    return cached
  }
  const template = buildTemplate(getBoardSpec(boardVariant).baseSize)
  const weight = getWeight(template.child, template.statusLength, template.baseSize)
  const priority = makePriorityOfPosition(weight)
  const priorityRank = buildPriorityRankMap(priority)
  const runtime = { template, weight, priority, priorityRank }
  KOBALAB_RUNTIME_CACHE.set(boardVariant, runtime)
  return runtime
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
    baseSize: size,
    child,
    moves,
    initialStatus,
    statusLength: initialStatus.length,
  }
}
