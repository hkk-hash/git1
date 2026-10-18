# BEAM 巴法云多传感器控制台

面向 ESP32-S3 下位机的 GitHub Pages 静态网页。保留原有快捷按钮和消息流，并新增：

- DHT11 温湿度、MQ-2、光敏和 HC-SR04 实时数据卡片
- LED 1、LED 2、蜂鸣器状态同步与单独控制
- 每个采集模块的远程启用/停用
- 多传感器 AND 条件动作链、顺序延时动作、冷却时间和手动测试
- 两条默认动作链，以及保存在浏览器 `localStorage` 中的用户动作链

## 配置

在网页右上角打开连接设置：

1. 填写巴法云私钥。
2. “发布主题”填写 ESP32 的命令主题。
3. “订阅主题”填写 ESP32 的状态主题；如还要查看其他主题，可用逗号分隔。
4. 点击“开始接收”。保存过私钥后，下次打开会自动开始同步。

网页通过巴法云 REST API 发布命令并轮询遥测，最快同步间隔为 2 秒。自动动作链由当前网页判断与执行，关闭页面后规则会暂停；用户规则只保存在当前浏览器，不会上传到服务器。

## GitHub Pages

向 `main` 分支推送后，`.github/workflows/deploy-pages.yml` 会自动构建并发布 `dist`：

```powershell
npm install
npm run build
```

仓库首次部署时，在 **Settings → Pages → Build and deployment** 中将 Source 设为 **GitHub Actions**。
