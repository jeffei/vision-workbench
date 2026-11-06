"""Local YOLOE customer demo. All predictions stay on this machine."""
import io
import json
import math
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)  # Official MobileCLIP resolves its checkpoint from the working directory.
app = FastAPI(title="视界 YOLOE 本地演示")
lock = threading.Lock()
model = None
active_key = None
text_encoder = None
encoder_variant = None
MODELS = {f'yoloe-{family}{size}': f'YOLOE-{family}-{size.upper()}'
          for family in ('v8', '11') for size in ('s', 'm', 'l')}
DEFAULT_MODEL = 'yoloe-v8s'


def new_model(model_id, pf=False):
    from ultralytics import YOLOE
    suffix = '-pf' if pf else ''
    path = ROOT / 'models' / f'{model_id}-seg{suffix}.pt'
    if not path.is_file():
        temporary = path.with_suffix('.pt.part')
        url = f'https://huggingface.co/jameslahm/yoloe/resolve/main/{path.name}'
        try:
            subprocess.run(['curl', '-fsSL', '--retry', '2', '--connect-timeout', '15',
                            '--max-time', '300', url, '-o', str(temporary)], check=True)
            temporary.replace(path)
        except (OSError, subprocess.CalledProcessError) as exc:
            raise HTTPException(503, f'{path.name} 下载失败，请检查网络后重试') from exc
    return YOLOE(str(path)).to('cpu')


def text_embeddings(detector, names):
    global text_encoder, encoder_variant
    variant = detector.model.args.get('text_model')
    if text_encoder is not None and encoder_variant == variant:
        detector.model.clip_model = text_encoder
    embeddings = detector.model.get_text_pe(names, cache_clip_model=True)
    text_encoder = detector.model.clip_model
    encoder_variant = variant
    return embeddings


def prompt_free_model(model_id=DEFAULT_MODEL):
    """Official get_vocab/set_vocab path, with RAM-bounded text encoding."""
    import torch
    names = (ROOT / 'upstream/tools/ram_tag_list.txt').read_text().splitlines()
    cache = ROOT / 'models' / f'{model_id}-ram-embeddings.pt'
    base = new_model(model_id)
    if cache.exists():
        saved = torch.load(cache, map_location='cpu', weights_only=True)
        if saved['names'] != names:
            raise RuntimeError('Cached vocabulary differs from the official RAM list')
        embeddings = saved['embeddings']
    else:
        chunks = []
        for i in range(0, len(names), 32):
            chunks.append(text_embeddings(base, names[i:i + 32]))
            print(f'Preparing prompt-free vocabulary: {min(i + 32, len(names))}/{len(names)}', flush=True)
        embeddings = torch.cat(chunks, dim=1)
        temporary = cache.with_suffix('.tmp')
        torch.save({'names': names, 'embeddings': embeddings}, temporary)
        temporary.replace(cache)
    # Equivalent to YOLOEModel.get_vocab after get_text_pe; only encoding is batched.
    base.set_classes(names, embeddings)
    base.model.fuse()
    vocab = torch.nn.ModuleList([head[-1] for head in base.model.model[-1].cv3])
    detector = new_model(model_id, pf=True)
    detector.set_vocab(vocab, names=names)
    detector.model.model[-1].is_fused = True
    detector.model.model[-1].conf = 0.001
    detector.model.model[-1].max_det = 1000
    return detector


def visual_prompts(raw, size):
    """Validate image-space geometry; freehand contours stay masks, not boxes."""
    import numpy as np
    try:
        value = json.loads(raw)
        kind, regions = value['kind'], value['regions']
        if kind not in ('box', 'shape') or not isinstance(regions, list) or not 1 <= len(regions) <= 20:
            raise ValueError()
        width, height = size
        for region in regions:
            if not isinstance(region, list):
                raise ValueError()
            if kind == 'box':
                if len(region) != 4:
                    raise ValueError()
                x1, y1, x2, y2 = region
                if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in region):
                    raise ValueError()
                if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
                    raise ValueError()
            else:
                if not 3 <= len(region) <= 5000:
                    raise ValueError()
                for point in region:
                    if not isinstance(point, list) or len(point) != 2:
                        raise ValueError()
                    x, y = point
                    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in point):
                        raise ValueError()
                    if not (0 <= x <= width and 0 <= y <= height):
                        raise ValueError()
        if kind == 'box':
            return {'bboxes': np.array(regions, dtype=np.float32), 'cls': np.zeros(len(regions), dtype=int)}
        mask = Image.new('L', size)
        draw = ImageDraw.Draw(mask)
        for region in regions:
            draw.polygon([tuple(p) for p in region], fill=1)
        if not mask.getbbox():
            raise ValueError()
        return {'masks': np.asarray(mask)[None], 'cls': np.array([0])}
    except (ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(400, '请在参考图片上绘制有效的矩形框或闭合轮廓（最多 20 个区域）')


def predict(image, names, confidence, prompt_mode='text', prompts=None, reference=None, model_id=DEFAULT_MODEL):
    global model, active_key
    import torch
    from ultralytics.models.yolo.yoloe.predict_vp import YOLOEVPSegPredictor

    start = time.perf_counter()
    torch.set_num_threads(4)
    options = dict(conf=confidence, imgsz=640, device='cpu', verbose=False)
    key = (model_id, prompt_mode, tuple(names) if prompt_mode == 'text' else ())
    if prompt_mode == 'visual':
        # Fresh unfused head prevents a prior text/PF/cross-image prompt from leaking.
        model = new_model(model_id)
        active_key = None
        kwargs = dict(prompts=prompts, predictor=YOLOEVPSegPredictor)
        if reference is not None:
            model.predict(reference, return_vpe=True, **kwargs, **options)
            model.set_classes(['object0'], model.predictor.vpe)
            model.predictor = None
            kwargs = {}
        prediction = model.predict(image, **kwargs, **options)[0]
    else:
        if model is None or active_key != key:
            active_key = None
            if prompt_mode == 'free':
                model = prompt_free_model(model_id)
            else:
                model = new_model(model_id)
                model.set_classes(names, text_embeddings(model, names))
            active_key = key
        prediction = model.predict(image, **options)[0]
    detections = []
    for box in prediction.boxes:
        class_id = int(box.cls.item())
        detections.append({'label': prediction.names[class_id], 'class_id': class_id,
                           'confidence': round(float(box.conf.item()), 4),
                           'box': [round(v, 2) for v in box.xyxy[0].tolist()]})
    class_names = prediction.names
    if isinstance(class_names, dict):
        class_names = [class_names[i] for i in range(len(class_names))]
    return {'width': image.width, 'height': image.height, 'detections': detections,
            'inference_ms': round(prediction.speed['inference'], 1),
            'elapsed_ms': round((time.perf_counter() - start) * 1000, 1),
            'model': MODELS[model_id] + ('-PF' if prompt_mode == 'free' else ''), 'model_id': model_id,
            'device': 'CPU', 'source': 'local_inference', 'prompt_mode': prompt_mode,
            'classes': class_names, 'threshold': confidence,
            'visual_usage': 'cross-image' if reference is not None else 'intra-image' if prompt_mode == 'visual' else None}


def read_image(upload):
    content = upload.file.read(20 * 1024 * 1024 + 1)
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, '图片不能超过 20 MB')
    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(content)))
        if image.width * image.height > 24_000_000:
            raise HTTPException(413, '图片不能超过 2400 万像素')
        return image.convert('RGB')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(400, '无法读取图片，请使用 JPG、PNG 或 WebP')


@app.get('/api/health')
def health():
    return {'ready': (ROOT / 'models/yoloe-v8s-seg.pt').exists() and (ROOT / 'mobileclip_blt.pt').exists(),
            'loaded': model is not None, 'model': 'YOLOE-v8-S', 'device': 'CPU',
            'models': [{'id': model_id, 'label': label,
                        'installed': (ROOT / 'models' / f'{model_id}-seg.pt').is_file(),
                        'pf_installed': (ROOT / 'models' / f'{model_id}-seg-pf.pt').is_file()}
                       for model_id, label in MODELS.items()],
            'prompt_free_ready': (ROOT / 'models/yoloe-v8s-seg-pf.pt').exists(),
            'vocabulary_cached': (ROOT / 'models/yoloe-v8s-ram-embeddings.pt').exists()}


@app.post('/api/detect')
def detect(file: UploadFile = File(...), classes: str = Form('person,bus,car'),
           confidence: float = Form(0.25), prompt_mode: str = Form('text'),
           visual: str = Form(''), reference: Optional[UploadFile] = File(None),
           model_id: str = Form(DEFAULT_MODEL)):
    if model_id not in MODELS:
        raise HTTPException(400, '请选择列表中的 YOLOE 模型')
    if prompt_mode not in ('text', 'visual', 'free'):
        raise HTTPException(400, '无效的提示模式')
    names = list(dict.fromkeys(x.strip() for x in classes.replace('，', ',').split(',') if x.strip())) if prompt_mode == 'text' else []
    if prompt_mode == 'text' and (not names or len(names) > 30 or any(len(x) > 80 for x in names)):
        raise HTTPException(400, '请输入 1–30 个目标名称，每个名称不超过 80 字符')
    if not 0.05 <= confidence <= 0.95:
        raise HTTPException(400, '置信度需在 0.05–0.95 之间')
    image = read_image(file)
    ref_image = read_image(reference) if prompt_mode == 'visual' and reference else None
    prompts = visual_prompts(visual, (ref_image or image).size) if prompt_mode == 'visual' else None
    if not lock.acquire(blocking=False):
        raise HTTPException(409, '模型正在处理另一帧，请稍后重试')
    try:
        return predict(image, names, confidence, prompt_mode, prompts, ref_image, model_id)
    except HTTPException:
        raise
    except Exception:
        import logging
        logging.exception('YOLOE inference failed')
        raise HTTPException(500, '推理失败，请查看终端日志，确认模型与依赖已安装')
    finally:
        lock.release()


@app.get('/api/relate/models')
def relation_models():
    import relation
    return {'models': relation.catalog(), 'default': relation.DEFAULT_RELATION_MODEL,
            'progress': relation.progress}


@app.post('/api/relate')
def relate(file: UploadFile = File(...), threshold: float = Form(0.56),
           model_id: str = Form(DEFAULT_MODEL),
           relation_model_id: str = Form('relsgg-vits16plus')):
    import relation
    if relation_model_id not in relation.ONNX_MODELS or model_id not in MODELS:
        raise HTTPException(400, '请选择有效的检测模型与 RelSGG 模型')
    if not math.isfinite(threshold) or not 0.05 <= threshold <= 0.95:
        raise HTTPException(400, '关系阈值需在 0.05–0.95 之间')
    image = read_image(file)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, '模型正在处理另一项任务，请稍后重试')
    try:
        started = time.perf_counter()
        relation.progress = '正在自动检测实体（首次运行可能下载权重或构建词表）'
        detection = predict(image, [], 0.25, prompt_mode='free', model_id=model_id)
        result = relation.infer_relations(image, detection, relation_model_id, threshold)
        result['total_ms'] = round((time.perf_counter() - started) * 1000, 1)
        return result
    except HTTPException:
        raise
    except Exception:
        import logging
        logging.exception('RelateAnything inference failed')
        raise HTTPException(500, '关系推理失败，请查看终端日志及关系模型安装说明')
    finally:
        relation.progress = ''
        lock.release()


from segment import create_router as create_segment_router
app.include_router(create_segment_router(lock, read_image))

app.mount('/', StaticFiles(directory=ROOT / 'web', html=True), name='web')
