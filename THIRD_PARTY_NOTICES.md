# 第三方源码与示例资产

保留的第三方文件沿用各自许可证；本文件不重新授权第三方代码、图片或模型。模型按需下载，不随 Git 仓库分发。以下来源依据本地代码、许可证及原有项目记录整理。

| 内容 | 来源与本地许可证 |
| --- | --- |
| YOLOE / Ultralytics | https://github.com/THU-MIG/yoloe；`vendor/yoloe/LICENSE`，固定子模块提交 `40cd606cabdbe2b566d6f14a6b162c89206e9a1b` |
| CLIP | `vendor/yoloe/third_party/CLIP/LICENSE` |
| MobileCLIP | `vendor/yoloe/third_party/ml-mobileclip/LICENSE`、`LICENSE_weights_data` |
| RelateAnything | https://github.com/Maelic/RelateAnything；`vendor/relate-anything/LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`；固定子模块提交 `fc626d0d58113efcc8b08252c168a7ad529a171f` |
| Segment Anything | https://github.com/facebookresearch/segment-anything；提交 `dca509fe793f601edb92606367a655c15ac00fdf`；`vendor/segment-anything/LICENSE` |
| SAM 2 | https://github.com/facebookresearch/sam2；提交 `2b90b9f5ceec907a1c18123530e92e794ad901a4`；`vendor/sam2/LICENSE` |
| JSZip | `web/vendor/JSZip-LICENSE.md` |

## 保留图片

- `street.jpg`、`sports.jpg`：分别与本地上游 `ultralytics/assets/bus.jpg`、`zidane.jpg` 字节一致；供默认检测及跨图提示测试使用。
- `relate-{horse,bicycle,skateboard,tennis,frisbee,catlaptop}.jpg`：来自 RelateAnything 的 `assets/reel/images/`，供关系页面示例使用。
- `sam-{truck,groceries,dog}.jpg`：来自 SAM 的 `notebooks/images/`，供点、框和自动分割示例使用。

主仓库仅保留页面和测试实际使用的图片；子模块仍保留上游完整目录，不复制进主仓库历史。图片来源说明不等同于独立的商业素材授权；权利范围以原始来源为准。
