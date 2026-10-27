// Runs synchronously in <head> before first paint so a saved "light" choice never flashes dark.
// Mirrors next-themes (storageKey "orion-theme", class strategy; see ThemeProvider.tsx).
;(function () {
  try {
    var saved = localStorage.getItem('orion-theme') || 'dark'
    var dark = saved === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : saved !== 'light'
    document.documentElement.classList.toggle('dark', dark)
  } catch (e) {
    // Storage blocked (private mode): keep the default dark class from index.html.
  }
})()
