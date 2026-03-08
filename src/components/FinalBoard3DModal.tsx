import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BASE_SIZE, type Board, type PieceColor } from '../game/types'

interface FinalBoard3DModalProps {
  board: Board
  colors: Record<PieceColor, string>
  onClose: () => void
}

export function FinalBoard3DModal({ board, colors, onClose }: FinalBoard3DModalProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)

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

    const diskRadius = 0.36
    const diskHeight = 0.115
    const gridSpacing = 0.7
    const levelHeight = 0.19
    const boardSpan = (BASE_SIZE - 1) * gridSpacing + diskRadius * 2
    const centerOffset = ((BASE_SIZE - 1) * gridSpacing) / 2
    const diskGeometry = new THREE.CylinderGeometry(diskRadius, diskRadius, diskHeight, 40)

    for (let level = 0; level < board.length; level += 1) {
      for (let row = 0; row < board[level].length; row += 1) {
        for (let col = 0; col < board[level][row].length; col += 1) {
          const piece = board[level][row][col]
          if (!piece) {
            continue
          }

          const x = col * gridSpacing + level * (gridSpacing / 2) - centerOffset
          const z = row * gridSpacing + level * (gridSpacing / 2) - centerOffset
          const y = level * levelHeight

          const material = new THREE.MeshStandardMaterial({
            color: colors[piece.color],
            roughness: 0.33,
            metalness: 0.06,
          })

          const mesh = new THREE.Mesh(diskGeometry, material)
          mesh.position.set(x, y, z)
          mesh.castShadow = true
          mesh.receiveShadow = true
          boardGroup.add(mesh)
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

    let frameId = 0
    const renderLoop = () => {
      if (performance.now() >= autoRotatePauseUntil) {
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
      controls.removeEventListener('start', pauseAutoRotate)
      controls.removeEventListener('change', pauseAutoRotate)
      controls.dispose()
      mount.removeChild(renderer.domElement)
      diskGeometry.dispose()
      basePlate.geometry.dispose()
      ;(basePlate.material as THREE.Material).dispose()
      boardGroup.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m: THREE.Material) => m.dispose())
          } else {
            obj.material.dispose()
          }
        }
      })
      renderer.dispose()
    }
  }, [board, colors])

  return (
    <div className="three-overlay" role="dialog" aria-modal="true">
      <div className="three-modal">
        <div className="three-head">
          <h3>Final Board 3D View</h3>
          <button type="button" className="three-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="three-canvas" ref={mountRef} />
      </div>
    </div>
  )
}
