export * from './protocol.js'
export * from './web-bluetooth.js'
export type * from './bluetooth-types.js'

import { PuquWebBluetoothPrinter } from './web-bluetooth.js'

/** Shared default instance for simple applications. */
export const puquPrinter = new PuquWebBluetoothPrinter()
