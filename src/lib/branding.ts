/**
 * Single source of truth for platform branding (D28 — "ORION").
 *
 * "CloudKitchen" survives ONLY as the name of outlet #1 (a `location` row) —
 * never as the product name. See platform-ia-navigation.md §1. Flip
 * PLATFORM_NAME here if the client ever reverses the Orion/Primus call —
 * nothing else in the app should hardcode the product name.
 */
export const PLATFORM_NAME = 'Orion'
export const PLATFORM_TAGLINE = 'Multi-outlet restaurant operations'
export const PLATFORM_ATTRIBUTION = 'Prince IT Solutions'

/**
 * Image for the sign-in / sign-up side panel, one per theme (files in /public). Null until
 * the artwork exists: the panel then shows the plain brand surface. Only the image for the
 * active theme is downloaded (the other layer is display:none).
 */
export const AUTH_ART: { light: string; dark: string } | null = null
