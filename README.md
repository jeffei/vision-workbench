# Vision Workbench

A local visual workspace for object detection, visual relationship analysis, image segmentation, and annotation export. It brings **YOLOE**, **RelateAnything**, **Segment Anything (SAM)**, and **SAM 2** into a browser-based interface backed by a local FastAPI service.

Images are processed on the local machine. Model files are downloaded separately when needed; the application does not send images to external inference APIs.

## Workspaces

| Workspace | Capabilities | Models |
| --- | --- | --- |
| Detect Anything | Text prompts, visual prompts, prompt-free detection, image and sampled-video analysis | YOLOE v8 / 11, S / M / L |
| Relate Anything | Automatic entity discovery, subject–predicate–object relationships, manual review and evidence export | YOLOE + RelSGG ONNX |
| Segment Anything | Foreground/background points, box prompts, automatic masks, transparent cutouts | SAM ViT-B / SAM 2.1 Hiera Tiny |

Detection exports include annotated PNG, JSON, and YOLO / COCO bounding-box datasets. Relationship exports include the image, selected relationship visualization, predictions, and review decisions. Segmentation exports include mask PNG, transparent cutout PNG, and JSON containing masks and prompts.

Confidence controls filter cached detection or relationship candidates without rerunning inference. Segmentation supports a full-image mask overview and interactive region highlighting. Each workspace offers an enlarged, read-only snapshot of the current image and its result overlays. Use the “放大查看” button above the image; close with Escape, the close button, or the backdrop. The interface currently uses Chinese labels.

## Potential business applications

These are directions for further development, not validated industry solutions:

| Business scenario | How these capabilities could help | Additional work required |
| --- | --- | --- |
| Dataset preparation | Generate candidate boxes and masks, review results, export training annotations | Annotation QA, dataset versioning, strict train/validation splits |
| Retail and merchandising | Explore product discovery, shelf imagery, and person–object interactions | Domain data, small-object evaluation, product identity matching |
| Industrial and facility inspection | Locate equipment and isolate regions for inspection | Defect-specific models, acceptance criteria, field validation |
| Warehousing and logistics | Identify packages, handling equipment, and candidate handling relationships | Tracking, business-system integration, site-specific evaluation |
| Property and campus operations | Review images of shared spaces and identify objects or interactions | Camera integration, temporal rules, access controls, privacy safeguards |
| E-commerce and content production | Create product cutouts and editable region masks | Batch processing, edge-quality review, content-management integration |

A detected helmet, person, or relationship does not by itself establish a safety violation. Operational decisions require validated rules, context, and human review.

## Quick start

### 1. Clone with dependencies

Third-party source repositories are pinned as **Git submodules**. The main repository stores their URLs and commit references instead of copying their source trees.

```sh
git clone --recurse-submodules https://github.com/jeffei/vision-workbench.git
cd vision-workbench
```

For an existing checkout:

```sh
git submodule update --init --recursive
```

GitHub's source ZIP does not contain submodule contents. Use Git to obtain a working checkout. Submodules reduce duplication in this repository; they still download their upstream files locally.

### 2. Install

The provided `.command` scripts target **macOS with zsh**. The previously validated environment is Intel macOS, Python 3.9.6, PyTorch 2.2.2, and CPU inference. Other platforms and fresh installations have not been fully validated. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and a compatible Python interpreter first.

```sh
./setup.command          # Base environment, YOLOE and MobileCLIP weights
./setup-relate.command   # Optional: default relationship model
./setup-segment.command  # Optional: SAM ViT-B weights
./setup-sam2.command     # Optional: SAM 2.1 Tiny weights and dependencies
```

Allow several GB of disk space for the Python environment and model weights. Additional YOLOE and supported RelSGG models download on first use. Prompt-free detection builds and caches embeddings for the upstream 4,585-class RAM vocabulary.

SAM 2's upstream requirements are newer than this project's validated legacy environment. Its CPU image path has been tested locally with Python 3.9 / PyTorch 2.2.2; this does not establish compatibility for video, training, or CUDA extensions. The SAM 2 setup script installs auxiliary dependencies under `vendor/sam2-deps/` without upgrading PyTorch.

### 3. Run

```sh
./start.command
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). Keep the terminal running; press Ctrl+C to stop. The server binds to localhost by default.

## Usage notes and limitations

- Import a local image or use a bundled example. Detection also accepts browser-decodable video; H.264 MP4 is recommended.
- Video analysis samples frames at 0.5-second intervals and waits for inference. It is not real-time streaming or multi-object tracking.
- Text prompts use English class names. Visual prompts support boxes and freehand regions on the current image or a separate reference image.
- Relationship analysis operates on images, considers at most 32 detected entities, and displays at most 24 relationships after filtering. Predicate names remain in the model's original vocabulary.
- Segmentation accepts images up to 20 MB; the browser resizes to a maximum side of 1,600 pixels. Automatic segmentation uses a CPU-oriented grid and retains at most 40 masks. Masks do not automatically receive semantic labels.
- Models share an inference lock. First model loading, vocabulary preparation, and CPU segmentation may take time.
- Predictions are candidate annotations, not ground truth. Review them before training or business use.
- Export results before switching inputs or refreshing the page. Review decisions are not persisted across sessions.
- This is a local demo, without production authentication, camera/RTSP ingestion, alert rules, or production deployment infrastructure.

## Repository layout

```text
server.py                  FastAPI entry point and YOLOE detection
relation.py                RelSGG model management and relationship inference
segment.py                 SAM / SAM 2 image segmentation
web/                       Browser interface, exports, and example images
tests/                     Frontend regression and Python tests
vendor/yoloe/              YOLOE submodule, including its bundled dependencies
vendor/relate-anything/    RelateAnything submodule
vendor/segment-anything/    SAM submodule
vendor/sam2/                SAM 2 submodule
setup*.command             Installation scripts
start.command              Local launcher
```

Model weights, local environments, generated results, and downloaded SAM 2 dependencies are excluded from the main repository. Eleven small example images are retained to support the UI and tests. See [third-party notices](THIRD_PARTY_NOTICES.md) for sources and licenses.

## Development and verification

Checks that do not load large models:

```sh
node --test tests/*.cjs
.venv/bin/python -m unittest discover -s tests -p test_segment.py
```

Integration tests require a running local server and prepared model weights. They can trigger additional downloads and lengthy CPU inference:

```sh
.venv/bin/python -m unittest discover -s tests -p test_api.py
.venv/bin/python -m unittest discover -s tests -p test_relation.py
```

Submodules are pinned for reproducibility. After pulling changes to this project, run `git submodule update --init --recursive`. Upgrade dependency commits deliberately and rerun validation; do not automatically follow upstream branch tips.

If upgrading from the earlier `upstream/` layout, refresh the editable Python installations after updating the submodules:

```sh
uv pip install --python .venv/bin/python --no-deps --no-build-isolation -e ./vendor/yoloe -e ./vendor/yoloe/third_party/CLIP -e ./vendor/yoloe/third_party/ml-mobileclip
```

## Acknowledgements and licensing

Built on [YOLOE](https://github.com/THU-MIG/yoloe), [RelateAnything](https://github.com/Maelic/RelateAnything), [SAM](https://github.com/facebookresearch/segment-anything), and [SAM 2](https://github.com/facebookresearch/sam2), with CLIP, MobileCLIP, and JSZip.

Third-party code, model weights, and example images remain subject to their respective licenses and terms. Using submodules does not change those obligations. See each upstream repository and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
