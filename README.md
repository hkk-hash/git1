# BEAM 巴法云远程控制台

用于 ESP32 下位机的巴法云静态控制网页，支持：

- 自定义普通按钮和开关按钮
- 巴法云消息发布与多主题消息订阅
- 创建具名动作链
- 按等待时长或指定时刻顺序执行多个动作
- 暂停、继续和停止动作链
- 在浏览器本地保存私钥、主题和控制配置

## GitHub Pages

向 `main` 分支推送代码后，GitHub Actions 会构建并发布 `dist` 目录。

仓库首次使用时，请前往 **Settings → Pages → Build and deployment**，将 Source 设置为 **GitHub Actions**。

发布网址：<https://hkk-hash.github.io/git1/>

## 本地运行

```powershell
npm install
npm run dev
```

巴法云私钥不会写入源码。私钥只会由网页发送给巴法云接口，并按用户选择保存在当前浏览器的 `localStorage` 中。
