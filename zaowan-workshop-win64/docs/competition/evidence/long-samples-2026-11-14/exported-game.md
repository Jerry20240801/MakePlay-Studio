# 导出包真实运行验证（2026-11-14）

`exported-game.png`：把导出 ZIP 解压到临时目录，用包内自带的 `server.mjs` 启动（就是双击 Start-Game.cmd 走的那条路径），再用真实浏览器打开首页的结果。

```json
{
  "info": { "title": "钥匙与出口 · 造玩工坊", "bg": "url(\"http://127.0.0.1:49774/assets/asset-8bbdaeaa4d.png\")", "testid": true },
  "assetOk": true,
  "assetRequests": ["…/assets/app.js", "…/assets/asset-8bbdaeaa4d.png"],
  "pngStatus": 200,
  "failures": [],
  "errors": []
}
```

## 这一步暴露并修掉的真实缺陷

第一轮检查导出包结构时发现：`recipe.json`、`manifest.json`、`assets.json` 只写在 ZIP 根目录，而 `server.mjs` 只把 `game/` 作为站点根目录对外服务。
播放器请求的是相对自身的 `./recipe.json`，也就是 `/recipe.json` → 落空；换句话说**双击 Start-Game.cmd 会显示“无法加载游戏：缺少 recipe.json”**。
既有 e2e 用例之所以没抓到，是因为它在解压时手工把根目录的 recipe.json / manifest.json 复制进了游戏目录，等于替产品把文件放好了。

修改：导出时同时写入 `game/recipe.json`、`game/manifest.json`、`game/assets.json`（根目录保留同名副本便于查看），`server.mjs` 的 MIME 表补上 MP3/OGG/WAV。
复跑同一条路径后：页面加载、素材请求 200、无控制台错误，如上面 JSON 所示。

## 仍未覆盖

- 导出包内的音频（BGM/语音）自动播放仍受浏览器手势限制，需要用户点一次；脚本只验证了资源可取回（200）与引用正确。
- 双击 Start-Game.cmd 的桌面体验仍需在干净 Windows 机器上人工确认。
