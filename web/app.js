const $ = id => document.getElementById(id);
const palette = ['#50e5c2','#58bdff','#d39aff','#f5cf70','#fa86a2','#9bde73'];
const scenes = {street: {title:'Detect Anything',description:'统一的目标识别与训练标注工作台',classes:'person, bus, car, bicycle, traffic light',image:'/assets/street.jpg'}};
let scene = 'street', source = null, result = null, busy = false, running = false, isVideo = false;
let frames = 0, objectUrl = null, timer = null, toastTimer = null, revision = 0;
const video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const capture = document.createElement('canvas');
let promptMode='free', drawingTool='box', regions=[], draft=null, referenceImage=null, referenceExternal=false;
let importedReference=null, importedReferenceFile=null, referenceLoad=0;
let modelCatalog=[], trainingNames=[], trainingFrames=new Map();
let detectionCandidates=null;

function updateModelState(){
  const selected=modelCatalog.find(item=>item.id===$('model-select').value);
  if(!selected)return;
  const available=selected.installed&&(promptMode!=='free'||selected.pf_installed);
  $('model-state').textContent=available?'权重已就绪 · 本机 CPU':'首次检测将下载官方权重';
}

function updateTrainingCount(){
  $('training-count').textContent=`${trainingFrames.size} 张图像`;
  $('export-training').disabled=!trainingFrames.size;
}

function clearTraining(){trainingFrames.clear();trainingNames=[];updateTrainingCount();}

function recordTraining(image,data){
  const seconds=isVideo?video.currentTime:null;
  trainingNames=data.classes;
  trainingFrames.set(seconds??0,{image,filename:$('filename').textContent,seconds,width:data.width,height:data.height,
    detections:data.detections,mode:data.prompt_mode||'text',model:data.model,threshold:data.threshold});
  updateTrainingCount();
}

function updateRegions(){ $('region-status').textContent=regions.length?`已标注 ${regions.length} 个区域 · 同一目标类${drawingTool==='shape'?' · 拖动圆点调整轮廓':''}`:'尚未标注目标'; if(drawingTool==='shape')$('region-status').textContent+=' · 按住鼠标描画，松开自动闭合；也可逐点点击'; }

let dragVertex=null;
function resetRegions(){ regions=[];draft=null;dragVertex=null;updateRegions(); }

async function useCurrentReference(){
  if(!source)return;
  referenceExternal=false;$('reference-source').value='current';$('upload-reference').classList.add('hidden');resetRegions();
  if(isVideo){const frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d').drawImage(video,0,0);const im=new Image();await new Promise(resolve=>{im.onload=resolve;im.src=frame.toDataURL('image/png');});referenceImage=im;}
  else referenceImage=source;
  $('reference-note').textContent=isVideo?'视频参考帧：以当前帧的标注寻找后续帧中的相似目标。':'同图检测：在当前素材中寻找相似目标。';paint();
}

function setPromptMode(mode){
  if(busy){$('prompt-select').value=promptMode;return;}stop();revision++;promptMode=mode;draft=null;dragVertex=null;
  $('prompt-select').value=mode;
  const sidebar=document.querySelector('#see-view aside');
  const parameters=sidebar.querySelector('.parameters');
  if(mode==='free')sidebar.append(parameters);else sidebar.prepend(parameters);
  for(const value of ['text','visual','free'])$(value+'-settings').classList.toggle('hidden',value!==mode);
  $('prompt-mode-label').textContent={text:'TEXT PROMPT',visual:'VISUAL PROMPT',free:'PROMPT-FREE'}[mode];
  $('reference-panel').classList.toggle('hidden',mode!=='visual');updateModelState();clearResults();
  if(mode==='visual'&&!referenceImage&&!referenceExternal)useCurrentReference();else paint();
}

function paintReference(){
  if(promptMode!=='visual')return;
  $('reference-preview').classList.toggle('has-image',Boolean(referenceImage));
  $('upload-reference').classList.toggle('hidden',!referenceExternal);
  $('upload-reference').textContent=referenceImage?'更换参考图片':'选择参考图片';
  $('enlarge-reference').disabled=!referenceImage;
  for(const target of [$('ref-thumb'),$('ref-editor')]){
    if(target.id==='ref-editor'&&!$('ref-dialog').open)continue;
    if(!referenceImage){target.getContext('2d').clearRect(0,0,target.width,target.height);continue;}
    target.width=referenceImage.naturalWidth;target.height=referenceImage.naturalHeight;
    const ctx=target.getContext('2d');ctx.drawImage(referenceImage,0,0);
    drawRegions(ctx,target.width);
  }
}

function drawRegions(c, width){
  c.save();
  const scale = width / 800;
  regions.forEach((r, idx) => {
    c.strokeStyle = '#ffd47a';
    c.fillStyle = '#ffd47a33';
    c.lineWidth = Math.max(2, 2 * scale);
    if(!Array.isArray(r[0])){
      const [x1, y1, x2, y2] = r;
      c.fillRect(x1, y1, x2 - x1, y2 - y1);
      c.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else {
      c.beginPath();
      r.forEach(([x, y], i) => i === 0 ? c.moveTo(x, y) : c.lineTo(x, y));
      c.closePath();
      c.fill();
      c.stroke();
      r.forEach(([x, y]) => {
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(x, y, Math.max(4, 4 * scale), 0, Math.PI * 2);
        c.fill();
      });
    }
  });
  if(draft){
    c.strokeStyle = '#50e5c2';
    c.fillStyle = '#50e5c233';
    c.lineWidth = Math.max(2, 2 * scale);
    if(drawingTool === 'box'){
      const [x1, y1, x2, y2] = draft;
      c.fillRect(x1, y1, x2 - x1, y2 - y1);
      c.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else {
      c.beginPath();
      draft.forEach(([x, y], i) => i === 0 ? c.moveTo(x, y) : c.lineTo(x, y));
      if(draft.length>=3){c.closePath();c.fill();}
      c.stroke();
    }
  }
  c.restore();
}

function clearResults(){
  result = null;
  detectionCandidates = null;
  $('count').textContent = '—';
  $('categories').textContent = '—';
  $('latency').textContent = '—';
  $('result-origin').textContent = '等待真实推理';
  $('bars').innerHTML = '<p class="empty">点击「开始检测」分析当前画面</p>';
  $('log').innerHTML = '<div class="log-empty">检测完成后，在这里查看目标明细</div>';
  paint();
}

function stop(){
  running = false;
  busy = false;
  if(isVideo){ video.pause(); }
  $('run').classList.remove('running');
  $('run').querySelector('span').textContent = '开始检测';
  $('mode').textContent = '等待检测';
  $('loading').classList.add('hidden');
}

async function loadScene(s){
  if(busy) return;
  stop();
  scene = s;
  document.querySelectorAll('nav .scene').forEach(b => b.classList.toggle('active', b.dataset.scene === s));
  const cfg = scenes[s];
  $('scenario-name').textContent = cfg.title;
  $('scenario-description').textContent = cfg.description;
  $('classes').value = cfg.classes;
  updatePromptTags();
  clearTraining();
  clearResults();

  if(cfg.image){
    isVideo = false;
    video.hidden = true;
    canvas.hidden = false;
    $('media-kind').textContent = 'IMAGE';
    $('filename').textContent = cfg.image.split('/').pop();
    $('source-title').textContent = `${cfg.title} / 示例图像`;
    $('source-note').textContent = '官方示例 · 可替换为客户场景';
    const im = new Image();
    await new Promise(resolve => { im.onload = resolve; im.src = cfg.image; });
    source = im;
    canvas.width = im.naturalWidth;
    canvas.height = im.naturalHeight;
    $('resolution').textContent = `${im.naturalWidth} × ${im.naturalHeight}`;
    referenceImage = im;
    paint();
  } else {
    source = null;
    referenceImage = null;
    canvas.width = 640;
    canvas.height = 360;
    $('resolution').textContent = '—';
    $('filename').textContent = '未选择素材';
    $('source-title').textContent = `${cfg.title} / 请导入客户素材`;
    $('source-note').textContent = '支持 JPG / PNG / WebP 或 MP4 视频';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function updatePromptTags(){
  const tags = $('prompt-tags');
  tags.innerHTML = '';
  $('classes').value.split(',').map(s => s.trim()).filter(Boolean).forEach(name => {
    const span = document.createElement('span');
    span.textContent = name;
    tags.appendChild(span);
  });
}

function showToast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

function paint(){
  paintReference();
  if(!source) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  if(!result || !$('boxes').checked) return;
  const dets = result.detections || [];
  dets.forEach(d => {
    const [x1, y1, x2, y2] = d.box;
    const color = palette[d.class_id % palette.length];
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '22';
    ctx.lineWidth = 2;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    const label = `${d.label} ${(d.confidence * 100).toFixed(0)}%`;
    ctx.font = 'bold 11px sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(x1, Math.max(0, y1 - 18), tw + 8, 18);
    ctx.fillStyle = '#080d13';
    ctx.fillText(label, x1 + 4, Math.max(12, y1 - 5));
  });
}

function applyVisualLabel(data){
  if(data.prompt_mode!=='visual'&&data.mode!=='visual')return;
  const name=$('visual-label').value.trim()||'object0';
  data.classes=[name];
  data.detections.forEach(d=>{d.label=name;});
}

function updateVisualLabel(){
  for(const frame of trainingFrames.values())applyVisualLabel(frame);
  if([...trainingFrames.values()].some(frame=>frame.mode==='visual'))trainingNames=[$('visual-label').value.trim()||'object0'];
  if(detectionCandidates)applyVisualLabel(detectionCandidates);
  if(result&&result.prompt_mode==='visual')renderDetections(detectionCandidates||result,false);
}

function filterDetections(data){
  const threshold=Number($('confidence').value);
  return {...data, inference_threshold:data.inference_threshold??data.threshold,
    threshold, detections:data.detections.filter(d=>d.confidence>=threshold)};
}

function updateConfidence(){
  $('confidence-value').textContent=Number($('confidence').value).toFixed(2);
  if(detectionCandidates)renderDetections(detectionCandidates,false);
}

function renderDetections(data, countFrame=true){
  applyVisualLabel(data);
  if(countFrame)detectionCandidates=data;
  data=filterDetections(data);
  result = data;
  const dets = data.detections || [];
  $('count').textContent = dets.length;
  $('latency').textContent = data.inference_ms;
  $('result-origin').textContent = `模型推理耗时 ${data.inference_ms} ms · ${data.model}`;
  $('frame-count').textContent = `${countFrame?++frames:frames} 帧已分析`;

  // 类别分布
  const counts = Object.create(null);
  dets.forEach(d => { counts[d.label] = (counts[d.label] || 0) + 1; });
  const classes = Object.keys(counts);
  $('categories').textContent = classes.length;
  const bars = $('bars');
  bars.innerHTML = '';
  if(!classes.length){
    bars.innerHTML = '<p class="empty">未识别到任何目标</p>';
  } else {
    const maxVal = Math.max(...Object.values(counts));
    classes.forEach((name, i) => {
      const val = counts[name];
      const div = document.createElement('div');
      div.className = 'bar-row';
      const pct = (val / maxVal * 100).toFixed(0);
      div.innerHTML = `<span class="bar-label"></span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${palette[i % palette.length]}"></div></div><span class="bar-val">${val}</span>`;
      div.querySelector('.bar-label').textContent=name;
      bars.appendChild(div);
    });
  }

  // 记录列表
  const log = $('log');
  log.innerHTML = '';
  if(!dets.length){
    log.innerHTML = '<div class="log-empty">当前画面未检测到目标</div>';
  } else {
    dets.forEach(d => {
      const row = document.createElement('div');
      row.className = 'log-row';
      row.innerHTML = `<span><b></b></span><span>${(d.confidence*100).toFixed(1)}%</span><span class="subtle">[${d.box.map(Math.round).join(', ')}]</span><span class="tag">检出</span>`;
      row.querySelector('b').textContent=d.label;
      log.appendChild(row);
    });
  }
  paint();
}

async function detectCurrentFrame(){
  if(!source) return;
  if(promptMode==='visual'&&(!referenceImage||!regions.length)){showToast('请先选择参考图并标注目标');return;}
  busy = true;
  $('loading').classList.remove('hidden');
  $('mode').textContent = '正在检测...';

  const formData = new FormData();
  let imageBlob = null;
  if(isVideo){
    capture.width = video.videoWidth;
    capture.height = video.videoHeight;
    capture.getContext('2d').drawImage(video, 0, 0);
    imageBlob = await new Promise(r => capture.toBlob(r, 'image/jpeg', 0.9));
  } else if($('file').files[0]){
    imageBlob = $('file').files[0];
  } else if(scenes[scene].image){
    imageBlob = await fetch(scenes[scene].image).then(r => r.blob());
  }

  if(!imageBlob){
    busy = false;
    $('loading').classList.add('hidden');
    showToast('请先导入图片或视频');
    return;
  }

  formData.append('file', imageBlob, 'frame.jpg');
  formData.append('classes', $('classes').value);
  // Cache candidates down to the slider minimum; display filtering stays local.
  formData.append('confidence', '0.05');
  formData.append('prompt_mode', promptMode);
  formData.append('model_id', $('model-select').value);

  if(promptMode === 'visual'){
    formData.append('visual', JSON.stringify({kind: drawingTool, regions}));
    if(referenceExternal && importedReferenceFile){
      formData.append('reference', importedReferenceFile);
    }
  }

  try {
    const res = await fetch('/api/detect', {method: 'POST', body: formData});
    if(!res.ok){
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderDetections(data);
    recordTraining(imageBlob, data);
    $('mode').textContent = '检测完成';
  } catch(e){
    console.error(e);
    showToast(`检测失败: ${e.message}`);
    $('mode').textContent = '检测异常';
  } finally {
    busy = false;
    $('loading').classList.add('hidden');
  }
}

async function loop(){
  if(!running || !isVideo) return;
  if(video.paused || video.ended){ stop(); return; }
  await detectCurrentFrame();
  if(!running) return;
  video.currentTime = Math.min(video.duration, video.currentTime + 0.5);
  if(video.currentTime >= video.duration){ stop(); showToast('视频分析完毕'); return; }
  video.onseeked = () => {
    video.onseeked = null;
    loop();
  };
}

function toggleRun(){
  if(running){ stop(); return; }
  if(!source){ showToast('请先选择场景或导入素材'); return; }
  running = true;
  $('run').classList.add('running');
  $('run').querySelector('span').textContent = '停止检测';
  if(isVideo){
    video.play().catch(() => {});
    loop();
  } else {
    detectCurrentFrame().finally(() => stop());
  }
}

// Simplify both halves of a closed stroke, preserving its major corners.
function simplifyContour(points, tolerance){
  function distance(p,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const t=dx||dy?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))):0;
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  }
  function simplify(line){
    let farthest=0,index=0;
    for(let i=1;i<line.length-1;i++){
      const d=distance(line[i],line[0],line[line.length-1]);
      if(d>farthest){farthest=d;index=i;}
    }
    if(farthest<=tolerance)return [line[0],line[line.length-1]];
    return [...simplify(line.slice(0,index+1)).slice(0,-1),...simplify(line.slice(index))];
  }
  const ring=points.slice();
  if(ring.length>3&&distance(ring[ring.length-1],ring[0],ring[0])<tolerance)ring.pop();
  let split=1;
  for(let i=2;i<ring.length;i++){
    if(distance(ring[i],ring[0],ring[0])>distance(ring[split],ring[0],ring[0]))split=i;
  }
  const result=[...simplify(ring.slice(0,split+1)).slice(0,-1),...simplify([...ring.slice(split),ring[0]]).slice(0,-1)];
  // Keep at least three points even for very small strokes.
  if(result.length<3){
    let third=ring.findIndex((_,i)=>i!==0&&i!==split);
    for(let i=1;i<ring.length;i++){
      if(i!==split&&distance(ring[i],ring[0],ring[split])>distance(ring[third],ring[0],ring[split]))third=i;
    }
    return [0,split,third].sort((a,b)=>a-b).map(i=>ring[i]);
  }
  return result;
}

// 坐标按 object-fit: contain 的实际图像区域换算，排除画布留白。
function setupDrawing(el){
  let start=null, pointer=null, tracing=false, draftLength=0;
  function position(e, clamp=false){
    const r=el.getBoundingClientRect();
    const scale=Math.min(r.width/el.width,r.height/el.height);
    const x=(e.clientX-r.left-(r.width-el.width*scale)/2)/scale;
    const y=(e.clientY-r.top-(r.height-el.height*scale)/2)/scale;
    if(!clamp&&(x<0||y<0||x>el.width||y>el.height))return null;
    return {point:[Math.max(0,Math.min(el.width,x)),Math.max(0,Math.min(el.height,y))],radius:10/scale};
  }
  function finishShape(){
    if(!draft||draft.length<3)return;
    regions.push(draft);draft=null;updateRegions();paintReference();
  }
  el.addEventListener('pointerdown', e=>{
    if(promptMode!=='visual'||!referenceImage||e.button!==0||pointer!==null)return;
    const pos=position(e);if(!pos)return;
    const [x,y]=pos.point;
    tracing=false;draftLength=draft?draft.length:0;
    if(drawingTool==='shape'){
      if(!draft){
        for(let i=regions.length-1;i>=0;i--){
          if(!Array.isArray(regions[i][0]))continue;
          const vertex=regions[i].findIndex(p=>Math.hypot(p[0]-x,p[1]-y)<=pos.radius);
          if(vertex!==-1){dragVertex={region:i,vertex};break;}
        }
      }
      if(!dragVertex){
        if(draft&&draft.length>=3&&Math.hypot(draft[0][0]-x,draft[0][1]-y)<=pos.radius){finishShape();return;}
        if(e.detail===2){finishShape();return;}
        if(!draft)draft=[];
        draft.push([x,y]);
      }
    }else{start=[x,y];draft=[x,y,x,y];}
    pointer=e.pointerId;el.setPointerCapture(pointer);paintReference();
  });
  el.addEventListener('pointermove', e=>{
    if(e.pointerId!==pointer)return;
    const {point:[x,y],radius}=position(e,true);
    if(dragVertex)regions[dragVertex.region][dragVertex.vertex]=[x,y];
    else if(start)draft=[Math.min(start[0],x),Math.min(start[1],y),Math.max(start[0],x),Math.max(start[1],y)];
    else if(drawingTool==='shape'&&draft){
      const last=draft[draft.length-1];
      // Sample every six screen pixels to keep the contour easy to edit.
      if(Math.hypot(x-last[0],y-last[1])<radius*0.6)return;
      draft.push([x,y]);tracing=true;
    }else return;
    paintReference();
  });
  function release(e){
    if(e.pointerId!==pointer)return;
    if(start&&draft){
      if(e.type!=='pointercancel'&&draft[2]-draft[0]>5&&draft[3]-draft[1]>5)regions.push(draft);
      draft=null;
    }
    if(drawingTool==='shape'&&!dragVertex&&draft){
      if(e.type==='pointercancel'){draft=draftLength?draft.slice(0,draftLength):null;}
      else if(tracing){
        const {point,radius}=position(e,true);
        const last=draft[draft.length-1];
        if(Math.hypot(point[0]-last[0],point[1]-last[1])>radius*0.2)draft.push(point);
        if(draft.length>=3){draft=simplifyContour(draft,radius*0.8);finishShape();}else draft=null;
      }
    }
    start=null;dragVertex=null;pointer=null;tracing=false;
    if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
    updateRegions();paintReference();
  }
  el.addEventListener('pointerup',release);
  el.addEventListener('pointercancel',release);
  el.addEventListener('dblclick',()=>{if(drawingTool==='shape')finishShape();});
}

window.addEventListener('DOMContentLoaded', async () => {
  // 模型状态与拉取
  fetch('/api/health').then(r => r.json()).then(data => {
    modelCatalog = data.models || [];
    const sel = $('model-select');
    sel.innerHTML = '';
    modelCatalog.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      sel.appendChild(opt);
    });
    $('connection').innerHTML = '<i></i>已连接';
    updateModelState();
  }).catch(() => {
    $('connection').innerHTML = '<i style="background:#fa86a2"></i>未连接';
  });

  $('model-select').addEventListener('change', updateModelState);
  document.querySelectorAll('nav .scene').forEach(b => {
    b.addEventListener('click', () => loadScene(b.dataset.scene));
  });
  $('prompt-select').addEventListener('change', e => setPromptMode(e.target.value));

  $('confidence').addEventListener('input', updateConfidence);
  $('classes').addEventListener('input', updatePromptTags);
  $('visual-label').addEventListener('input', updateVisualLabel);

  $('run').addEventListener('click', toggleRun);
  $('upload').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => {
    const file = e.target.files[0];
    if(!file) return;
    if(objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    $('filename').textContent = file.name;
    $('source-title').textContent = file.name;
    $('source-note').textContent = '客户本地素材';
    stop();
    clearTraining();
    clearResults();

    if(file.type.startsWith('video/')){
      isVideo = true;
      video.src = objectUrl;
      video.hidden = false;
      canvas.hidden = false;
      $('media-kind').textContent = 'VIDEO';
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        $('resolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
        source = video;
        if(!referenceExternal)useCurrentReference();
      };
    } else {
      isVideo = false;
      video.hidden = true;
      canvas.hidden = false;
      $('media-kind').textContent = 'IMAGE';
      const im = new Image();
      im.onload = () => {
        canvas.width = im.naturalWidth;
        canvas.height = im.naturalHeight;
        $('resolution').textContent = `${im.naturalWidth} × ${im.naturalHeight}`;
        source = im;
        if(!referenceExternal)useCurrentReference();
        paint();
      };
      im.src = objectUrl;
    }
  });

  $('boxes').addEventListener('change', paint);
  $('export-image').addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = `detection_${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    showToast('已保存当前截图');
  });

  $('export-json').addEventListener('click', () => {
    if(!result){ showToast('暂无检测数据'); return; }
    const blob = new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.download = `detection_${Date.now()}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    showToast('已导出 JSON');
  });

  $('export-training').addEventListener('click', async () => {
    if(!trainingFrames.size) return;
    const format = $('train-format').value;
    const zipBlob = await buildTrainingZip(format, Array.from(trainingFrames.values(), filterDetections), trainingNames, '');
    const a = document.createElement('a');
    a.download = `${format.toUpperCase()}_dataset_${Date.now()}.zip`;
    a.href = URL.createObjectURL(zipBlob);
    a.click();
    showToast('已导出训练数据集');
  });

  // 参考图相关
  function setDrawingTool(tool){
    if(tool!==drawingTool){
      regions=regions.map(r=>tool==='shape'?[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]]:[Math.min(...r.map(p=>p[0])),Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[0])),Math.max(...r.map(p=>p[1]))]);
      draft=null;dragVertex=null;
    }
    drawingTool=tool;
    $('drawing-tool').value=tool;
    updateRegions();paintReference();
  }
  $('drawing-tool').addEventListener('change',e=>setDrawingTool(e.target.value));
  $('undo-region').addEventListener('click',()=>{if(draft){draft.pop();if(!draft.length)draft=null;}else regions.pop();updateRegions();paintReference();});
  $('clear-regions').addEventListener('click', () => { resetRegions(); paintReference(); });
  $('reference-source').addEventListener('change',e=>{
    if(busy){e.target.value=referenceExternal?'imported':'current';return;}
    referenceLoad++;
    resetRegions();clearTraining();clearResults();
    referenceExternal=e.target.value==='imported';
    $('upload-reference').classList.toggle('hidden',!referenceExternal);
    if(referenceExternal){
      referenceImage=importedReference;
      $('reference-note').textContent=referenceImage?'跨图检测：使用导入参考图中的标注寻找目标。':'请点击「选择参考图片」导入图片，再标注目标。';
      paintReference();
    }else useCurrentReference();
  });
  $('upload-reference').addEventListener('click', () => $('reference-file').click());
  $('reference-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if(!file) return;
    if(busy){showToast('请等待本次检测完成后更换参考图');return;}
    const token=++referenceLoad,url=URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      if(token!==referenceLoad||!referenceExternal)return;
      importedReference=im;importedReferenceFile=file;referenceImage=im;
      resetRegions();clearTraining();clearResults();
      $('reference-note').textContent='跨图检测：使用导入参考图中的标注寻找目标。';
      paintReference();
    };
    im.onerror=()=>{URL.revokeObjectURL(url);showToast('无法读取参考图，请重新选择图片');};
    im.src = url;
    e.target.value='';
  });
  $('enlarge-reference').addEventListener('click', () => { $('ref-dialog').showModal(); paintReference(); });
  $('close-ref').addEventListener('click', () => $('ref-dialog').close());

  setupDrawing($('ref-thumb'));
  setupDrawing($('ref-editor'));

  $('fullscreen').addEventListener('click', () => {
    if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
    else document.exitFullscreen().catch(()=>{});
  });

  // 默认加载城市街景
  await loadScene('street');
});
