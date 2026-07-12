import fs from 'fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export const PUBLIC_ASSET_FILE_NAMES = [
  'avatar.jpg',
  'background.jpg',
  'favicon.svg',
  'manifest.webmanifest',
] as const

export function copySelectedPublicAssets({
  publicDir,
  outDir,
}: {
  publicDir: string
  outDir: string
}) {
  fs.mkdirSync(outDir, { recursive: true })
  for (const fileName of PUBLIC_ASSET_FILE_NAMES) {
    const sourcePath = path.join(publicDir, fileName)
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(outDir, fileName))
    }
  }
}

function createSelectedPublicAssetsPlugin(): Plugin {
  const rootDir = __dirname
  return {
    name: 'copy-selected-public-assets',
    apply: 'build',
    writeBundle(outputOptions) {
      const outDir = path.resolve(rootDir, outputOptions.dir || 'dist')
      copySelectedPublicAssets({
        publicDir: path.join(rootDir, 'public'),
        outDir,
      })
    },
  }
}

export default defineConfig({
  publicDir: false,
  plugins: [react(), createSelectedPublicAssetsPlugin()],
  build: {
    target: 'es2015',
    chunkSizeWarningLimit: 1000,
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand'],
          ui: ['lucide-react'],
          markdown: ['marked', 'highlight.js'],
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'lucide-react', 'marked', 'highlight.js'],
    esbuildOptions: {
      target: 'es2015',
    },
  },
  server: {
    port: 3001,
    host: true,
    cors: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    },
    allowedHosts: [
      'localhost',
      '.cpolar.top',
      '.cpolar.cn',
      '.ltpp.top',
      '.loca.lt',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
