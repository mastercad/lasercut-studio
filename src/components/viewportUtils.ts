import type { Object3D } from 'three'

export const panelIdOf = (object: Object3D | null): string | null => {
  let current = object
  while (current) {
    if (typeof current.userData.panelId === 'string')
      return current.userData.panelId
    current = current.parent
  }
  return null
}
