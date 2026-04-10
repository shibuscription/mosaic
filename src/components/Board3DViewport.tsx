import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { type Board, type PieceColor } from '../game/types'

interface Board3DViewportProps {
  board: Board
  colors: Record<PieceColor, string>
  pieceTextures?: Partial<Record<PieceColor, { imageUrl: string | null; useRealImage: boolean }>>
  onStartPlayback?: () => void
  onSwitchTo2D?: () => void
  playbackLabel?: string
  rotateOnLabel?: string
  rotateOffLabel?: string
  view2dLabel?: string
}

export function Board3DViewport({
  board,
  colors,
  pieceTextures,
  onStartPlayback,
  onSwitchTo2D,
  playbackLabel = 'Playback',
  rotateOnLabel = 'Rotate: On',
  rotateOffLabel = 'Rotate: Off',
  view2dLabel = '2D View',
}: Board3DViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  const autoRotateRef = useRef(true)
  const boardRef = useRef<Board>(board)
  const renderBoardRef = useRef<(targetBoard: Board) => void>(() => undefined)

  useEffect(() => {
    autoRotateRef.current = autoRotate
  }, [autoRotate])

  useEffect(() => {
    boardRef.current = board
    renderBoardRef.current(board)
  }, [board])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) {
      return
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#efe1c8')

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
    controls.enableRotate = true
    controls.enableZoom = true
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.minDistance = 5.2
    controls.maxDistance = 12
    controls.target.set(0, 0.58, 0)
    controls.update()

    const ambientLight = new THREE.AmbientLight('#ffffff', 0.45)
    const hemi = new THREE.HemisphereLight('#fff8ea', '#c4a072', 0.32)
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

    const diskRadius = 0.36
    const diskHeight = 0.115
    const gridSpacing = 0.7
    const levelHeight = 0.19
    const boardBaseSize = Math.max(1, boardRef.current.length)
    const boardSpan = (boardBaseSize - 1) * gridSpacing + diskRadius * 2
    const boardPadding = 0.22
    const boardPlateSize = boardSpan + boardPadding
    const boardPlateThickness = 0.12
    const boardCornerRadius = 0.13
    const baseHoleRadius = 0.05
    const baseHoleDepth = 0.012
    const baseHoleRimRadius = 0.072
    const baseHoleRimHeight = 0.0035
    const centerOffset = ((boardBaseSize - 1) * gridSpacing) / 2
    const diskGeometry = new THREE.CylinderGeometry(diskRadius, diskRadius, diskHeight, 40)
    const baseHoleGeometry = new THREE.CylinderGeometry(baseHoleRadius, baseHoleRadius, baseHoleDepth, 28)
    const baseHoleRimGeometry = new THREE.CylinderGeometry(baseHoleRimRadius, baseHoleRimRadius, baseHoleRimHeight, 28)
    const pieceMeshes = new Map<string, THREE.Mesh>()
    const textureLoader = new THREE.TextureLoader()
    const textureCache = new Map<string, THREE.Texture>()

    const getPieceTexture = (url: string): THREE.Texture => {
      const cached = textureCache.get(url)
      if (cached) {
        return cached
      }
      const texture = textureLoader.load(url)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
      textureCache.set(url, texture)
      return texture
    }

    const toKey = (level: number, row: number, col: number): string => `${level}-${row}-${col}`
    const addPieceMesh = (level: number, row: number, col: number, color: PieceColor) => {
      const key = toKey(level, row, col)
      if (pieceMeshes.has(key)) {
        return
      }
      const x = col * gridSpacing + level * (gridSpacing / 2) - centerOffset
      const z = row * gridSpacing + level * (gridSpacing / 2) - centerOffset
      const y = level * levelHeight
      const pieceTexture = pieceTextures?.[color]
      const material =
        pieceTexture?.useRealImage && pieceTexture.imageUrl
          ? [
              new THREE.MeshStandardMaterial({
                color: colors[color],
                roughness: 0.42,
                metalness: 0.04,
              }),
              new THREE.MeshStandardMaterial({
                color: '#ffffff',
                map: getPieceTexture(pieceTexture.imageUrl),
                roughness: 0.3,
                metalness: 0.04,
              }),
              new THREE.MeshStandardMaterial({
                color: '#ffffff',
                map: getPieceTexture(pieceTexture.imageUrl),
                roughness: 0.3,
                metalness: 0.04,
              }),
            ]
          : new THREE.MeshStandardMaterial({
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
    renderBoardRef.current = renderBoard

    const roundedShape = createRoundedSquareShape(boardPlateSize, boardCornerRadius)
    const basePlateGeometry = new THREE.ExtrudeGeometry(roundedShape, {
      depth: boardPlateThickness,
      bevelEnabled: false,
      curveSegments: 10,
    })
    // Convert XY + depth geometry into a thin plate on XZ plane.
    basePlateGeometry.rotateX(-Math.PI / 2)
    const topSurfaceY = -0.05
    basePlateGeometry.translate(0, topSurfaceY - boardPlateThickness, 0)
    const basePlate = new THREE.Mesh(
      basePlateGeometry,
      new THREE.MeshStandardMaterial({ color: '#d9b98b', roughness: 0.76, metalness: 0.02 }),
    )
    basePlate.receiveShadow = true
    boardGroup.add(basePlate)

    const baseHoleMaterial = new THREE.MeshStandardMaterial({
      color: '#705036',
      roughness: 0.94,
      metalness: 0.01,
    })
    const baseHoleRimMaterial = new THREE.MeshStandardMaterial({
      color: '#ccaa83',
      roughness: 0.9,
      metalness: 0.01,
    })

    for (let row = 0; row < boardBaseSize; row += 1) {
      for (let col = 0; col < boardBaseSize; col += 1) {
        const x = col * gridSpacing - centerOffset
        const z = row * gridSpacing - centerOffset

        const holeRim = new THREE.Mesh(baseHoleRimGeometry, baseHoleRimMaterial)
        holeRim.position.set(x, topSurfaceY - baseHoleRimHeight * 0.42, z)
        holeRim.receiveShadow = true
        boardGroup.add(holeRim)

        const hole = new THREE.Mesh(baseHoleGeometry, baseHoleMaterial)
        hole.position.set(x, topSurfaceY - baseHoleDepth * 0.62, z)
        hole.receiveShadow = true
        boardGroup.add(hole)
      }
    }

    renderBoard(boardRef.current)

    const resize = () => {
      const width = Math.max(1, mount.clientWidth)
      const height = Math.max(1, mount.clientHeight)
      renderer.setSize(width, height)
      camera.aspect = width / height
      if (width <= 420) {
        camera.fov = 48
        camera.position.set(6.15, 6.8, 7.95)
      } else {
        camera.fov = 42
        camera.position.set(5.35, 6.0, 6.65)
      }
      camera.updateProjectionMatrix()
      controls.update()
    }

    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)

    const onManualStart = () => setAutoRotate(false)
    controls.addEventListener('start', onManualStart)

    let frameId = 0
    const renderLoop = () => {
      if (autoRotateRef.current) {
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
      controls.removeEventListener('start', onManualStart)
      controls.dispose()
      mount.removeChild(renderer.domElement)
      diskGeometry.dispose()
      baseHoleGeometry.dispose()
      baseHoleRimGeometry.dispose()
      basePlateGeometry.dispose()
      ;(basePlate.material as THREE.Material).dispose()
      baseHoleMaterial.dispose()
      baseHoleRimMaterial.dispose()
      disposePieceMeshes()
      textureCache.forEach((texture) => texture.dispose())
      textureCache.clear()
      renderer.dispose()
    }
  }, [colors, pieceTextures, board.length])

  return (
    <div className="inline-3d-shell">
      <div className="inline-3d-controls">
        {onStartPlayback ? (
          <button type="button" className="inline-3d-playback" onClick={onStartPlayback}>
            {playbackLabel}
          </button>
        ) : null}
        <button type="button" className="inline-3d-rotate" onClick={() => setAutoRotate((prev) => !prev)}>
          {autoRotate ? rotateOnLabel : rotateOffLabel}
        </button>
        {onSwitchTo2D ? (
          <button type="button" className="inline-3d-back" onClick={onSwitchTo2D}>
            {view2dLabel}
          </button>
        ) : null}
      </div>
      <div className="inline-3d-canvas" ref={mountRef} />
    </div>
  )
}

function createRoundedSquareShape(size: number, radius: number): THREE.Shape {
  const half = size / 2
  const r = Math.min(radius, half * 0.3)
  const shape = new THREE.Shape()

  shape.moveTo(-half + r, -half)
  shape.lineTo(half - r, -half)
  shape.quadraticCurveTo(half, -half, half, -half + r)
  shape.lineTo(half, half - r)
  shape.quadraticCurveTo(half, half, half - r, half)
  shape.lineTo(-half + r, half)
  shape.quadraticCurveTo(-half, half, -half, half - r)
  shape.lineTo(-half, -half + r)
  shape.quadraticCurveTo(-half, -half, -half + r, -half)

  return shape
}
