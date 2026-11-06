/* Export the input pixels and their model predictions as a detection dataset. */
async function buildTrainingZip(format, frames, names, visualLabel) {
  if (!frames.length) throw new Error('请先运行一次检测');
  const zip = new JSZip();
  const categories = names.map((name, index) => ({
    id: index + 1,
    name: visualLabel && names.length === 1 ? visualLabel : name
  }));
  const coco = {images: [], annotations: [], categories};
  const sources = [];
  let annotationId = 1;
  for (const [index, frame] of frames.entries()) {
    const stem = `frame_${String(index + 1).padStart(6, '0')}`;
    const filename = `${stem}.jpg`;
    zip.file(`images/train/${filename}`, await frame.image.arrayBuffer());
    sources.push({image: filename, source: frame.filename, seconds: frame.seconds,
      model: frame.model, mode: frame.mode, threshold: frame.threshold});
    coco.images.push({id: index + 1, file_name: filename, width: frame.width, height: frame.height});
    const lines = [];
    for (const detection of frame.detections) {
      const [x1, y1, x2, y2] = detection.box;
      const width = x2 - x1, height = y2 - y1;
      if (width <= 0 || height <= 0) continue;
      if (format === 'yolo') {
        const normalized = [(x1 + x2) / (2 * frame.width), (y1 + y2) / (2 * frame.height),
          width / frame.width, height / frame.height];
        lines.push([detection.class_id, ...normalized.map(value => value.toFixed(8))].join(' '));
      } else {
        coco.annotations.push({id: annotationId++, image_id: index + 1, category_id: detection.class_id + 1,
          bbox: [x1, y1, width, height], area: width * height, iscrowd: 0});
      }
    }
    if (format === 'yolo') zip.file(`labels/train/${stem}.txt`, lines.join('\n') + (lines.length ? '\n' : ''));
  }
  if (format === 'yolo') {
    zip.folder('images/val');
    zip.folder('labels/val');
    zip.file('data.yaml', `train: images/train\nval: images/val\nnames: ${JSON.stringify(categories.map(c => c.name))}\n`);
  } else {
    zip.file('annotations/instances_train.json', JSON.stringify(coco));
  }
  zip.file('sources.json', JSON.stringify(sources, null, 2));
  zip.file('README.txt', '图像与检测框来自本次本地推理。用于训练前请复核误检、漏检和类别。\n各图像位于 images/train/，sources.json 保存来源和视频时间。\nYOLO 使用归一化中心点与宽高，COCO 使用像素单位的左上角与宽高。\n请单独准备验证集，同一视频的相邻帧应划入同一数据子集。\n');
  return zip.generateAsync({type: 'blob'});
}
