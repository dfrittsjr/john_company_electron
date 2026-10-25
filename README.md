# John Company (unofficial browser edition)

An unofficial, non-commercial browser adaptation of *John Company: Second Edition* (Cole Wehrle,
Wehrlegig Games). Players take their turns and pass a `.joco` save file to whoever acts next.
The site is built with [Astro](https://astro.build) and React and served as static assets from a
Cloudflare Worker. See `NOTICE.md` for credits and licensing.

The game engine is still incomplete; see `docs/first-pass-todo.md`.

## Requirements

- Node.js 22.23 or newer (Astro 7 requirement)
- npm

```bash
npm install
```

## Develop

```bash
npm run dev        # Astro dev server with hot reload at http://127.0.0.1:4321
npm test           # Vitest engine, data, and save tests
npm run typecheck  # astro check + tsc
```

Pages live in `src/pages` (`/`, `/play/`, `/how-to-play/`, `/credits/`). The game screen is the
React app in `src/ui/App.tsx`, mounted on `/play/` with `client:only="react"`. Browser file
handling (save, load, clipboard) is in `src/ui/platform/files.ts`.

## Build and preview

```bash
npm run build      # typecheck, then build the static site into dist/
npm run preview    # serve dist/ with Astro; stop it with `npx astro preview stop`
npm run cf:preview # build, then serve dist/ through the local Cloudflare runtime (wrangler dev)
```

The build targets Chrome 87, Edge 88, Firefox 78, and Safari 14 so older machines (for example
Firefox 115 ESR on an old Mac) can still run it.

## Deploy to Cloudflare

`wrangler.jsonc` configures a static-assets-only Worker named `john-company` that serves `dist/`.

```bash
npx wrangler login   # once, opens a browser to authorize your Cloudflare account
npm run deploy       # astro build && wrangler deploy
```

The site is published at `https://john-company.<your-subdomain>.workers.dev`. To keep it to your
group, put Cloudflare Access (Zero Trust) in front of it.

## Board image

`board_image-1.png` (17.5 MB) is the source image. The site ships
`public/images/board.webp`, generated with:

```bash
python3 -I -c "from PIL import Image; Image.MAX_IMAGE_PIXELS=None; Image.open('board_image-1.png').convert('RGB').save('public/images/board.webp','WEBP',quality=80,method=6)"
```
