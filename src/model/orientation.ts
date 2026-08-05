import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { thinAxis, type PanelDefinition } from './box'

const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

export function worldAxisForLocal(
  panel: PanelDefinition,
  localAxis: 0 | 1 | 2,
): 0 | 1 | 2 {
  const vector = axes[localAxis]
    .clone()
    .applyEuler(new Euler(...panel.rotation))
  const values = [Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z)]
  return values.indexOf(Math.max(...values)) as 0 | 1 | 2
}

export function localAxisForWorld(
  panel: PanelDefinition,
  worldAxis: 0 | 1 | 2,
): 0 | 1 | 2 {
  const matrix = new Matrix4()
    .makeRotationFromEuler(new Euler(...panel.rotation))
    .invert()
  const vector = axes[worldAxis].clone().applyMatrix4(matrix)
  const values = [Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z)]
  return values.indexOf(Math.max(...values)) as 0 | 1 | 2
}

export function worldThinAxis(panel: PanelDefinition): 0 | 1 | 2 {
  return worldAxisForLocal(panel, thinAxis(panel))
}

export function worldOffsetInLocal(
  panel: PanelDefinition,
  worldOffset: [number, number, number],
): [number, number, number] {
  const inverseRotation = new Quaternion()
    .setFromEuler(new Euler(...panel.rotation))
    .invert()
  const vector = new Vector3(...worldOffset).applyQuaternion(inverseRotation)
  return vector.toArray() as [number, number, number]
}
