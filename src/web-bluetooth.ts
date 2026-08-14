import {
  buildBitmapPrintData,
  CANCEL_PRINT_COMMAND,
  getPrinterStateText,
  parsePuquNotification,
  PUQU_NOTIFY_CHARACTERISTICS,
  PUQU_SERVICE_UUIDS,
  PUQU_WRITE_CHARACTERISTICS,
  READ_DEVICE_DETAILS_COMMAND,
  READ_DEVICE_STATE_COMMAND,
  type PrinterDpi,
  type PuquDeviceDetails,
  type PuquPrinterState,
} from './protocol.js'
import type {
  BluetoothServiceUuid,
  PuquBluetooth,
  PuquBluetoothDevice,
  PuquGattCharacteristic,
  PuquGattServer,
  PuquGattService,
  PuquRequestDeviceOptions,
} from './bluetooth-types.js'

export type PuquPrinterErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'device-not-selected'
  | 'permission-denied'
  | 'service-not-found'
  | 'characteristic-not-found'
  | 'not-connected'
  | 'printer-not-ready'
  | 'cancelled'
  | 'bluetooth-error'

export class PuquPrinterError extends Error {
  constructor(public readonly code: PuquPrinterErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PuquPrinterError'
  }
}

export interface PrinterSnapshot {
  supported: boolean
  secureContext: boolean
  connected: boolean
  connecting: boolean
  printing: boolean
  deviceName: string
  statusText: string
  error: string
  details: PuquDeviceDetails | null
  state: PuquPrinterState | null
}

export interface PuquWebBluetoothOptions {
  /** Initial BLE ATT payload size. Falls back to 20 when a larger write fails. */
  payloadSize?: number
  /** Delay between BLE chunks, in milliseconds. */
  chunkDelayMs?: number
  /** Optional name prefix filter. Omit it to show every nearby BLE device. */
  namePrefix?: string
  /** Additional vendor service UUIDs for models not present in the built-in list. */
  additionalServiceUuids?: readonly BluetoothServiceUuid[]
  /** Dependency injection point for tests or embedded browser shells. */
  bluetooth?: PuquBluetooth
}

export interface BitmapLike {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

const emptySnapshot = (): PrinterSnapshot => ({
  supported: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  secureContext: typeof window === 'undefined' || window.isSecureContext,
  connected: false,
  connecting: false,
  printing: false,
  deviceName: '',
  statusText: '未连接',
  error: '',
  details: null,
  state: null,
})

export function getWebBluetoothCompatibility(): { supported: boolean; secureContext: boolean; reason: string } {
  const supported = typeof navigator !== 'undefined' && 'bluetooth' in navigator
  const secureContext = typeof window === 'undefined' || window.isSecureContext
  const reason = !supported
    ? '当前浏览器没有 Web Bluetooth API。请使用支持 Web Bluetooth 的 Chromium 浏览器。'
    : !secureContext
      ? 'Web Bluetooth 只能在 HTTPS 安全页面或 localhost 中使用。'
      : ''
  return { supported, secureContext, reason }
}

export class PuquWebBluetoothPrinter {
  private device: PuquBluetoothDevice | null = null
  private server: PuquGattServer | null = null
  private writeCharacteristic: PuquGattCharacteristic | null = null
  private notifyCharacteristic: PuquGattCharacteristic | null = null
  private payloadSize: number
  private cancelRequested = false
  private operationQueue: Promise<void> = Promise.resolve()
  private snapshot = emptySnapshot()
  private readonly listeners = new Set<(snapshot: PrinterSnapshot) => void>()
  private readonly options: PuquWebBluetoothOptions

  constructor(options: PuquWebBluetoothOptions = {}) {
    this.options = options
    this.payloadSize = options.payloadSize ?? 180
    if (this.payloadSize < 20) throw new RangeError('payloadSize 不能小于 20。')
  }

  subscribe(listener: (snapshot: PrinterSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): PrinterSnapshot => this.snapshot

  async connect(): Promise<PrinterSnapshot> {
    const bluetooth = this.options.bluetooth ?? getBluetooth()
    if (!bluetooth) throw new PuquPrinterError('unsupported', getWebBluetoothCompatibility().reason)
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new PuquPrinterError('insecure-context', getWebBluetoothCompatibility().reason)
    }

    if (this.server?.connected) this.disconnect()
    this.update({ connecting: true, error: '', statusText: '正在选择打印机…', details: null, state: null })
    try {
      const services = [...PUQU_SERVICE_UUIDS, ...(this.options.additionalServiceUuids ?? [])]
      const request: PuquRequestDeviceOptions = this.options.namePrefix
        ? { filters: [{ namePrefix: this.options.namePrefix }], optionalServices: services }
        : { acceptAllDevices: true, optionalServices: services }
      const device = await bluetooth.requestDevice(request)
      if (!device.gatt) throw new PuquPrinterError('service-not-found', '所选设备没有 BLE GATT 服务。')

      this.device = device
      device.addEventListener('gattserverdisconnected', this.handleDisconnect)
      this.update({ deviceName: device.name || '璞趣 BLE 打印机', statusText: '正在连接…' })
      this.server = await device.gatt.connect()
      const service = await this.findPrinterService(this.server)
      const characteristics = await service.getCharacteristics()
      this.writeCharacteristic = findCharacteristic(characteristics, PUQU_WRITE_CHARACTERISTICS, item =>
        Boolean(item.properties.write || item.properties.writeWithoutResponse))
      this.notifyCharacteristic = findCharacteristic(characteristics, PUQU_NOTIFY_CHARACTERISTICS, item =>
        Boolean(item.properties.notify || item.properties.indicate))

      if (!this.writeCharacteristic) {
        throw new PuquPrinterError('characteristic-not-found', `BLE 服务 ${service.uuid} 没有可写特征值。`)
      }
      if (this.notifyCharacteristic) {
        await this.notifyCharacteristic.startNotifications()
        this.notifyCharacteristic.addEventListener('characteristicvaluechanged', this.handleNotification)
      }

      this.update({ connected: true, connecting: false, statusText: '已连接', error: '' })
      await Promise.allSettled([this.readDeviceDetails(), this.readDeviceState()])
      return this.snapshot
    } catch (error) {
      this.releaseConnection()
      const normalized = normalizeError(error)
      this.update({ connected: false, connecting: false, statusText: '连接失败', error: normalized.message, details: null, state: null })
      throw normalized
    }
  }

  disconnect(): void {
    this.server?.disconnect()
    this.releaseConnection()
    this.update({ connected: false, connecting: false, printing: false, statusText: '已断开', error: '', details: null, state: null })
  }

  async readDeviceDetails(): Promise<void> {
    await this.enqueue(() => this.writeBytes(READ_DEVICE_DETAILS_COMMAND))
  }

  async readDeviceState(): Promise<void> {
    await this.enqueue(() => this.writeBytes(READ_DEVICE_STATE_COMMAND))
  }

  async cancelPrint(): Promise<void> {
    this.cancelRequested = true
    try {
      await this.enqueue(() => this.writeBytes(CANCEL_PRINT_COMMAND, true))
      this.update({ printing: false, statusText: '已发送取消指令' })
    } finally {
      this.cancelRequested = false
    }
  }

  async printImageData(image: BitmapLike): Promise<void> {
    await this.printBitmap(image.data, image.width, image.height)
  }

  async printCanvas(canvas: HTMLCanvasElement): Promise<void> {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取 Canvas 2D 位图。')
    await this.printImageData(context.getImageData(0, 0, canvas.width, canvas.height))
  }

  async printBitmap(
    rgba: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    dpi?: PrinterDpi,
  ): Promise<void> {
    this.ensureConnected()
    const printData = buildBitmapPrintData(rgba, width, height, dpi ?? this.snapshot.details?.dpi ?? 200)
    this.update({ printing: true, statusText: '正在发送打印数据…', error: '' })
    try {
      this.cancelRequested = false
      await this.enqueue(async () => {
        await this.waitUntilWritable()
        await this.writeBytes(printData.header)
        await delay(3)
        await this.writeBytes(printData.body)
      })
      this.update({ printing: false, statusText: '打印数据已发送' })
      setTimeout(() => void this.readDeviceState().catch(() => undefined), 250)
    } catch (error) {
      const normalized = normalizeError(error)
      this.update({ printing: false, statusText: '打印失败', error: normalized.message })
      throw normalized
    }
  }

  private async findPrinterService(server: PuquGattServer): Promise<PuquGattService> {
    const services = await server.getPrimaryServices()
    const expected = [...PUQU_SERVICE_UUIDS, ...(this.options.additionalServiceUuids ?? [])]
      .map(uuid => String(uuid).toUpperCase())
    const service = services.find(item => expected.some(uuid => item.uuid.toUpperCase() === uuid || item.uuid.toUpperCase().includes(shortUuid(uuid))))
    if (service) return service
    throw new PuquPrinterError(
      'service-not-found',
      `没有找到受支持的璞趣 BLE 服务。已发现：${services.map(item => item.uuid).join('、') || '无'}。`,
    )
  }

  private async writeBytes(bytes: Uint8Array, ignoreCancellation = false): Promise<void> {
    this.ensureConnected()
    let offset = 0
    while (offset < bytes.length) {
      if (this.cancelRequested && !ignoreCancellation) {
        throw new PuquPrinterError('cancelled', '打印已取消。')
      }
      const chunk = bytes.slice(offset, offset + this.payloadSize)
      try {
        await this.writeChunk(chunk)
        offset += chunk.length
        if (offset < bytes.length) await delay(this.options.chunkDelayMs ?? 10)
      } catch (error) {
        if (this.payloadSize > 20) {
          this.payloadSize = 20
          continue
        }
        throw error
      }
    }
  }

  private async writeChunk(chunk: Uint8Array): Promise<void> {
    const characteristic = this.writeCharacteristic
    if (!characteristic) throw new PuquPrinterError('not-connected', '打印机写入特征值不可用。')
    const value = chunk.slice().buffer
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(value)
    } else if (characteristic.properties.write) {
      await characteristic.writeValueWithResponse(value)
    } else {
      throw new PuquPrinterError('characteristic-not-found', 'BLE 特征值不支持写入。')
    }
  }

  private async waitUntilWritable(timeoutMs = 8000): Promise<void> {
    const startedAt = Date.now()
    while (this.snapshot.state?.cacheSize !== undefined && this.snapshot.state.cacheSize <= 20) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new PuquPrinterError('printer-not-ready', '打印机缓存持续繁忙，请稍后重试。')
      }
      await delay(20)
    }
    const state = this.snapshot.state
    if (state && (state.isLackOfPaper || state.isBoxCoverOpened || state.isLowPower || state.isPrintError)) {
      throw new PuquPrinterError('printer-not-ready', `打印机当前不可打印：${getPrinterStateText(state)}。`)
    }
  }

  private ensureConnected(): void {
    if (!this.server?.connected || !this.writeCharacteristic) {
      throw new PuquPrinterError('not-connected', '请先连接璞趣 BLE 打印机。')
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private readonly handleNotification = (event: Event): void => {
    const value = (event.target as PuquGattCharacteristic | null)?.value
    if (!value) return
    const bytes = new Uint8Array(value.byteLength)
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    const notification = parsePuquNotification(bytes.buffer)
    if (notification.type === 'details') this.update({ details: notification.details })
    if (notification.type === 'state') {
      this.update({ state: notification.state, statusText: getPrinterStateText(notification.state) })
    }
  }

  private readonly handleDisconnect = (): void => {
    this.releaseConnection()
    this.update({ connected: false, connecting: false, printing: false, statusText: '连接已断开', details: null, state: null })
  }

  private releaseConnection(): void {
    this.notifyCharacteristic?.removeEventListener('characteristicvaluechanged', this.handleNotification)
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnect)
    this.device = null
    this.server = null
    this.writeCharacteristic = null
    this.notifyCharacteristic = null
    this.payloadSize = this.options.payloadSize ?? 180
    this.cancelRequested = false
  }

  private update(changes: Partial<PrinterSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes }
    this.listeners.forEach(listener => listener(this.snapshot))
  }
}

function getBluetooth(): PuquBluetooth | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { bluetooth?: PuquBluetooth }).bluetooth ?? null
}

function findCharacteristic(
  characteristics: PuquGattCharacteristic[],
  preferredIds: readonly string[],
  fallback: (characteristic: PuquGattCharacteristic) => boolean,
): PuquGattCharacteristic | null {
  return characteristics.find(item => preferredIds.some(id => item.uuid.toUpperCase().includes(id)))
    ?? characteristics.find(fallback)
    ?? null
}

function shortUuid(uuid: string): string {
  const match = uuid.match(/^0000([0-9a-f]{4})-/i)
  return match?.[1]?.toUpperCase() ?? uuid.slice(0, 8).toUpperCase()
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function normalizeError(error: unknown): PuquPrinterError {
  if (error instanceof PuquPrinterError) return error
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return new PuquPrinterError('device-not-selected', '没有选择 BLE 打印机，或设备选择已取消。', { cause: error })
  }
  if (error instanceof DOMException && error.name === 'SecurityError') {
    return new PuquPrinterError('permission-denied', '浏览器拒绝访问蓝牙；请检查 HTTPS、用户手势和站点权限。', { cause: error })
  }
  return new PuquPrinterError('bluetooth-error', error instanceof Error ? error.message : 'Web Bluetooth 操作失败。', { cause: error })
}
