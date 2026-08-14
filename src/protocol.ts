export type PrinterDpi = 200 | 300

export interface PuquDeviceDetails {
  darkness: number
  speed: number
  paperType: number
  paperFeed: number
  close: number
  language: number
  sound: number
  batteryLevel: number
  warning: number
  dpi: PrinterDpi
  rawData: number[]
}

export interface PuquPrinterState {
  isLackOfPaper: boolean
  isBoxCoverOpened: boolean
  isAbnormalData: boolean
  isLowPower: boolean
  isPrinting: boolean
  isPrintError: boolean
  isCancelPrinting: boolean
  cacheSize: number
  warningCode: number
  processedPages: number
  rawData: number[]
}

export type PuquNotification =
  | { type: 'details'; details: PuquDeviceDetails }
  | { type: 'state'; state: PuquPrinterState }
  | { type: 'unknown'; rawData: number[] }

export const PUQU_SERVICE_UUIDS = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ae3a-0000-1000-8000-00805f9b34fb',
  '0000fe01-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
] as const

export const PUQU_WRITE_CHARACTERISTICS = ['FFE1', 'AE01'] as const
export const PUQU_NOTIFY_CHARACTERISTICS = ['FFE2', 'AE02'] as const
export const READ_DEVICE_DETAILS_COMMAND = new Uint8Array([58, 90, 0, 0, 0, 0, 0, 90])
export const READ_DEVICE_STATE_COMMAND = new Uint8Array([58, 90, 0, 0, 0, 0, 0, 10])
export const CANCEL_PRINT_COMMAND = new Uint8Array([24, 27, 64])

export function compressBitmap(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 200,
): Uint8Array {
  assertBitmap(rgba, width, height)
  const rows: Uint8Array[] = []
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(width)
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = rgba[offset + 3] ?? 0
      const red = rgba[offset] ?? 255
      const green = rgba[offset + 1] ?? 255
      const blue = rgba[offset + 2] ?? 255
      const gray = (299 * red + 587 * green + 114 * blue + 500) / 1000
      row[x] = alpha !== 0 && gray < threshold ? 1 : 0
    }
    rows.push(row)
  }

  const compressed: number[] = []
  for (let rowIndex = 0; rowIndex < rows.length;) {
    const row = rows[rowIndex]
    if (!row) break
    const repeatCount = countRepeatedRows(rows, rowIndex)
    appendCompressedRow(row, repeatCount, compressed)
    rowIndex += repeatCount
  }
  return new Uint8Array(compressed)
}

export function buildBitmapPrintData(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  dpi: PrinterDpi,
) {
  const normalized = normalizeBitmap(rgba, width, height)
  const body = compressBitmap(normalized.rgba, normalized.width, normalized.height)
  const pixelsPerMillimetre = dpi === 300 ? 12 : 8
  const commandType = dpi === 300 ? 6 : 5
  const header = new Uint8Array([
    58,
    Math.floor(normalized.width / pixelsPerMillimetre),
    normalized.height & 0xff,
    (normalized.height >> 8) & 0xff,
    body.length & 0xff,
    (body.length >> 8) & 0xff,
    (body.length >> 16) & 0xff,
    commandType,
  ])
  return { header, body, width: normalized.width, height: normalized.height }
}

export function parsePuquNotification(value: ArrayBuffer): PuquNotification {
  const bytes = new Uint8Array(value)
  const rawData = Array.from(bytes)
  if (bytes.length < 8 || bytes[0] !== 58) return { type: 'unknown', rawData }

  if (bytes[7] === 10) {
    const flags = bytes[1] ?? 0
    const warningCode = ((bytes[6] ?? 0) >> 4) & 0x0f
    return {
      type: 'state',
      state: {
        isLackOfPaper: Boolean(flags & 0x80),
        isBoxCoverOpened: Boolean(flags & 0x40),
        isAbnormalData: Boolean(flags & 0x20),
        isLowPower: Boolean(flags & 0x10),
        isPrinting: Boolean(flags & 0x08),
        isPrintError: Boolean(flags & 0x04),
        isCancelPrinting: Boolean(flags & 0x02),
        cacheSize: bytes[4] ?? 0,
        warningCode,
        processedPages: bytes[3] ?? 0,
        rawData,
      },
    }
  }

  if (bytes[7] === 90 || (bytes.length > 15 && bytes[15] === 90)) {
    const dpi: PrinterDpi = ((bytes[7] ?? 0) & 0x0f) === 2 ? 300 : 200
    return {
      type: 'details',
      details: {
        darkness: 1 + (((bytes[3] ?? 0) >> 4) & 0x0f),
        speed: 1 + ((bytes[3] ?? 0) & 0x0f),
        paperType: 1 + (((bytes[4] ?? 0) >> 4) & 0x0f),
        paperFeed: 1 + ((bytes[4] ?? 0) & 0x0f),
        close: 1 + (((bytes[5] ?? 0) >> 4) & 0x0f),
        language: 1 + ((bytes[5] ?? 0) & 0x0f),
        sound: 1 + (((bytes[6] ?? 0) >> 4) & 0x0f),
        batteryLevel: (bytes[6] ?? 0) & 0x0f,
        warning: ((bytes[7] ?? 0) >> 4) & 0x0f,
        dpi,
        rawData,
      },
    }
  }
  return { type: 'unknown', rawData }
}

export function getPrinterStateText(state: PuquPrinterState | null): string {
  if (!state) return '已连接'
  if (state.isLackOfPaper) return '缺纸'
  if (state.isBoxCoverOpened) return '仓盖已打开'
  if (state.isAbnormalData) return '打印数据异常'
  if (state.isLowPower) return '电量过低'
  if (state.isCancelPrinting) return '正在取消打印'
  if (state.isPrintError) return state.isPrinting ? '打印已暂停' : '打印错误'
  if (state.cacheSize <= 20) return '打印机忙碌'
  if (state.isPrinting) return '正在打印'
  return '打印机已就绪'
}

function assertBitmap(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('标签像素尺寸必须是正整数。')
  }
  if (rgba.length < width * height * 4) throw new RangeError('RGBA 位图数据长度不足。')
}

function normalizeBitmap(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number) {
  assertBitmap(rgba, width, height)
  if (width % 8 === 0) return { rgba, width, height }
  const paddedWidth = width + (8 - width % 8)
  const padded = new Uint8ClampedArray(paddedWidth * height * 4)
  padded.fill(255)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4
      const target = (y * paddedWidth + x) * 4
      padded.set(rgba.subarray(source, source + 4), target)
    }
  }
  return { rgba: padded, width: paddedWidth, height }
}

function countRepeatedRows(rows: Uint8Array[], start: number): number {
  const first = rows[start]
  if (!first) return 0
  let count = 1
  while (start + count < rows.length && rowsEqual(first, rows[start + count])) count += 1
  return count
}

function rowsEqual(left: Uint8Array, right: Uint8Array | undefined): boolean {
  if (!right || left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function appendCompressedRow(row: Uint8Array, repeatCount: number, output: number[]): void {
  const packed = packBits(row)
  let leftZeros = 0
  let rightZeros = 0
  while (leftZeros < packed.length && packed[leftZeros] === 0) leftZeros += 1
  while (rightZeros < packed.length - leftZeros && packed[packed.length - 1 - rightZeros] === 0) rightZeros += 1
  if (leftZeros + rightZeros >= packed.length) {
    leftZeros = 0
    rightZeros = packed.length
  }
  output.push(60, repeatCount & 0xff, (repeatCount >> 8) & 0xff, leftZeros & 0xff, rightZeros & 0xff)
  for (let index = leftZeros; index < packed.length - rightZeros; index += 1) {
    const value = packed[index]
    if (value !== undefined) output.push(value)
  }
}

function packBits(row: Uint8Array): Uint8Array {
  const packed = new Uint8Array(Math.ceil(row.length / 8))
  for (let index = 0; index < row.length; index += 1) {
    if (row[index]) packed[Math.floor(index / 8)]! |= 1 << (7 - index % 8)
  }
  return packed
}
