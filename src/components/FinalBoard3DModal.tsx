import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createInitialGameState } from '../game/logic'
import { BASE_SIZE, type AutoPlacement, type Board, type Move, type PieceColor, type PlayerColor } from '../game/types'

interface ReplayMove {
  player: PlayerColor
  manual: Move
  autoPlacements: AutoPlacement[]
}

interface FinalBoard3DModalProps {
  board: Board
  moves: ReplayMove[]
  colors: Record<PieceColor, string>
  onManualSound?: () => void
  onAutoSound?: (chainIndex: number) => void
  onClose: () => void
}

const REPLAY_MANUAL_MS = 200
const REPLAY_AUTO_MS = 130
const REPLAY_GAP_MS = 90

export function FinalBoard3DModal({ board, moves, colors, onManualSound, onAutoSound, onClose }: FinalBoard3DModalProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const runReplayRef = useRef<() => void>(() => undefined)
  const [isReplaying, setIsReplaying] = useState(false)
  const replayingRef = useRef(false)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) {
      return
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#edf2ff')

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(5.35, 6.0, 6.65)
    camera.lookAt(0, 0.8, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableRotate = false
    controls.enableZoom = true
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.zoomSpeed = 0.95
    controls.minDistance = 4.8
    controls.maxDistance = 10.8
    controls.target.set(0, 0.58, 0)
    controls.update()

    const ambientLight = new THREE.AmbientLight('#ffffff', 0.45)
    const hemi = new THREE.HemisphereLight('#ffffff', '#cad7ef', 0.32)
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.05)
    keyLight.position.set(8, 12, 5)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.bias = -0.00018
    keyLight.shadow.radius = 2.2
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 30
    keyLight.shadow.camera.left = -5.8
    keyLight.shadow.camera.right = 5.8
    keyLight.shadow.camera.top = 5.8
    keyLight.shadow.camera.bottom = -5.8

    scene.add(ambientLight)
    scene.add(hemi)
    scene.add(keyLight)

    const boardGroup = new THREE.Group()
    scene.add(boardGroup)

    const baseState = createInitialGameState()
    const replayBoard = baseState.board.map((rows) => rows.map((cols) => cols.map((piece) => (piece ? { ...piece } : null))))

    const diskRadius = 0.36
    const diskHeight = 0.115
    const gridSpacing = 0.7
    const levelHeight = 0.19
    const boardSpan = (BASE_SIZE - 1) * gridSpacing + diskRadius * 2
    const centerOffset = ((BASE_SIZE - 1) * gridSpacing) / 2
    const diskGeometry = new THREE.CylinderGeometry(diskRadius, diskRadius, diskHeight, 40)

    const pieceMeshes = new Map<string, THREE.Mesh>()
    const playbackTimeoutIds: number[] = []
    let autoRotateEnabled = true

    const toKey = (level: number, row: number, col: number): string => `${level}-${row}-${col}`
    const addPieceMesh = (level: number, row: number, col: number, color: PieceColor) => {
      const key = toKey(level, row, col)
      if (pieceMeshes.has(key)) {
        return
      }

      const x = col * gridSpacing + level * (gridSpacing / 2) - centerOffset
      const z = row * gridSpacing + level * (gridSpacing / 2) - centerOffset
      const y = level * levelHeight

      const material = new THREE.MeshStandardMaterial({
        color: colors[color],
        roughness: 0.33,
        metalness: 0.06,
      })

      const mesh = new THREE.Mesh(diskGeometry, material)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      boardGroup.add(mesh)
      pieceMeshes.set(key, mesh)
    }

    const disposePieceMeshes = () => {
      pieceMeshes.forEach((mesh) => {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m: THREE.Material) => m.dispose())
        } else {
          mesh.material.dispose()
        }
        boardGroup.remove(mesh)
      })
      pieceMeshes.clear()
    }

    const resetReplayBoard = () => {
      for (let level = 0; level < replayBoard.length; level += 1) {
        for (let row = 0; row < replayBoard[level].length; row += 1) {
          for (let col = 0; col < replayBoard[level][row].length; col += 1) {
            replayBoard[level][row][col] = null
          }
        }
      }
      replayBoard[0][3][3] = { color: 'neutral', source: 'initial' }
    }

    const renderBoard = (targetBoard: Board) => {
      disposePieceMeshes()
      for (let level = 0; level < targetBoard.length; level += 1) {
        for (let row = 0; row < targetBoard[level].length; row += 1) {
          for (let col = 0; col < targetBoard[level][row].length; col += 1) {
            const piece = targetBoard[level][row][col]
            if (!piece) {
              continue
            }
            addPieceMesh(level, row, col, piece.color)
          }
        }
      }
    }

    const basePlate = new THREE.Mesh(
      new THREE.BoxGeometry(boardSpan + 0.9, 0.12, boardSpan + 0.9),
      new THREE.MeshStandardMaterial({ color: '#d9e3f5', roughness: 0.7, metalness: 0.02 }),
    )
    basePlate.position.set(0, -0.11, 0)
    basePlate.receiveShadow = true
    boardGroup.add(basePlate)
    renderBoard(board)

    const resize = () => {
      if (!mount) {
        return
      }
      const width = mount.clientWidth
      const height = mount.clientHeight
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)

    let autoRotatePauseUntil = 0
    const pauseAutoRotate = () => {
      autoRotatePauseUntil = performance.now() + 1200
    }
    controls.addEventListener('start', pauseAutoRotate)
    controls.addEventListener('change', pauseAutoRotate)

    const clearPlaybackTimers = () => {
      playbackTimeoutIds.forEach((id) => window.clearTimeout(id))
      playbackTimeoutIds.length = 0
    }

    const queue = (delay: number, task: () => void) => {
      const id = window.setTimeout(task, delay)
      playbackTimeoutIds.push(id)
    }

    const runReplay = () => {
      if (replayingRef.current || moves.length === 0) {
        return
      }

      replayingRef.current = true
      setIsReplaying(true)
      clearPlaybackTimers()
      autoRotateEnabled = false
      resetReplayBoard()
      renderBoard(replayBoard)

      let timeline = 80

      for (const move of moves) {
        timeline += REPLAY_MANUAL_MS
        queue(timeline, () => {
          replayBoard[move.manual.level][move.manual.row][move.manual.col] = { color: move.player, source: 'manual' }
          addPieceMesh(move.manual.level, move.manual.row, move.manual.col, move.player)
          onManualSound?.()
        })

        move.autoPlacements.forEach((auto, chainIndex) => {
          timeline += REPLAY_AUTO_MS
          queue(timeline, () => {
            replayBoard[auto.level][auto.row][auto.col] = { color: auto.color, source: 'auto' }
            addPieceMesh(auto.level, auto.row, auto.col, auto.color)
            onAutoSound?.(chainIndex)
          })
        })

        timeline += REPLAY_GAP_MS
      }

      queue(timeline + 40, () => {
        replayingRef.current = false
        setIsReplaying(false)
        autoRotateEnabled = true
      })
    }

    runReplayRef.current = runReplay

    let frameId = 0
    const renderLoop = () => {
      if (autoRotateEnabled && performance.now() >= autoRotatePauseUntil) {
        boardGroup.rotation.y += 0.0035
      }
      controls.update()
      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(renderLoop)
    }
    renderLoop()

    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      clearPlaybackTimers()
      controls.removeEventListener('start', pauseAutoRotate)
      controls.removeEventListener('change', pauseAutoRotate)
      controls.dispose()
      runReplayRef.current = () => undefined
      mount.removeChild(renderer.domElement)
      diskGeometry.dispose()
      basePlate.geometry.dispose()
      ;(basePlate.material as THREE.Material).dispose()
      disposePieceMeshes()
      renderer.dispose()
    }
  }, [board, colors, moves, onAutoSound, onManualSound])

  function handlePlaybackClick(): void {
    if (isReplaying) {
      return
    }
    runReplayRef.current()
  }

  return (
    <div className="three-overlay" role="dialog" aria-modal="true">
      <div className="three-modal">
        <div className="three-head">
          <h3>Final Board 3D View</h3>
          <div className="three-actions">
            <button type="button" className="three-playback" onClick={handlePlaybackClick} disabled={isReplaying}>
              {isReplaying ? 'Playing...' : 'Playback'}
            </button>
            <button type="button" className="three-close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="three-canvas" ref={mountRef} />
      </div>
    </div>
  )
}
