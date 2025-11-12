# Where on the Cue Ball

Interactive React + Tailwind app for snapping cue-tip contact points on a cue ball in half-tip (6.2 mm) increments. The interface shows a white cue ball with a draggable tip marker, coordinate readouts, and export actions for PNG or SVG snapshots.

## Getting Started

```bash
npm install
npm run dev
```

The dev server uses Vite and will print a local URL. Open it in your browser and drag the black tip marker around the ball surface to explore valid contact points. The input field displays the current cardinal code (e.g., `N1 E0.5`), and the buttons export the visualization as PNG or SVG.

## Available Scripts

- `npm run dev` – start Vite in development mode.
- `npm run build` – type-check via `tsc` then build for production.
- `npm run preview` – preview the production build locally.
- `npm run lint` – run ESLint on the project.

## Deployment (GitHub Pages)

A workflow in `.github/workflows/deploy.yml` builds the site and deploys it to GitHub Pages on every push to `main` (or via the manual *Run workflow* button). Make sure Pages is configured to use the “GitHub Actions” source in your repository settings. The Vite config automatically sets the correct base path when the build runs inside GitHub Actions, so the generated assets load from `/&lt;repo-name&gt;/`.

## Tech Stack

- React 18 + TypeScript
- Vite 5
- Tailwind CSS 3
- html-to-image (PNG export helper)
