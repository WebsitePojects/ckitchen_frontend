import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const API_CONNECT_SRC_TOKEN = '__API_CONNECT_SRC__'
const DEV_CONNECT_SRC = 'http://localhost:4000 ws://localhost:4000'

/**
 * Builds the CSP `connect-src` entries (HTTP origin + matching WS origin) for the API.
 * Same env precedence and slash-stripping as src/lib/api.ts and src/lib/socket.ts so the
 * CSP allows exactly the origin the app actually calls.
 */
function resolveApiConnectSrc(apiUrl: string): string {
  const raw = apiUrl.replace(/\/+$/, '')
  if (!raw) return DEV_CONNECT_SRC

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`VITE_API_URL ("${raw}") is not a valid URL; expected http(s)://host[:port]`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`VITE_API_URL ("${raw}") must use http: or https:, got ${url.protocol}`)
  }
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${url.origin} ${wsProtocol}//${url.host}`
}

/**
 * Injects the API origin into the CSP <meta> in index.html. The CSP must be static HTML
 * (meta tag), but the API origin is a build-time env value; hardcoding it caused a
 * production outage when the backend moved. Fails the build instead of shipping a CSP
 * that would silently block every API call.
 */
function cspConnectSrcPlugin(apiUrl: string): Plugin {
  return {
    name: 'csp-connect-src',
    transformIndexHtml(html) {
      if (!html.includes(API_CONNECT_SRC_TOKEN)) {
        throw new Error(`index.html is missing the ${API_CONNECT_SRC_TOKEN} CSP placeholder`)
      }
      return html.replaceAll(API_CONNECT_SRC_TOKEN, resolveApiConnectSrc(apiUrl))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:5003'

  return {
    plugins: [react(), cspConnectSrcPlugin(env.VITE_API_URL || env.VITE_API_PROXY_TARGET || '')],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
