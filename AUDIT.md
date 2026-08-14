# PartTrace 标签打印功能检查与提取记录

## 已检查范围

- `src/PartTrace.Client/src/features/printing/puquProtocol.ts`
- `src/PartTrace.Client/src/features/printing/webBluetoothPrinter.ts`
- `src/PartTrace.Client/src/features/printing/webSerialPrinter.ts`
- `src/PartTrace.Client/src/features/printing/labelRenderer.ts`
- `src/PartTrace.Client/src/pages/PrinterPage.tsx`
- 相关 Vitest 协议测试与后端打印记录接口

## 提取结论

可跨项目复用的是“打印协议 + 浏览器传输”两层。产品标签排版、SN 批量规则、BOM 型号、打印历史和 React 页面属于 PartTrace 业务，不应进入通用包。因此首版只提取 BLE/GATT 路径，并提供 Canvas/RGBA 输入；Web Serial 的经典蓝牙 SPP 路径暂留在 PartTrace，避免把两套兼容边界混成一个 API。

## 检查中发现的事项

1. PartTrace 的 `puquProtocol.ts` 和 `webBluetoothPrinter.ts` 中多条中文错误/状态文本已经出现 UTF-8 乱码；本仓库的提取版已恢复为正常中文，但没有反向修改 PartTrace。
2. 原实现断开后保留上一台设备的 `details/state`，如果下一台设备没有及时返回详情，可能沿用旧 DPI。本仓库断开、失败和重新选择设备时会清空状态。
3. “写入完成”只表示浏览器已把数据提交到 GATT 特征，并不能从所有型号上证明纸张已经物理打印完成。业务系统保存审计记录前，应结合具体机型通知能力定义成功标准。
4. 协议自动测试只能验证字节格式，GATT UUID、MTU、分包节奏、状态通知仍必须逐型号实机验证。
5. PartTrace 同时包含 Web Serial/SPP 适配；它不是 Web Bluetooth，也不是移动浏览器的通用回退方案。若后续纳入，应作为单独 transport 导出。

## 首版改进

- 与 React 生命周期解耦，暴露普通类和订阅接口；
- 提供稳定错误码与运行时兼容性检查；
- 支持依赖注入 Bluetooth 对象，方便测试和嵌入式壳层；
- 支持额外服务 UUID、名称前缀、分包大小和间隔配置；
- 校验位图尺寸/长度并自动补齐非 8 倍数宽度；
- 清理设备切换时的陈旧状态；
- 附 Angular、React、Vue 示例和实机验收清单。
