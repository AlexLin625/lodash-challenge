import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const GENERATED_DIR = path.join(ROOT, 'generated')

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

/**
 * Serves the statically generated challenge assets:
 *  - dev: `/generated/...` is resolved from the `generated/` directory on disk,
 *  - build: `generated/` is copied into the output directory.
 *
 * This keeps both `vite dev` and the production bundle able to `fetch`
 * `/generated/catalog.json`, `/generated/challenges/<id>/manifest.json`, etc.
 */
function generatedAssetsPlugin(): Plugin {
  let config: ResolvedConfig | null = null

  return {
    name: 'lodash-challenge-generated-assets',
    configResolved(resolved) {
      config = resolved
    },
    configureServer(server) {
      server.middlewares.use('/generated', (req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0])
        const filePath = path.normalize(path.join(GENERATED_DIR, url))
        if (filePath !== GENERATED_DIR && !filePath.startsWith(GENERATED_DIR + path.sep)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          next()
          return
        }
        const ext = path.extname(filePath)
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(filePath).pipe(res)
      })
    },
    closeBundle() {
      if (!config) {
        return
      }
      const outDir = path.resolve(config.root, config.build.outDir)
      if (outDir !== GENERATED_DIR) {
        fs.cpSync(GENERATED_DIR, path.join(outDir, 'generated'), { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), generatedAssetsPlugin()],
})
