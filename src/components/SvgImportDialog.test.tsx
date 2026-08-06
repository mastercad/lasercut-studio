import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditor } from '../store/editor'
import {
  parseDxfImport,
  parseLbrn2Import,
  parseLbrnImport,
  parseSvgImport,
  type SvgImportDocument,
} from '../model/svgImport'
import { SvgImportDialog } from './SvgImportDialog'

vi.mock('../model/svgImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../model/svgImport')>()),
  parseSvgImport: vi.fn(),
  parseDxfImport: vi.fn(),
  parseLbrnImport: vi.fn(),
  parseLbrn2Import: vi.fn(),
}))

const documentFixture = {
  fileName: 'teile.svg',
  sourceWidth: 100,
  sourceHeight: 50,
  widthMm: 100,
  heightMm: 50,
  hasReliableSize: false,
  warnings: [{ message: 'Offener Pfad ignoriert' }],
  objects: [
    {
      id: 'a',
      name: 'Teil A',
      groupName: 'Gruppe A',
      color: '#d9a96c',
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
      faces: [
        {
          id: 'fa',
          outer: [
            [0, 0],
            [40, 0],
            [40, 20],
            [0, 20],
          ],
          holes: [],
        },
      ],
    },
    {
      id: 'b',
      name: 'Teil B',
      groupName: 'Gruppe B',
      color: '#336699',
      bounds: { minX: 50, minY: 0, maxX: 100, maxY: 50 },
      faces: [
        {
          id: 'fb',
          outer: [
            [50, 0],
            [100, 0],
            [100, 50],
            [50, 50],
          ],
          holes: [],
        },
      ],
    },
  ],
} as never

const svgFile = {
  name: 'teile.svg',
  type: 'image/svg+xml',
  text: vi.fn(async () => '<svg/>'),
} as unknown as File

beforeEach(() => {
  useEditor.getState().newProject('empty')
  vi.mocked(parseSvgImport).mockReturnValue(documentFixture)
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(cleanup)

describe('SvgImportDialog', () => {
  it('renders nothing while closed', () => {
    render(<SvgImportDialog open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects non-SVG files and reports parser failures', async () => {
    const { container } = render(<SvgImportDialog open onClose={vi.fn()} />)
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [{ name: 'bad.txt' }] } })
    expect(
      await screen.findByText(
        'Bitte eine Datei mit der Endung .svg, .dxf, .lbrn oder .lbrn2 auswählen.',
      ),
    ).toBeInTheDocument()
    vi.mocked(parseSvgImport).mockImplementationOnce(() => {
      throw new Error('Ungültiges SVG')
    })
    fireEvent.change(input, { target: { files: [svgFile] } })
    expect(await screen.findByText('Ungültiges SVG')).toBeInTheDocument()
  })

  it('routes DXF and legacy LBRN files to their dedicated importers', async () => {
    vi.mocked(parseDxfImport).mockReturnValue({
      ...(documentFixture as object),
      fileName: 'part.dxf',
      sourceFormat: 'dxf',
    } as never)
    vi.mocked(parseLbrnImport).mockReturnValue({
      ...(documentFixture as object),
      fileName: 'legacy.lbrn',
      sourceFormat: 'lbrn',
    } as never)
    const { rerender } = render(
      <SvgImportDialog
        open
        initialFile={
          {
            name: 'part.dxf',
            text: vi.fn(async () => 'DXF'),
          } as unknown as File
        }
        onClose={vi.fn()}
      />,
    )
    expect(await screen.findByText('DXF-Datei importieren')).toBeInTheDocument()
    expect(parseDxfImport).toHaveBeenCalledWith('DXF', 'part.dxf')

    rerender(
      <SvgImportDialog
        open
        initialFile={
          {
            name: 'legacy.lbrn',
            text: vi.fn(async () => 'LBRN'),
          } as unknown as File
        }
        onClose={vi.fn()}
      />,
    )
    expect(
      await screen.findByText('LightBurn-Projekt importieren'),
    ).toBeInTheDocument()
    expect(parseLbrnImport).toHaveBeenCalledWith('LBRN', 'legacy.lbrn')
  })

  it('loads LBRN2 files and downloads the locally converted SVG', async () => {
    vi.mocked(parseLbrn2Import).mockReturnValue({
      ...(documentFixture as object),
      fileName: 'projekt.lbrn2',
      sourceFormat: 'lbrn2',
      convertedSvg: '<svg/>',
    } as never)
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:svg'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    )
    const file = {
      name: 'projekt.lbrn2',
      text: vi.fn(async () => '<LightBurnProject/>'),
    } as unknown as File
    render(<SvgImportDialog open initialFile={file} onClose={vi.fn()} />)
    expect(await screen.findByText('Endgröße bestätigen')).toBeInTheDocument()
    expect(parseLbrn2Import).toHaveBeenCalledWith(
      '<LightBurnProject/>',
      'projekt.lbrn2',
    )
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.change(
      screen.getByLabelText('Material für alle verwendeten Formen'),
      { target: { value: 'birch-3' } },
    )
    fireEvent.click(screen.getByText('Weiter'))
    expect(
      screen.getByText('LightBurn-Projekt importieren'),
    ).toBeInTheDocument()
    vi.useFakeTimers()
    fireEvent.click(screen.getByText('Als SVG speichern'))
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg')
    vi.useRealTimers()
  })

  it('accepts SVG files through the complete drag-and-drop interaction', async () => {
    const { container } = render(<SvgImportDialog open onClose={vi.fn()} />)
    const dropzone = container.querySelector<HTMLElement>('.svg-drop-zone')!
    const input = dropzone.querySelector<HTMLInputElement>('input')!
    const click = vi.spyOn(input, 'click')
    fireEvent.click(dropzone)
    expect(click).toHaveBeenCalledOnce()
    fireEvent.dragOver(dropzone)
    expect(dropzone).toHaveClass('dragging')
    fireEvent.dragLeave(dropzone)
    expect(dropzone).not.toHaveClass('dragging')
    fireEvent.dragOver(dropzone)
    fireEvent.drop(dropzone, { dataTransfer: { files: [svgFile] } })
    expect(await screen.findByText('Endgröße bestätigen')).toBeInTheDocument()
  })

  it('reads an initial file, preserves aspect ratio and imports selected assigned objects', async () => {
    const onRead = vi.fn(),
      onClose = vi.fn()
    const { container } = render(
      <SvgImportDialog
        open
        initialFile={svgFile}
        onInitialFileRead={onRead}
        onClose={onClose}
      />,
    )
    expect(await screen.findByText('Endgröße bestätigen')).toBeInTheDocument()
    expect(onRead).toHaveBeenCalledOnce()
    expect(screen.getByText('Bitte Maße prüfen')).toBeInTheDocument()
    const sizeInputs = container.querySelectorAll<HTMLInputElement>(
      '.svg-size-fields input',
    )
    fireEvent.change(sizeInputs[0], { target: { value: '200' } })
    expect(sizeInputs[1]).toHaveValue(100)
    fireEvent.click(screen.getByTitle('Seitenverhältnis koppeln'))
    fireEvent.change(sizeInputs[1], { target: { value: '75' } })
    expect(sizeInputs[0]).toHaveValue(200)
    fireEvent.click(screen.getByText('Weiter'))
    expect(screen.getByText('Material zuweisen')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Teil B importieren'))
    fireEvent.change(
      screen.getByLabelText('Material für alle verwendeten Formen'),
      { target: { value: 'birch-3' } },
    )
    fireEvent.click(screen.getByText('Weiter'))
    expect(screen.getByText('Bereit für die 3D-Ansicht')).toBeInTheDocument()
    expect(screen.getByText('Offener Pfad ignoriert')).toBeInTheDocument()
    fireEvent.click(screen.getByText('In 3D übernehmen'))
    await waitFor(() => expect(useEditor.getState().panels).toHaveLength(1))
    expect(useEditor.getState().panels[0]).toMatchObject({
      label: 'Teil A',
      materialId: 'birch-3',
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('draws large enclosing contours behind smaller details', async () => {
    const fixture = documentFixture as unknown as SvgImportDocument
    const largeLast = {
      ...(documentFixture as object),
      objects: [
        fixture.objects[0],
        {
          ...fixture.objects[1],
          bounds: { minX: -100, minY: -100, maxX: 200, maxY: 200 },
        },
      ],
    } as never
    vi.mocked(parseSvgImport).mockReturnValue(largeLast)
    const { container } = render(
      <SvgImportDialog open initialFile={svgFile} onClose={vi.fn()} />,
    )
    expect(await screen.findByText('Endgröße bestätigen')).toBeInTheDocument()
    const paths = container.querySelectorAll(
      '.svg-preview-canvas > svg > path:not(.selection-halo)',
    )
    expect(paths).toHaveLength(2)
    expect(paths[0]).toHaveAttribute('d', expect.stringContaining('50,0'))
    expect(paths[1]).toHaveAttribute('d', expect.stringContaining('0,0'))
  })

  it('selects preview objects, assigns materials, excludes objects and navigates backward', async () => {
    const { container } = render(
      <SvgImportDialog open initialFile={svgFile} onClose={vi.fn()} />,
    )
    await screen.findByText('Endgröße bestätigen')
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.click(screen.getByText('Teil A'))
    expect(screen.getByText(/1 Form ausgewählt/)).toBeInTheDocument()
    expect(
      container.querySelectorAll('.svg-preview-canvas .selection-halo'),
    ).toHaveLength(1)
    expect(
      container.querySelector('.svg-preview-canvas .dimmed'),
    ).not.toBeNull()
    expect(
      container
        .querySelector('.svg-preview-canvas > svg')
        ?.getAttribute('viewBox'),
    ).not.toBe('0 -50 100 50')
    fireEvent.click(screen.getByText('Teil A'))
    expect(screen.getByText(/Keine Form ausgewählt/)).toBeInTheDocument()
    expect(
      container
        .querySelector('.svg-preview-canvas > svg')
        ?.getAttribute('viewBox'),
    ).toBe('0 -50 100 50')
    expect(
      container.querySelectorAll('.svg-preview-canvas .selection-halo'),
    ).toHaveLength(0)
    fireEvent.click(screen.getByText('Teil A'))
    const selectedPath = container.querySelector(
      '.svg-preview-canvas path.selected:not(.selection-halo)',
    )!
    fireEvent.click(selectedPath)
    expect(screen.getByText(/Keine Form ausgewählt/)).toBeInTheDocument()
    fireEvent.click(selectedPath)
    fireEvent.change(screen.getByLabelText('Material für ausgewählte Formen'), {
      target: { value: 'acrylic-3' },
    })
    fireEvent.change(screen.getByLabelText('Material für Teil B'), {
      target: { value: 'birch-5' },
    })
    fireEvent.click(screen.getByText('Alle verwendeten Formen auswählen'))
    expect(screen.getByText(/2 Formen ausgewählt/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Teil A importieren'))
    expect(screen.getByText(/1 von 2 Formen/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Zurück'))
    expect(screen.getByText('Endgröße bestätigen')).toBeInTheDocument()
  })

  it('reviews every material part explicitly in the optional material wizard', async () => {
    render(<SvgImportDialog open initialFile={svgFile} onClose={vi.fn()} />)
    await screen.findByText('Endgröße bestätigen')
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.click(screen.getByText('Materialwizard verwenden'))

    expect(screen.getByText('Objekt 1 von 2')).toBeInTheDocument()
    expect(screen.getByText('0 vollständig kontrolliert')).toBeInTheDocument()
    expect(screen.getByText('Weiter')).toBeDisabled()

    fireEvent.change(
      screen.getByLabelText('Materialwizard: Material für Teil A'),
      { target: { value: 'birch-3' } },
    )
    await waitFor(() =>
      expect(screen.getByText('Objekt 2 von 2')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('Dieses Objekt nicht importieren'))
    expect(screen.getByText('2 vollständig kontrolliert')).toBeInTheDocument()
    expect(screen.getByText('Weiter')).toBeEnabled()

    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.click(screen.getByText('In 3D übernehmen'))
    await waitFor(() => expect(useEditor.getState().panels).toHaveLength(1))
    expect(useEditor.getState().panels[0]).toMatchObject({
      label: 'Teil A',
      materialId: 'birch-3',
    })
  })

  it('zooms, resets, wheels and pans the real SVG viewBox without CSS scaling', async () => {
    const { container } = render(
      <SvgImportDialog open initialFile={svgFile} onClose={vi.fn()} />,
    )
    await screen.findByText('Endgröße bestätigen')
    const svg = container.querySelector<SVGSVGElement>(
      '.svg-preview-canvas svg',
    )!
    Object.defineProperty(svg, 'getScreenCTM', {
      value: () => ({ inverse: () => ({}) }),
    })
    vi.stubGlobal(
      'DOMPoint',
      class {
        constructor(
          public x: number,
          public y: number,
        ) {}
        matrixTransform() {
          return this
        }
      },
    )
    fireEvent.click(screen.getByLabelText('Vorschau vergrößern'))
    expect(svg.getAttribute('viewBox')).not.toBe('0 -50 100 50')
    expect(container.querySelector('output')).toHaveValue('135%')
    fireEvent.wheel(container.querySelector('.svg-preview-canvas')!, {
      deltaY: -100,
      clientX: 20,
      clientY: 20,
    })
    fireEvent.pointerDown(container.querySelector('.svg-preview-canvas')!, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerMove(container.querySelector('.svg-preview-canvas')!, {
      pointerId: 1,
      clientX: 30,
      clientY: 20,
    })
    fireEvent.pointerUp(container.querySelector('.svg-preview-canvas')!, {
      pointerId: 1,
    })
    fireEvent.pointerDown(container.querySelector('.svg-preview-canvas')!, {
      pointerId: 2,
      clientX: 5,
      clientY: 5,
    })
    fireEvent.pointerCancel(container.querySelector('.svg-preview-canvas')!, {
      pointerId: 2,
    })
    fireEvent.pointerDown(container.querySelector('.svg-preview-controls')!)
    fireEvent.click(screen.getByLabelText('Vorschau verkleinern'))
    fireEvent.click(screen.getByLabelText('Gesamte Vorlage einpassen'))
    fireEvent.doubleClick(container.querySelector('.svg-preview-canvas')!)
    expect(svg.getAttribute('viewBox')).toBe('0 -50 100 50')
  })

  it('closes through button, backdrop and cancel', async () => {
    const onClose = vi.fn()
    const view = render(<SvgImportDialog open onClose={onClose} />)
    await userEvent.click(screen.getByLabelText('Import schließen'))
    fireEvent.mouseDown(view.container.querySelector('.svg-import-backdrop')!)
    await userEvent.click(screen.getByText('Abbrechen'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
