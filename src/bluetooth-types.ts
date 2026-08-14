/** Minimal structural Web Bluetooth types, included because TypeScript's DOM lib does not ship them. */
export type BluetoothServiceUuid = string | number

export interface PuquBluetooth {
  requestDevice(options: PuquRequestDeviceOptions): Promise<PuquBluetoothDevice>
}

export type PuquRequestDeviceOptions =
  | { acceptAllDevices: true; optionalServices: readonly BluetoothServiceUuid[] }
  | { filters: Array<{ namePrefix: string }>; optionalServices: readonly BluetoothServiceUuid[] }

export interface PuquBluetoothDevice extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: PuquGattServer
}

export interface PuquGattServer {
  readonly connected: boolean
  connect(): Promise<PuquGattServer>
  disconnect(): void
  getPrimaryServices(): Promise<PuquGattService[]>
}

export interface PuquGattService {
  readonly uuid: string
  getCharacteristics(): Promise<PuquGattCharacteristic[]>
}

export interface PuquGattCharacteristic extends EventTarget {
  readonly uuid: string
  readonly properties: {
    readonly write?: boolean
    readonly writeWithoutResponse?: boolean
    readonly notify?: boolean
    readonly indicate?: boolean
  }
  readonly value?: DataView
  startNotifications(): Promise<PuquGattCharacteristic>
  writeValueWithResponse(value: BufferSource): Promise<void>
  writeValueWithoutResponse(value: BufferSource): Promise<void>
}
