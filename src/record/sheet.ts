import { BASE_SIZE } from '../game/types'
import type { MosaicRecordMode, MosaicRecordV1 } from './file'

type ScoreColor = 'first' | 'second'

interface ScoreSheetCellEntry {
  text: string
  color: ScoreColor
  bonus: boolean
}

interface ScoreSheetLayer {
  level: number
  size: number
  cells: (ScoreSheetCellEntry | null)[][]
}

interface ScoreSheetData {
  layers: ScoreSheetLayer[]
  totalMoves: number
}

export interface ScoreSheetRenderLabels {
  title: string
  modeLabel: string
  modeValue: string
  winnerLabel: string
  winnerValue: string
  movesLabel: string
  exportedAtLabel: string
}

const FIRST_MOVE_COLOR = '#1f2328'
const SECOND_MOVE_COLOR = '#c13b33'

export function createMosaicScoreSheetFileName(mode: MosaicRecordMode, date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const modeName = mode === 'online' ? 'online' : mode === 'cpu' ? 'cpu' : 'local'
  return `mosaic-sheet-${modeName}-${y}-${m}-${d}-${hh}${mm}.png`
}

export async function exportMosaicScoreSheetPng(
  record: MosaicRecordV1,
  labels: ScoreSheetRenderLabels,
  fileName = createMosaicScoreSheetFileName(record.mode),
): Promise<void> {
  const data = buildScoreSheetData(record)
  const canvas = renderScoreSheetCanvas(data, labels, record.exportedAt)
  await downloadCanvasAsPng(canvas, fileName)
}

function buildScoreSheetData(record: MosaicRecordV1): ScoreSheetData {
  const layers: ScoreSheetLayer[] = Array.from({ length: BASE_SIZE }, (_, index) => {
    const level = BASE_SIZE - 1 - index
    const size = BASE_SIZE - level
    return {
      level,
      size,
      cells: Array.from({ length: size }, () => Array<ScoreSheetCellEntry | null>(size).fill(null)),
    }
  })

  const firstMover = record.openingTurn
  for (const [index, move] of record.moves.entries()) {
    const turnNumber = Number.isFinite(move.turn) ? move.turn : index + 1
    const color: ScoreColor = move.player === firstMover ? 'first' : 'second'
    writeCell(layers, move.manual.level, move.manual.row, move.manual.col, {
      text: `${turnNumber}`,
      color,
      bonus: false,
    })
    for (const placement of move.autoPlacements) {
      writeCell(layers, placement.level, placement.row, placement.col, {
        text: `(${turnNumber})`,
        color,
        bonus: true,
      })
    }
  }

  return {
    layers,
    totalMoves: record.moves.length,
  }
}

function writeCell(
  layers: ScoreSheetLayer[],
  level: number,
  row: number,
  col: number,
  entry: ScoreSheetCellEntry,
): void {
  const layer = layers.find((item) => item.level === level)
  if (!layer) {
    return
  }
  if (row < 0 || row >= layer.size || col < 0 || col >= layer.size) {
    return
  }
  layer.cells[row][col] = entry
}

function renderScoreSheetCanvas(
  data: ScoreSheetData,
  labels: ScoreSheetRenderLabels,
  exportedAt: string,
): HTMLCanvasElement {
  const cellSize = 38
  const cellGap = 4
  const layerGap = 14
  const paddingX = 40
  const headerTop = 34
  const titleHeight = 34
  const metaLineHeight = 20
  const metaBlockHeight = metaLineHeight * 3
  const boardTop = headerTop + titleHeight + metaBlockHeight + 24
  const footerHeight = 26

  const maxBoardSize = BASE_SIZE * cellSize + (BASE_SIZE - 1) * cellGap
  const width = paddingX * 2 + maxBoardSize
  const boardsHeight = data.layers.reduce((sum, layer, index) => {
    const boardPx = layer.size * cellSize + (layer.size - 1) * cellGap
    const withGap = index < data.layers.length - 1 ? layerGap : 0
    return sum + boardPx + withGap
  }, 0)
  const height = boardTop + boardsHeight + footerHeight

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('canvas-context-unavailable')
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#1c2f53'
  ctx.font = '700 28px "Trebuchet MS", "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(labels.title, width / 2, headerTop)

  const exportedDateLabel = new Date(exportedAt).toLocaleString()
  ctx.font = '600 14px "Trebuchet MS", "Segoe UI", sans-serif'
  ctx.fillStyle = '#344c74'
  ctx.fillText(`${labels.modeLabel}: ${labels.modeValue}`, width / 2, headerTop + titleHeight)
  ctx.fillText(`${labels.winnerLabel}: ${labels.winnerValue}`, width / 2, headerTop + titleHeight + metaLineHeight)
  ctx.fillText(
    `${labels.movesLabel}: ${data.totalMoves} / ${labels.exportedAtLabel}: ${exportedDateLabel}`,
    width / 2,
    headerTop + titleHeight + metaLineHeight * 2,
  )

  let currentY = boardTop
  for (const layer of data.layers) {
    const boardSize = layer.size * cellSize + (layer.size - 1) * cellGap
    const startX = (width - boardSize) / 2
    drawLayerGrid(ctx, layer, startX, currentY, cellSize, cellGap)
    currentY += boardSize + layerGap
  }

  return canvas
}

function drawLayerGrid(
  ctx: CanvasRenderingContext2D,
  layer: ScoreSheetLayer,
  startX: number,
  startY: number,
  cellSize: number,
  cellGap: number,
): void {
  for (let row = 0; row < layer.size; row += 1) {
    for (let col = 0; col < layer.size; col += 1) {
      const x = startX + col * (cellSize + cellGap)
      const y = startY + row * (cellSize + cellGap)
      drawCell(ctx, x, y, cellSize, layer.cells[row][col])
    }
  }
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  cell: ScoreSheetCellEntry | null,
): void {
  ctx.fillStyle = '#fdfefe'
  ctx.strokeStyle = '#bdc9da'
  ctx.lineWidth = 1
  ctx.fillRect(x, y, size, size)
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)

  if (!cell) {
    return
  }

  ctx.fillStyle = cell.color === 'first' ? FIRST_MOVE_COLOR : SECOND_MOVE_COLOR
  ctx.font = `${cell.bonus ? '600' : '700'} 14px "Trebuchet MS", "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(cell.text, x + size / 2, y + size / 2 + 0.5)
}

async function downloadCanvasAsPng(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await canvasToBlob(canvas)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('canvas-blob-failed'))
    }, 'image/png')
  })
}
