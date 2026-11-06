"""Independent official SAM workspace; does not import or replace Ultralytics."""
import base64
import hashlib
import gc
import io
import json
import math
from pathlib import Path
import sys
import time

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image

ROOT = Path(__file__).resolve().parent
CHECKPOINT = ROOT / 'models/sam_vit_b_01ec64.pth'
_predictor = None
_image_key = None
_active_model = None
SAM2_CHECKPOINT = ROOT / 'models/sam2.1_hiera_tiny.pt'
MODEL_NAMES = {'sam-vit-b': 'SAM ViT-B', 'sam2.1-tiny': 'SAM 2.1 Tiny'}
progress = ''


def parse_prompts(raw, size, mode):
    try:
        value = json.loads(raw)
        points, labels, box = value.get('points', []), value.get('labels', []), value.get('box')
        w, h = size
        def number(v):
            return type(v) in (int, float) and math.isfinite(v)
        if not isinstance(points, list) or not isinstance(labels, list) or len(points) != len(labels) or len(points) > 64:
            raise ValueError()
        for p, label in zip(points, labels):
            if not isinstance(p, list) or len(p) != 2 or not all(number(x) for x in p) or not (0 <= p[0] < w and 0 <= p[1] < h) or type(label) is not int or label not in (0, 1):
                raise ValueError()
        if box is not None:
            if not isinstance(box, list) or len(box) != 4 or not all(number(x) for x in box) or not (0 <= box[0] < box[2] <= w and 0 <= box[1] < box[3] <= h):
                raise ValueError()
        if mode == 'prompt' and not points and box is None:
            raise ValueError()
        return points, labels, box
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, '请添加有效的前景点、背景点或矩形框（最多 64 个点）')


def encode_mask(mask, score, index):
    import numpy as np
    y, x = np.where(mask)
    if not len(x):
        return None
    buffer = io.BytesIO()
    Image.fromarray(mask.astype('uint8') * 255).save(buffer, format='PNG')
    return {'id': index, 'score': round(float(score), 4), 'area': int(mask.sum()),
            'box': [int(x.min()), int(y.min()), int(x.max()) + 1, int(y.max()) + 1],
            'png': base64.b64encode(buffer.getvalue()).decode('ascii')}


def predict(image, mode, prompts, model_id='sam-vit-b'):
    global _predictor, _image_key, progress, _active_model
    import numpy as np
    import torch
    started = time.perf_counter()
    torch.set_num_threads(4)
    if model_id == 'sam2.1-tiny':
        for directory in ['sam2-deps', 'sam2']:
            path = str(ROOT / 'vendor' / directory)
            if path not in sys.path:
                sys.path.insert(0, path)
        if not SAM2_CHECKPOINT.is_file():
            raise HTTPException(503, 'SAM 2 权重未就绪，请运行 setup-sam2.command')
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
        generator_class = SAM2AutomaticMaskGenerator
    else:
        path = str(ROOT / 'vendor/segment-anything')
        if path not in sys.path:
            sys.path.insert(0, path)
        from segment_anything import SamPredictor, SamAutomaticMaskGenerator, sam_model_registry
        if not CHECKPOINT.is_file():
            raise HTTPException(503, 'SAM 权重尚未就绪，请先运行 setup-segment.command')
        generator_class = SamAutomaticMaskGenerator
    if _predictor is None or _active_model != model_id:
        progress = '正在加载 ' + MODEL_NAMES[model_id]
        _predictor = None
        _image_key = None
        _active_model = None
        gc.collect()
        if model_id == 'sam2.1-tiny':
            _predictor = SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_t.yaml', str(SAM2_CHECKPOINT), device='cpu'))
        else:
            _predictor = SamPredictor(sam_model_registry['vit_b'](checkpoint=str(CHECKPOINT)).eval().to('cpu'))
        _active_model = model_id
    pixels = np.array(image)
    key = hashlib.sha256(pixels.tobytes() + str(image.size).encode()).hexdigest()
    with torch.inference_mode():
        if mode == 'auto':
            progress = '正在自动分割（CPU 模式可能需要数分钟）'
            _image_key = None
            generator = generator_class(_predictor.model, points_per_side=8, points_per_batch=8, crop_n_layers=0)
            candidates = sorted(generator.generate(pixels), key=lambda m: m['predicted_iou'], reverse=True)
            records = [(m['segmentation'], m['predicted_iou']) for m in candidates[:40]]
            total = len(candidates)
        else:
            if _image_key != key:
                progress = '正在编码图像；同图后续提示将复用编码'
                _image_key = None
                _predictor.set_image(pixels)
                _image_key = key
            progress = '正在根据提示生成候选掩膜'
            points, labels, box = prompts
            masks, scores, _ = _predictor.predict(
                point_coords=np.array(points) if points else None,
                point_labels=np.array(labels) if labels else None,
                box=np.array(box) if box else None, multimask_output=True)
            records = sorted(zip(masks, scores), key=lambda x: float(x[1]), reverse=True)
            total = len(records)
        masks = [encode_mask(mask, score, i + 1) for i, (mask, score) in enumerate(records)]
    return {'width': image.width, 'height': image.height, 'model': MODEL_NAMES[model_id], 'model_id': model_id, 'mode': mode,
            'elapsed_ms': round((time.perf_counter() - started) * 1000),
            'masks': [m for m in masks if m], 'truncated': total > 40}


def create_router(inference_lock, read_image):
    router = APIRouter(prefix='/api/segment')

    @router.get('/status')
    def status():
        return {'installed': CHECKPOINT.is_file(), 'loaded': _predictor is not None,
                'model': MODEL_NAMES.get(_active_model, 'SAM ViT-B'), 'device': 'CPU', 'progress': progress,
                'models': [
                    {'id': 'sam-vit-b', 'ready': CHECKPOINT.is_file(), 'note': '请运行 setup-segment.command'},
                    {'id': 'sam2.1-tiny', 'ready': SAM2_CHECKPOINT.is_file() and (ROOT / 'vendor/sam2-deps/hydra').is_dir() and (ROOT / 'vendor/sam2/sam2').is_dir(), 'note': '请运行 setup-sam2.command'}]}

    @router.post('')
    def segment(file: UploadFile = File(...), mode: str = Form('prompt'), prompts: str = Form('{}'), model_id: str = Form('sam-vit-b')):
        global progress
        if model_id not in MODEL_NAMES:
            raise HTTPException(400, '请选择有效的分割模型')
        if mode not in ('prompt', 'auto'):
            raise HTTPException(400, '无效的分割模式')
        image = read_image(file)
        if max(image.size) > 1600:
            raise HTTPException(400, '分割图片最长边不能超过 1600 像素')
        parsed = parse_prompts(prompts, image.size, mode)
        if not inference_lock.acquire(blocking=False):
            raise HTTPException(409, '当前有模型正在推理，请稍后重试')
        try:
            return predict(image, mode, parsed, model_id)
        except HTTPException:
            raise
        except Exception:
            import logging
            logging.exception('SAM inference failed')
            raise HTTPException(500, '分割失败，请检查终端日志及 SAM 安装状态')
        finally:
            progress = ''
            inference_lock.release()
    return router
