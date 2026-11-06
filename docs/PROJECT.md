# 项目结构与发布范围

这是本地 CPU 视觉演示工作台，三个模块共用 FastAPI 服务与推理锁。

| 路径 | 职责 |
| --- | --- |
| `server.py` | 服务入口、YOLOE 检测、文件校验与接口编排 |
| `relation.py` | RelSGG ONNX 模型下载、关系推理与筛选 |
| `segment.py` | SAM / SAM 2 图片分割 |
| `web/` | 原生 HTML / CSS / JavaScript 界面及导出逻辑 |
| `web/assets/` | 11 张用于页面演示及测试的典型图片 |
| `web/vendor/` | JSZip 与许可证 |
| `tests/` | 前端行为、后端单元测试及模型接口集成测试 |
| `upstream/` | YOLOE 及其第三方依赖源码、配置、词表与许可证 |
| `vendor/` | RelateAnything、SAM、SAM 2 运行源码及许可证 |
| `setup*.command` / `start.command` | 安装与本地启动 |

## 清理策略

- 保留现有三个工作台和全部自有测试，不改变推理行为。
- 第三方源码改为四个固定提交的 Git 子模块；上游目录及其素材保留在子模块中，主仓库仅保存引用。首次整理移出的上游资料已随子模块还原。
- 移出 `outputs/` 历史验收产物，以及网页未引用的 `street.json` / `sports.json` 旧预测结果。
- 子模块使用完整上游代码。YOLOE 和 RelateAnything 的现有运行源码与选定提交逐文件一致；SAM / SAM 2 延用此前固定提交。
- `.venv/`、`models/`、MobileCLIP 权重、RelSGG 模型包、SAM 2 安装依赖留在本机，由 `.gitignore` 排除；新克隆通过安装脚本准备。
- 被移出的内容保存在项目同级的 `yoloe-cleanup-backup-20261107-000046/`，其中 `manifest.json` 记录原路径和字节数。备份不属于仓库。

## 验证

不加载大模型的回归检查：

```sh
node --test tests/*.cjs
.venv/bin/python -m unittest discover -s tests -p test_segment.py
```

模型接口集成检查需先准备权重并在另一个终端运行 `./start.command`，测试可能触发额外下载与较长的 CPU 推理：

```sh
.venv/bin/python -m unittest discover -s tests -p test_api.py
.venv/bin/python -m unittest discover -s tests -p test_relation.py
```

本次整理已运行前端与分割单元测试；未重新执行全套大模型接口测试或全新环境安装。英文 README 说明当前功能及验证边界。

## 获取与更新

远程仓库：https://github.com/jeffei/vision-workbench

```sh
git clone --recurse-submodules https://github.com/jeffei/vision-workbench.git
cd vision-workbench
# 每次拉取主仓库更新后，同步其锁定的子模块版本：
git submodule update --init --recursive
```

不要将整个工作目录直接压缩上传，否则会包含本地权重和环境。GitHub 页面上的子模块目录链接会指向各上游的固定提交。模型及安装依赖仍由安装脚本准备。
