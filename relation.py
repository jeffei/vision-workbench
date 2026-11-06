"""Official RelateAnything ONNX models with their own vocabulary and calibration."""
import gc
import subprocess
import sys
import time
from pathlib import Path

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'vendor/RelateAnything-main/deploy/dist'
RELATION_MODELS = {
    'relsgg-vits16': 'ViT-S/16 · 46.1 M',
    'relsgg-vits16plus': 'ViT-S/16+ · 53.2 M',
    'relsgg-vitb16': 'ViT-B/16 · 113.8 M',
    'relsgg-convnext-tiny': 'ConvNeXt-T · 58.6 M',
    'relsgg-convnext-small': 'ConvNeXt-S · 80.2 M',
    'relsgg-convnext-base': 'ConvNeXt-B · 123.5 M',
    'relsgg-convnext-large': 'ConvNeXt-L · 245.7 M',
}
ONNX_MODELS = set(RELATION_MODELS) - {'relsgg-vits16', 'relsgg-vitb16'}
DEFAULT_RELATION_MODEL = 'relsgg-vits16plus'
head = None
active_model = None
progress = ''


def catalog():
    return [{'id': mid, 'description': description,
             'supported': mid in ONNX_MODELS,
             'installed': (DIST / mid / 'relateanything.onnx').is_file(),
             'url': f'https://huggingface.co/maelic/{mid}'}
            for mid, description in RELATION_MODELS.items()]


def ensure_bundle(model_id):
    global progress
    if model_id not in RELATION_MODELS:
        raise HTTPException(400, '请选择有效的 RelSGG 模型')
    if model_id not in ONNX_MODELS:
        raise HTTPException(400, '作者尚未提供此模型的 ONNX 权重，本机请选择其他 RelSGG 模型')
    bundle = DIST / model_id
    if not (bundle / 'relateanything.onnx').is_file():
        bundle.mkdir(parents=True, exist_ok=True)
        for name in ('predicate_bank.npz', 'relateanything.json', 'relateanything.onnx'):
            progress = f'正在下载 {model_id} / {name}'
            temporary = bundle / (name + '.part')
            try:
                subprocess.run(['curl', '-fsSL', '--retry', '2', '--connect-timeout', '20',
                                '--max-time', '900', f'https://huggingface.co/maelic/{model_id}/resolve/main/{name}',
                                '-o', str(temporary)], check=True)
                temporary.replace(bundle / name)
            except (OSError, subprocess.CalledProcessError) as exc:
                raise HTTPException(503, f'{model_id} 下载失败，请检查网络后重试') from exc
    return bundle


def infer_relations(image, detection, model_id, threshold):
    global head, active_model, progress
    import numpy as np
    sys.path.insert(0, str(ROOT / 'vendor/RelateAnything-main'))
    from deploy.runtime import OnnxRelationHead
    from deploy.postprocess import ThresholdConfig, decode
    if active_model != model_id:
        bundle = ensure_bundle(model_id)
        progress = f'正在加载 {model_id}'
        head = None
        active_model = None
        gc.collect()
        head = OnnxRelationHead(str(bundle / 'relateanything.onnx'),
                                str(bundle / 'predicate_bank.npz'), threads=2)
        active_model = model_id
    # OnnxRelationHead loads this checkpoint's official default predicate vocabulary.
    progress = '正在预测关系'
    objects = sorted(detection['detections'], key=lambda d: d['confidence'], reverse=True)[:head.max_boxes]
    started = time.perf_counter()
    candidates = []
    if len(objects) >= 2:
        boxes = np.asarray([d['box'] for d in objects], dtype=np.float32)
        raw = head(np.asarray(image)[:, :, ::-1], boxes)
        cfg = ThresholdConfig(threshold=0.0, topk=raw[0].size, max_per_pair=2,
                              calib_a=head.contract.calib_a, calib_b=head.contract.calib_b)
        triplets = decode(*raw, head.predicates, cfg, boxes_xyxy=boxes,
                          box_scores=np.asarray([d['confidence'] for d in objects]),
                          box_labels=[d['label'] for d in objects])
        candidates = [{'id': i, 'subject': int(t.subject_idx), 'predicate': t.predicate,
                       'object': int(t.object_idx), 'score': float(t.score)}
                      for i, t in enumerate(triplets)]
    relations = [r for r in candidates if r['score'] >= threshold][:24]
    return {**detection, 'detections': objects, 'relations': relations,
            'relation_candidates': candidates, 'relation_limit': 24,
            'relation_ms': round((time.perf_counter() - started) * 1000, 1),
            'relation_model': model_id, 'relation_backend': 'ONNX / CPU',
            'relation_threshold': threshold, 'predicates': list(head.predicates),
            'calibration': {'a': head.contract.calib_a, 'b': head.contract.calib_b},
            'objects_truncated': len(detection['detections']) > len(objects)}
