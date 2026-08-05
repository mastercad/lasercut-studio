import type { PanelDefinition } from './box'

export function linkedBooleanToolIds(
  rootId: string,
  panels: PanelDefinition[],
) {
  const linked = new Set<string>()
  const visit = (id: string) => {
    const panel = panels.find((candidate) => candidate.id === id)
    for (const modifier of panel?.booleanModifiers ?? []) {
      if (!linked.has(modifier.toolId)) {
        linked.add(modifier.toolId)
        visit(modifier.toolId)
      }
    }
  }
  visit(rootId)
  return linked
}
