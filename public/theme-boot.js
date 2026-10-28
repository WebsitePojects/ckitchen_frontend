// Runs synchronously in <head> before first paint so a saved "dark" choice never flashes light.
// Light is the default (no saved choice). Mirrors next-themes (storageKey "orion-theme",
// class strategy; see ThemeProvider.tsx).
;(function () {
  try {
    var saved = localStorage.getItem('orion-theme') || 'light'
    var dark = saved === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : saved === 'dark'
    document.documentElement.classList.toggle('dark', dark)
  } catch (e) {
    // Storage blocked (private mode): stay on the light default from index.html.
  }
})()
