import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Serves /api/* from server/router.ts during `npm run dev` and `npm run preview`, so local
 * development uses the same backend code as the Vercel function in api/[route].ts.
 * Server-only variables (DATABASE_URL, SESSION_SECRET, ADMIN_*) are read from .env here and
 * never exposed to the browser bundle (only VITE_ / NEXT_PUBLIC_ variables are).
 */
function localApi(): Plugin {
  type Router = typeof import('./server/router.ts')
  const attach = (server: ViteDevServer | PreviewServer, load: () => Promise<Router>) => {
    server.middlewares.use((req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/')) return next()
      load().then((mod) => mod.route(req, res)).catch(next)
    })
  }
  return {
    name: 'naayan-local-api',
    configureServer(server) {
      attach(server, () => server.ssrLoadModule('/server/router.ts') as Promise<Router>)
    },
    configurePreviewServer(server) {
      attach(server, () => import('./server/router.ts'))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'SESSION_SECRET', 'ADMIN_ID', 'ADMIN_PASSWORD', 'STAFF_ID', 'STAFF_PASSWORD']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }
  return {
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  plugins: [
    localApi(),
    react(),
    VitePWA({
      selfDestroying: true,
      includeAssets: [
        'naayan-logo.png',
        'naayan-icon.png',
        'naayan-icon-192.png',
        'naayan-icon-512.png',
        'naayan-icon-maskable-192.png',
        'naayan-icon-maskable-512.png',
        'apple-touch-icon.png',
        'naayan-favicon.png',
        'robots.txt',
      ],
      manifest: {
        name: 'NAAYAN POS',
        short_name: 'NAAYAN',
        description: 'NAAYAN retail billing, barcode inventory, order, receipt, and invoice administration.',
        theme_color: '#3F3F46',
        background_color: '#3F3F46',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/naayan-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/naayan-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/naayan-icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/naayan-icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpeg,jpg,woff,woff2}'],
        navigateFallbackDenylist: [/^\/api/, /^\/admin/, /supabase/, /^\/assets\//, /\.[a-zA-Z0-9]+$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('recharts') || id.includes('d3-') || id.includes('react-smooth') || id.includes('victory-')) return 'charts'
          if (id.includes('react-router')) return 'router'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('jsbarcode') || id.includes('@zxing')) return 'barcode'
          if (id.includes('workbox') || id.includes('vite-plugin-pwa')) return 'pwa'
          return 'vendor'
        },
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
  server: {
    allowedHosts: true,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob: data:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' https: data:; connect-src 'self' https: wss: blob: data:; media-src 'self' data: blob: https:; object-src 'none'; base-uri 'self';",
    },
  },
}
})
