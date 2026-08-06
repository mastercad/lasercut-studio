import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../store/editor'
import { ConfirmDialog } from './ConfirmDialog'
import { NewProjectDialog } from './NewProjectDialog'
import { ProcessingProfileDialog } from './ProcessingProfileDialog'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Löschen"
        description="Sicher?"
        confirmLabel="Ja"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it.each(['Escape', 'backdrop', 'close', 'cancel'] as const)(
    'cancels through %s',
    async (method) => {
      const onCancel = vi.fn()
      const user = userEvent.setup()
      const { container } = render(
        <ConfirmDialog
          open
          title="Löschen"
          description="Sicher?"
          detail="Unwiderruflich"
          confirmLabel="Löschen"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      )
      if (method === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
      if (method === 'backdrop')
        fireEvent.mouseDown(container.querySelector('.modal-backdrop')!)
      if (method === 'close')
        await user.click(screen.getByLabelText('Dialog schließen'))
      if (method === 'cancel') await user.click(screen.getByText('Abbrechen'))
      expect(onCancel).toHaveBeenCalledOnce()
    },
  )

  it('confirms and exposes accessible content', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Löschen"
        description="Sicher?"
        confirmLabel="Endgültig löschen"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Löschen')
    await userEvent.click(screen.getByText('Endgültig löschen'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})

describe('NewProjectDialog', () => {
  it('supports both templates and every dismissal path', async () => {
    const onChoose = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const view = render(
      <NewProjectDialog open onChoose={onChoose} onCancel={onCancel} />,
    )
    await user.click(screen.getByText('Leeres Projekt'))
    await user.click(screen.getByText('Standardbox'))
    expect(onChoose).toHaveBeenNthCalledWith(1, 'empty')
    expect(onChoose).toHaveBeenNthCalledWith(2, 'box')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseDown(view.container.querySelector('.modal-backdrop')!)
    await user.click(screen.getByLabelText('Dialog schließen'))
    await user.click(screen.getByText('Abbrechen'))
    expect(onCancel).toHaveBeenCalledTimes(4)
    view.rerender(
      <NewProjectDialog open={false} onChoose={onChoose} onCancel={onCancel} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ProcessingProfileDialog', () => {
  it('creates, edits and removes processing profiles and closes through all controls', async () => {
    useEditor.getState().newProject('empty')
    const onClose = vi.fn()
    const user = userEvent.setup()
    const view = render(<ProcessingProfileDialog onClose={onClose} />)
    const initialCount = useEditor.getState().processingProfiles.length

    await user.click(screen.getByText('Profil anlegen'))
    expect(useEditor.getState().processingProfiles).toHaveLength(
      initialCount + 1,
    )
    const articles = view.container.querySelectorAll<HTMLElement>(
      '.profile-definition',
    )
    const created = articles[articles.length - 1]
    fireEvent.change(created.querySelector('.profile-definition-name input')!, {
      target: { value: 'Meine Gravur' },
    })
    fireEvent.change(created.querySelector('select')!, {
      target: { value: 'fill' },
    })
    fireEvent.change(created.querySelector('input[type="number"]')!, {
      target: { value: '1.25' },
    })
    fireEvent.change(created.querySelector('input[type="color"]')!, {
      target: { value: '#123456' },
    })
    expect(useEditor.getState().processingProfiles.at(-1)).toMatchObject({
      name: 'Meine Gravur',
      geometry: 'fill',
      referenceDepth: 1.25,
      color: '#123456',
    })

    await user.click(withinArticle(created).getByTitle('Profil löschen'))
    expect(useEditor.getState().processingProfiles).toHaveLength(initialCount)
    fireEvent.mouseDown(view.container.querySelector('.modal-backdrop')!)
    await user.click(screen.getByLabelText('Schließen'))
    await user.click(screen.getByText('Fertig'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

function withinArticle(article: HTMLElement) {
  return {
    getByTitle: (title: string) =>
      article.querySelector<HTMLButtonElement>(`[title="${title}"]`)!,
  }
}
