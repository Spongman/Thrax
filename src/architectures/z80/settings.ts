/** The Z80 machine is fixed, so it has no settings of its own. */

import { defineSettings } from '../../core/settings'

export type Z80Settings = Record<string, never>

export const Z80_SETTINGS = defineSettings<Z80Settings>({ defaults: {}, fields: [] })
