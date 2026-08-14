import { describe, expect, it } from 'vitest'
import type {
  PuquBluetooth,
  PuquBluetoothDevice,
  PuquGattCharacteristic,
  PuquGattServer,
  PuquGattService,
  PuquRequestDeviceOptions,
} from './bluetooth-types.js'
import { PUQU_SERVICE_UUIDS } from './protocol.js'
import { PuquPrinterError, PuquWebBluetoothPrinter } from './web-bluetooth.js'

describe('PuquWebBluetoothPrinter', () => {
  it('connects through an injected Web Bluetooth implementation', async () => {
    const fixture = createBluetoothFixture()
    const printer = new PuquWebBluetoothPrinter({ bluetooth: fixture.bluetooth, namePrefix: 'PQ' })

    const snapshot = await printer.connect()

    expect(fixture.request).toEqual({
      filters: [{ namePrefix: 'PQ' }],
      optionalServices: [...PUQU_SERVICE_UUIDS],
    })
    expect(snapshot.connected).toBe(true)
    expect(snapshot.deviceName).toBe('PQ-Test')
    expect(fixture.notify.notificationsStarted).toBe(true)
    expect(fixture.write.writes.slice(0, 2).map(bytes => Array.from(bytes))).toEqual([
      [58, 90, 0, 0, 0, 0, 0, 90],
      [58, 90, 0, 0, 0, 0, 0, 10],
    ])

    printer.disconnect()
    expect(printer.getSnapshot().connected).toBe(false)
  })

  it('falls back to 20-byte chunks when a larger ATT write fails', async () => {
    const fixture = createBluetoothFixture(20)
    const printer = new PuquWebBluetoothPrinter({ bluetooth: fixture.bluetooth, payloadSize: 180, chunkDelayMs: 0 })
    await printer.connect()
    fixture.write.writes.length = 0

    await printer.printBitmap(alternatingRows(8, 10), 8, 10, 200)

    expect(fixture.write.rejectedWriteLengths).toEqual([60])
    expect(fixture.write.writes.map(bytes => bytes.length)).toEqual([8, 20, 20, 20])
    expect(printer.getSnapshot().statusText).toBe('打印数据已发送')
    printer.disconnect()
  })

  it('rejects printing before a printer is connected', async () => {
    const fixture = createBluetoothFixture()
    const printer = new PuquWebBluetoothPrinter({ bluetooth: fixture.bluetooth })

    await expect(printer.printBitmap(alternatingRows(8, 1), 8, 1)).rejects.toMatchObject<Partial<PuquPrinterError>>({
      code: 'not-connected',
    })
  })
})

class MockCharacteristic extends EventTarget implements PuquGattCharacteristic {
  readonly properties: PuquGattCharacteristic['properties']
  readonly writes: Uint8Array[] = []
  readonly rejectedWriteLengths: number[] = []
  notificationsStarted = false
  value?: DataView

  constructor(readonly uuid: string, properties: PuquGattCharacteristic['properties'], private readonly maximumWriteSize?: number) {
    super()
    this.properties = properties
  }

  async startNotifications(): Promise<PuquGattCharacteristic> {
    this.notificationsStarted = true
    return this
  }

  async writeValueWithResponse(value: BufferSource): Promise<void> {
    await this.record(value)
  }

  async writeValueWithoutResponse(value: BufferSource): Promise<void> {
    await this.record(value)
  }

  private async record(value: BufferSource): Promise<void> {
    const bytes = toBytes(value)
    if (this.maximumWriteSize !== undefined && bytes.length > this.maximumWriteSize) {
      this.rejectedWriteLengths.push(bytes.length)
      throw new DOMException('ATT payload is too large', 'NetworkError')
    }
    this.writes.push(bytes)
  }
}

function createBluetoothFixture(maximumWriteSize?: number) {
  const write = new MockCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb', { writeWithoutResponse: true }, maximumWriteSize)
  const notify = new MockCharacteristic('0000ffe2-0000-1000-8000-00805f9b34fb', { notify: true })
  const service: PuquGattService = {
    uuid: PUQU_SERVICE_UUIDS[0],
    getCharacteristics: async () => [write, notify],
  }
  const server: PuquGattServer = {
    connected: true,
    connect: async () => server,
    disconnect: () => undefined,
    getPrimaryServices: async () => [service],
  }
  const device = new EventTarget() as PuquBluetoothDevice
  Object.defineProperties(device, {
    id: { value: 'test-device' },
    name: { value: 'PQ-Test' },
    gatt: { value: server },
  })
  let request: PuquRequestDeviceOptions | undefined
  const bluetooth: PuquBluetooth = {
    requestDevice: async options => {
      request = options
      return device
    },
  }
  return {
    bluetooth,
    device,
    server,
    service,
    write,
    notify,
    get request() { return request },
  }
}

function alternatingRows(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const value = (x + y) % 2 === 0 ? 0 : 255
      rgba.set([value, value, value, 255], offset)
    }
  }
  return rgba
}

function toBytes(value: BufferSource): Uint8Array {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  }
  return new Uint8Array(value.slice(0))
}
