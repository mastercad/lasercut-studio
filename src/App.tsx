import { Box, LayoutTemplate } from 'lucide-react'
import { Properties } from './components/Properties'
import { SceneTree } from './components/SceneTree'
import { Toolbar } from './components/Toolbar'
import { Viewport } from './components/Viewport'
import { ExportWorkspace } from './components/ExportWorkspace'
import { LaserManager } from './components/LaserManager'
import { useEditor } from './store/editor'
import {
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'

const uiSettingsKey = 'lasercut-studio.ui.v1'
const defaultSidebarWidths = { left: 235, right: 284 }
const readSidebarWidths = () => {
  if (typeof localStorage === 'undefined') return defaultSidebarWidths
  try {
    const saved = JSON.parse(
      localStorage.getItem(uiSettingsKey) || '{}',
    ) as Partial<typeof defaultSidebarWidths>
    return {
      left: Math.max(
        190,
        Math.min(520, Number(saved.left) || defaultSidebarWidths.left),
      ),
      right: Math.max(
        240,
        Math.min(520, Number(saved.right) || defaultSidebarWidths.right),
      ),
    }
  } catch {
    return defaultSidebarWidths
  }
}

export default function App() {
  const workspace = useEditor((state) => state.workspace)
  const setWorkspace = useEditor((state) => state.setWorkspace)
  const editorGridRef = useRef<HTMLDivElement>(null)
  const sidebarWidths = useRef(readSidebarWidths())
  const resizeDrag = useRef<{
    side: 'left' | 'right'
    pointerId: number
  } | null>(null)
  const applySidebarWidths = () => {
    const grid = editorGridRef.current
    if (!grid) return
    grid.style.setProperty('--sidebar-left', `${sidebarWidths.current.left}px`)
    grid.style.setProperty(
      '--sidebar-right',
      `${sidebarWidths.current.right}px`,
    )
  }
  const beginResize = (
    side: 'left' | 'right',
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    resizeDrag.current = { side, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('active')
  }
  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current
    const rect = editorGridRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !rect) return
    const otherWidth =
      drag.side === 'left'
        ? sidebarWidths.current.right
        : sidebarWidths.current.left
    const available = Math.max(190, rect.width - otherWidth - 430 - 10)
    const width =
      drag.side === 'left'
        ? event.clientX - rect.left
        : rect.right - event.clientX
    sidebarWidths.current[drag.side] = Math.round(
      Math.max(
        drag.side === 'left' ? 190 : 240,
        Math.min(520, available, width),
      ),
    )
    applySidebarWidths()
  }
  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeDrag.current?.pointerId !== event.pointerId) return
    resizeDrag.current = null
    event.currentTarget.classList.remove('active')
    localStorage.setItem(uiSettingsKey, JSON.stringify(sidebarWidths.current))
  }
  const resetSidebar = (side: 'left' | 'right') => {
    sidebarWidths.current[side] = defaultSidebarWidths[side]
    applySidebarWidths()
    localStorage.setItem(uiSettingsKey, JSON.stringify(sidebarWidths.current))
  }
  const gridStyle = {
    '--sidebar-left': `${sidebarWidths.current.left}px`,
    '--sidebar-right': `${sidebarWidths.current.right}px`,
  } as CSSProperties

  return (
    <main className="app-shell">
      <Toolbar />
      <nav className="workspace-tabs">
        <button
          className={workspace === 'model' ? 'active' : ''}
          aria-current={workspace === 'model' ? 'page' : undefined}
          onClick={() => setWorkspace('model')}
        >
          <Box />
          3D-Modell
        </button>
        <button
          className={workspace === 'unfold' ? 'active' : ''}
          aria-current={workspace === 'unfold' ? 'page' : undefined}
          onClick={() => setWorkspace('unfold')}
        >
          <LayoutTemplate />
          Fertigung
        </button>
      </nav>
      <div ref={editorGridRef} className="editor-grid" style={gridStyle}>
        <SceneTree />
        <div
          className="sidebar-resizer left"
          role="separator"
          aria-label="Linke Seitenleiste vergrößern oder verkleinern"
          aria-orientation="vertical"
          onPointerDown={(event) => beginResize('left', event)}
          onPointerMove={resizeSidebar}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={() => resetSidebar('left')}
        >
          <i />
        </div>
        {workspace === 'model' ? <Viewport /> : <ExportWorkspace />}
        <div
          className="sidebar-resizer right"
          role="separator"
          aria-label="Rechte Seitenleiste vergrößern oder verkleinern"
          aria-orientation="vertical"
          onPointerDown={(event) => beginResize('right', event)}
          onPointerMove={resizeSidebar}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={() => resetSidebar('right')}
        >
          <i />
        </div>
        {workspace === 'model' ? <Properties /> : <LaserManager />}
      </div>
      <footer>
        <span className="status-ready" /> Bereit <span>Box 01</span>
        <span>180 × 120 × 100 mm</span>
        <span className="status-right">Raster 10 mm · Perspektive</span>
      </footer>
    </main>
  )
}
