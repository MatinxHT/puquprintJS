# puquprintJS

面向璞趣（PUQU）BLE 标签打印机的框架无关 TypeScript SDK。它把 PartTrace 项目中已经验证的位图压缩、打印指令、设备状态解析和 Web Bluetooth GATT 传输抽离为一个独立包，可直接用于 Angular、React、Vue 或原生 JavaScript。

> 当前仓库不是璞趣官方 SDK。协议实现源自现有项目对厂商小程序 SDK 数据格式的适配，请先用你的具体打印机型号做实机验收。

## 能力

- 将 RGBA/Canvas 位图转成璞趣打印数据；
- 支持 200 dpi 与 300 dpi 指令头；
- 搜索常见璞趣 BLE GATT 服务和写入/通知特征；
- 自动分包，较大 ATT 写入失败时回退到 20 字节；
- 串行化查询、打印、取消操作，避免并发写入；
- 解析电量、缺纸、开盖、繁忙、打印错误等状态；
- 不依赖 React/Vue/Angular，三种框架示例位于 `examples/`。

## 环境限制

Web Bluetooth 是“有限可用”的实验性浏览器能力，不是所有主流浏览器都支持：

- 页面必须使用 HTTPS（开发时 `http://localhost` 通常被视为安全上下文）；
- `connect()` 必须由按钮点击等短暂用户手势直接触发；
- 打印机必须暴露 BLE/GATT 服务。只支持经典蓝牙 SPP 的机型不能通过 Web Bluetooth 连接；
- 建议使用支持 Web Bluetooth 的桌面或 Android Chromium 浏览器实机验证；
- Safari、Firefox 及 iOS 浏览器不可假定支持，应用必须先调用 `getWebBluetoothCompatibility()`；
- 跨域 iframe 还需要正确配置 `Permissions-Policy: bluetooth=(...)` 和 iframe 的 `allow="bluetooth"`。

参考：[Chrome Web Bluetooth 指南](https://developer.chrome.com/docs/capabilities/bluetooth)、[Web Bluetooth 规范](https://webbluetoothcg.github.io/web-bluetooth/)、[MDN Web Bluetooth](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)。

## 安装与构建

```bash
npm install
npm run test
npm run build
```

在另一个本地项目中测试：

```bash
npm install ../puquprintJS
```

发布到 npm 前，请先确认包名、版本、许可和实机兼容矩阵；本仓库未自动发布。

## 最小用法

```ts
import { PuquWebBluetoothPrinter, getWebBluetoothCompatibility } from 'puquprintjs'

const compatibility = getWebBluetoothCompatibility()
if (!compatibility.supported || !compatibility.secureContext) {
  throw new Error(compatibility.reason)
}

const printer = new PuquWebBluetoothPrinter()
printer.subscribe(snapshot => console.log(snapshot.statusText, snapshot.error))

connectButton.addEventListener('click', async () => {
  // requestDevice 必须留在用户点击处理函数中。
  await printer.connect()
})

printButton.addEventListener('click', async () => {
  await printer.printCanvas(document.querySelector('canvas')!)
})
```

也可直接传入 RGBA：

```ts
await printer.printBitmap(imageData.data, imageData.width, imageData.height)
// 或明确覆盖设备返回的 dpi：
await printer.printBitmap(imageData.data, imageData.width, imageData.height, 300)
```

## 自定义机型

内置服务 UUID 来自现有适配。如果新机型使用其他公开的 GATT 服务 UUID：

```ts
const printer = new PuquWebBluetoothPrinter({
  namePrefix: 'Q',
  additionalServiceUuids: ['xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'],
  payloadSize: 180,
  chunkDelayMs: 10,
})
```

不要在不知道服务 UUID 的情况下把随机 UUID 加入列表；Web Bluetooth 只能访问设备授权对话框中申明过的可选服务。

## 位图约定

- 输入是每像素 4 字节的 RGBA 数组；
- 透明像素按白色处理；
- 默认灰度阈值是 200；
- 宽度不是 8 的倍数时，右侧自动补白；
- SDK 负责传输像素，不负责排版。建议应用先在 Canvas 上绘制文字、条码或二维码，再调用 `printCanvas()`。

## 测试范围与实机清单

自动测试覆盖协议压缩、指令头、位图补齐、状态解析和坏输入。Web Bluetooth 的完整行为需要真实硬件，交付前至少验证：

1. 浏览器能发现目标型号且 GATT 服务/特征匹配；
2. 200/300 dpi、不同标签宽高的方向和缩放正确；
3. 大面积黑色图像不会因缓存或分包丢行；
4. 缺纸、开盖、低电、取消和断连能正确反馈；
5. 连续打印多张时无串包，并以打印机实际完成状态作为业务审计依据。

## 来源说明

首版核心从 PartTrace 的以下实现提炼：

- `puquProtocol.ts`：协议、位图压缩与状态解析；
- `webBluetoothPrinter.ts`：Web Bluetooth 连接、分包和队列；
- `puquProtocol.test.ts`：协议基准用例。

业务专属的 50 × 30 mm 产品标签布局、BOM、序列号、打印历史接口和 React 页面没有进入 SDK。
