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
/**
 * Clerk's Frontend API host, decoded from the publishable key (pk_test_/pk_live_ + base64
 * of "<host>$"). Clerk's sign-in widget loads its script from and talks to that host, so
 * the CSP must allow exactly it. Returns null when Clerk is not configured.
 */
function clerkFrontendApiHost(publishableKey: string): string | null {
  const key = publishableKey.trim()
  if (!key) return null
  const match = /^pk_(test|live)_(.+)$/.exec(key)
  if (!match) throw new Error('VITE_CLERK_PUBLISHABLE_KEY must look like pk_test_... or pk_live_...')
  const decoded = Buffer.from(match[2]!, 'base64').toString('utf8').replace(/\$$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(decoded)) {
    throw new Error('VITE_CLERK_PUBLISHABLE_KEY does not decode to a valid Clerk host')
  }
  return decoded
}

/** Adds sources to one CSP directive, creating the directive if it is absent. */
function addCspSources(csp: string, directive: string, sources: string[]): string {
  // Doubled backslashes: inside a template string a lone \s would collapse to a plain "s".
  const re = new RegExp(`(^|;\\s*)${directive}\\s+([^;]*)`)
  return re.test(csp)
    ? csp.replace(re, (_m, lead: string, existing: string) => `${lead}${directive} ${existing} ${sources.join(' ')}`)
    : `${csp}; ${directive} ${sources.join(' ')}`
}

/**
 * With Clerk enabled, allow exactly what its sign-in widget needs (per Clerk's CSP guide):
 * its Frontend API host for script + requests, its image CDN, Cloudflare's bot check, and its
 * fraud/abuse protection (*.protect.clerk.com; connect-src needs :* because a host without a
 * port only matches 443). Source: clerk.com/docs/guides/secure/best-practices/csp-headers.
 */
function cspClerkPlugin(publishableKey: string): Plugin {
  return {
    name: 'csp-clerk',
    transformIndexHtml(html) {
      const host = clerkFrontendApiHost(publishableKey)
      if (!host) return html
      return html.replace(/content="(default-src[^"]*)"/, (_m, csp: string) => {
        let next = csp
        next = addCspSources(next, 'script-src', [`https://${host}`, 'https://challenges.cloudflare.com', 'https://*.protect.clerk.com'])
        next = addCspSources(next, 'connect-src', [`https://${host}`, 'https://*.protect.clerk.com:*'])
        next = addCspSources(next, 'img-src', ['https://img.clerk.com'])
        next = addCspSources(next, 'frame-src', ["'self'", 'https://challenges.cloudflare.com', 'https://*.protect.clerk.com'])
        next = addCspSources(next, 'worker-src', ["'self'", 'blob:'])
        return `content="${next}"`
      })
    },
  }
}

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

/**
 * Opens the connections to the API and to Clerk while the app bundle is still downloading.
 * From the Philippines a new TLS connection to the Paris API costs about two round trips
 * (~0.5 s), and the first API and Clerk calls only start after the JavaScript runs.
 * The API link carries `crossorigin` because the app's fetches are anonymous CORS requests;
 * Clerk's script and its credentialed calls share a connection without it.
 */
function preconnectPlugin(apiUrl: string, publishableKey: string): Plugin {
  return {
    name: 'preconnect',
    transformIndexHtml(html) {
      const links: string[] = []
      const api = apiUrl.replace(/\/+$/, '')
      if (/^https?:\/\//.test(api)) links.push(`<link rel="preconnect" href="${new URL(api).origin}" crossorigin />`)
      const clerkHost = clerkFrontendApiHost(publishableKey)
      if (clerkHost) links.push(`<link rel="preconnect" href="https://${clerkHost}" />`)
      return links.length ? html.replace('</head>', `  ${links.join('\n    ')}\n  </head>`) : html
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:5003'

  return {
    plugins: [
      react(),
      cspConnectSrcPlugin(env.VITE_API_URL || env.VITE_API_PROXY_TARGET || ''),
      cspClerkPlugin(env.VITE_CLERK_PUBLISHABLE_KEY || ''),
      preconnectPlugin(env.VITE_API_URL || '', env.VITE_CLERK_PUBLISHABLE_KEY || ''),
    ],
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
