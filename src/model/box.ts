export type BoxDimensions = {
  width: number
  height: number
  depth: number
  thickness: number
  fingerWidth: number
}

export type CutOperation = {
  id: string
  kind: 'hole' | 'half-lap'
  center: [number, number, number]
  size: [number, number, number]
  jointId?: string
  socketPatternId?: string
  socketInstanceId?: string
}

export type SocketInstance = {
  id: string
  basePosition: number
  offset: number
  deleted?: boolean
}

export type SocketPattern = {
  id: string
  panelId: string
  name: string
  distributionAxis: 0 | 1 | 2
  slotAxis: 0 | 1 | 2
  center: [number, number, number]
  span: number
  slotLength: number
  slotWidth: number
  socketType?: 'through' | 'cross'
  entrySide?: 'negative' | 'positive'
  depthRatio?: number
  instances: SocketInstance[]
  sourcePatternId?: string
  transferMode?: 'copy' | 'mirror'
}

export type BooleanOperation =
  'union' | 'subtract' | 'intersect' | 'xor' | 'reverse-subtract'

export type BooleanModifier = {
  id: string
  operation: BooleanOperation
  toolId: string
  enabled: boolean
}

export type FingerStyle = 'straight' | 'dogbone' | 't-bone'
export type FitPreset = 'press' | 'tight' | 'loose' | 'custom'
export type PanelShape =
  | { type: 'rectangle'; editedFaces?: ContourFace[] }
  | { type: 'triangle'; editedFaces?: ContourFace[] }
  | { type: 'circle'; segments: number; editedFaces?: ContourFace[] }
  | {
      type: 'star'
      points: number
      innerRatio: number
      editedFaces?: ContourFace[]
    }
  | { type: 'polygon'; sides: number; editedFaces?: ContourFace[] }
  | {
      type: 'text'
      text: string
      fontFamily: string
      fontSize: number
      display?: 'filled' | 'outline'
      operation: 'cut' | 'engrave-fill' | 'engrave-line'
      outline: TextOutline | null
      /** Manually edited Face/Edge geometry while retaining text parameters. */
      editedFaces?: ContourFace[]
    }
  | { type: 'free'; sourceType: string; faces: ContourFace[] }
export type ContourPoint = [number, number]
export type ContourFace = {
  id: string
  outer: ContourPoint[]
  holes: ContourPoint[][]
}
export type TextPathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | {
      type: 'C'
      x: number
      y: number
      x1: number
      y1: number
      x2: number
      y2: number
    }
  | { type: 'Q'; x: number; y: number; x1: number; y1: number }
  | { type: 'Z' }
export type TextOutline = {
  commands: TextPathCommand[]
  width: number
  height: number
  centerX: number
  centerY: number
}
export type LaserTextDefinition = {
  id: string
  label: string
  panelId: string
  text: string
  fontFamily: string
  fontSize: number
  position: [number, number]
  rotation: number
  operation: 'engrave-fill' | 'engrave-line' | 'cut-inner'
}
export type MaterialDefinition = {
  id: string
  name: string
  thickness: number
  kerf: number
  color: string
}
export type JointFeature = {
  id: string
  jointId: string
  operation: 'add' | 'subtract'
  shape: 'box' | 'cylinder'
  center: [number, number, number]
  size: [number, number, number]
  axis?: 0 | 1 | 2
}
export type FingerJointDefinition = {
  id: string
  firstPanelId: string
  secondPanelId: string
  connectionType: 'corner' | 't-joint'
  fingerWidth: number
  fit: FitPreset
  clearance: number
  style: FingerStyle
  reliefDiameter: number
}
export type CrossJointDefinition = {
  id: string
  firstPanelId: string
  secondPanelId: string
  ratio: number
  fit: FitPreset
  clearance: number
  firstFromHigh?: boolean
}

export type PanelDefinition = {
  id: string
  label: string
  size: [number, number, number]
  position: [number, number, number]
  rotation: [number, number, number]
  cuts: CutOperation[]
  booleanModifiers: BooleanModifier[]
  jointFeatures: JointFeature[]
  hidden: boolean
  visible?: boolean
  materialId?: string
  displayColor?: string
  shape?: PanelShape
  /** Physical parts are cut automatically unless explicitly excluded. */
  autoCut?: boolean
  /** Additional, repeatable machining recipes applied to this object's geometry. */
  processingAssignments?: {
    id: string
    profileId: string
    geometry: 'fill' | 'contour'
    /** Optional source contours when a profile applies to only part of a panel. */
    faces?: ContourFace[]
    sourceOperation?: string
  }[]
  /** Operations retained from an imported source file, such as engraving or text. */
  importedOperations?: {
    id: string
    name: string
    operation: string
    shapeType?: string
    profileId?: string
    faces: ContourFace[]
  }[]
}

export const defaultMaterials: MaterialDefinition[] = [
  {
    id: 'birch-3',
    name: 'Birke Multiplex',
    thickness: 3,
    kerf: 0.15,
    color: '#d9a96c',
  },
  {
    id: 'birch-5',
    name: 'Birke Multiplex',
    thickness: 5,
    kerf: 0.15,
    color: '#c89558',
  },
  {
    id: 'acrylic-3',
    name: 'Acryl',
    thickness: 3,
    kerf: 0.12,
    color: '#71b7c7',
  },
]

export const defaultBox: BoxDimensions = {
  width: 180,
  height: 120,
  depth: 100,
  thickness: 3,
  fingerWidth: 12,
}

export function createBoxPanels(box: BoxDimensions): PanelDefinition[] {
  const { width: w, height: h, depth: d, thickness: t } = box
  const materialId = t === 3 ? 'birch-3' : t === 5 ? 'birch-5' : undefined
  return [
    {
      id: 'front',
      label: 'Vorderseite',
      size: [w, h, t],
      position: [0, 0, d / 2 - t / 2],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId,
    },
    {
      id: 'back',
      label: 'Rückseite',
      size: [w, h, t],
      position: [0, 0, -d / 2 + t / 2],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId,
    },
    {
      id: 'left',
      label: 'Linke Seite',
      size: [t, h, d - 2 * t],
      position: [-w / 2 + t / 2, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId,
    },
    {
      id: 'right',
      label: 'Rechte Seite',
      size: [t, h, d - 2 * t],
      position: [w / 2 - t / 2, 0, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId,
    },
    {
      id: 'top',
      label: 'Deckel',
      size: [w - 2 * t, t, d - 2 * t],
      position: [0, h / 2 - t / 2, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId,
    },
    {
      id: 'bottom',
      label: 'Boden',
      size: [w - 2 * t, t, d - 2 * t],
      position: [0, -h / 2 + t / 2, 0],
      rotation: [0, 0, 0],
      cuts: [],
      booleanModifiers: [],
      jointFeatures: [],
      hidden: false,
      visible: true,
      materialId,
    },
  ]
}

export function thinAxis(panel: PanelDefinition): 0 | 1 | 2 {
  if (
    panel.shape?.type === 'text' ||
    (panel.shape?.type === 'free' &&
      (panel.shape.sourceType === 'text' || panel.shape.sourceType === 'svg'))
  )
    return 2
  return panel.size.indexOf(Math.min(...panel.size)) as 0 | 1 | 2
}
