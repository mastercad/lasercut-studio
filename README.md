# LaserCut Studio

Web-first 3D editor for parametric laser-cut designs. The current foundation provides a real Three.js viewport, Blender-style camera navigation, selectable box panels, and live dimensions in millimetres.

## Development

```bash
npm install
npm run dev
```

## Desktop development

```bash
npm run dev:desktop
```

## Verification

```bash
npm run quality
```

The same quality gate (type checking, ESLint, Prettier, tests, and production
build) runs in GitHub Actions for pushes and pull requests.

## Desktop packages

```bash
npm run build:desktop
```

Builds are written to `release/`. After the quality gate succeeds, GitHub
Actions creates a standalone and an installer for Linux (AppImage/deb), Windows
(portable/NSIS), and macOS (zip/dmg) on pushes to `main`, manual runs, and
successful deployment events. Once all six files exist, they are published
together as a downloadable GitHub Release tagged with the workflow build number.

## Roadmap

1. Finger-joint geometry and kerf compensation
2. Editable plate primitives and snapping
3. 2D unfolding and sheet layout
4. SVG/DXF export
5. Electron desktop packaging
