(() => {
  const el = id => document.getElementById(id);
  const statuses = {pending:'待复核',confirmed:'已确认',dismissed:'已排除'};
  let blob=null, image=null, data=null, selected=-1, filter='all', working=false, reviews={}, fileName='', generation=0, detectorModels=[], relationModels=[];
  const canvas=el('rel-canvas'), ctx=canvas.getContext('2d');
  const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function clear(){ el('rel-annotation-note').textContent='全部标注 · 点击关系可聚焦查看';filter='all';document.querySelectorAll('[data-rel-filter]').forEach(b=>b.classList.toggle('active',b.dataset.relFilter==='all'));data=null;el('rel-entities').innerHTML='<small>分析后显示实体与检测置信度</small>';el('rel-entity-count').textContent='ENTITIES';reviews={};selected=-1;el('rel-export').disabled=true;el('rel-show-all').disabled=true;el('rel-objects').textContent='—';el('rel-count').textContent='—';el('rel-reviewed').textContent='0';el('rel-time').textContent='—';el('rel-status').textContent='待分析';el('rel-result-note').textContent='当前配置尚未分析';render();paint(); }
  function paint(){
    if(!image)return;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;ctx.drawImage(image,0,0);
    if(!data)return;
    const displayedRelations=data.relations.filter(r=>reviews[r.id]!=='dismissed');
    const linked=new Set(displayedRelations.flatMap(r=>[r.subject,r.object]));
    const relatedOnly=el('rel-related-only').checked;
    const visible=data.detections.map((d,i)=>({...d,index:i})).filter(d=>!relatedOnly||linked.has(d.index));
    el('rel-entity-count').textContent=visible.length+' / '+data.detections.length+' ENTITIES';
    el('rel-entities').innerHTML=visible.map(d=>`<span>${safe(d.label)} #${d.index+1} · ${(d.confidence*100).toFixed(0)}%</span>`).join('')||'<small>当前没有符合显示条件的实体</small>';
    const t=reviews[data.relations[selected]?.id]==='dismissed'?null:data.relations[selected], scale=Math.max(canvas.width/1000,0.65);
    el('rel-annotation-note').textContent=t?'聚焦关系 '+(selected+1)+' · 点击「全部标注」返回总览':`${relatedOnly?'仅关联实体':'全部标注'} · ${visible.length} / ${data.detections.length} 个实体 · ${displayedRelations.length} 条关系`;
    const colors=['#50e5c2','#c2a4ff','#58bdff','#f5cf70','#fa86a2','#9bde73'];
    data.detections.forEach((d,i)=>{
      if(relatedOnly&&!linked.has(i))return;
      const active=t&&(i===t.subject||i===t.object);
      const color=t?(i===t.subject?'#50e5c2':i===t.object?'#c2a4ff':'#8b9aaa'):colors[i%colors.length];
      const [x,y,x2,y2]=d.box;
      ctx.strokeStyle=color;ctx.lineWidth=(active?4:2)*scale;ctx.globalAlpha=t&&!active?.3:1;ctx.strokeRect(x,y,x2-x,y2-y);
      if(active||!t){ctx.font=`600 ${16*scale}px sans-serif`;const text=`${d.label} #${i+1}`;const w=ctx.measureText(text).width+12*scale;const top=Math.max(0,y-25*scale);ctx.fillStyle=color;ctx.fillRect(x,top,w,25*scale);ctx.fillStyle='#08101a';ctx.fillText(text,x+6*scale,top+18*scale);}ctx.globalAlpha=1;
    });
    // Keep multiple predicates on the same directed pair together so labels do not overlap.
    const pairs=new Map();
    (t?[t]:displayedRelations).forEach(r=>{const key=r.subject+':'+r.object;if(!pairs.has(key))pairs.set(key,{...r,names:[]});pairs.get(key).names.push(r.predicate);});
    pairs.forEach(r=>{
      const center=d=>[(d.box[0]+d.box[2])/2,(d.box[1]+d.box[3])/2];
      const [x,y]=center(data.detections[r.subject]),[u,v]=center(data.detections[r.object]);const a=Math.atan2(v-y,u-x);
      ctx.strokeStyle='#d8c9ff';ctx.fillStyle='#d8c9ff';ctx.lineWidth=3*scale;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(u,v);ctx.stroke();
      ctx.beginPath();ctx.moveTo(u,v);ctx.lineTo(u-16*scale*Math.cos(a-.45),v-16*scale*Math.sin(a-.45));ctx.lineTo(u-16*scale*Math.cos(a+.45),v-16*scale*Math.sin(a+.45));ctx.fill();
      ctx.font=`600 ${15*scale}px sans-serif`;
      r.names.forEach((name,j)=>{const w=ctx.measureText(name).width+20*scale;const left=Math.max(0,Math.min(canvas.width-w,(x+u-w)/2));const top=Math.max(0,Math.min(canvas.height-25*scale,(y+v)/2-20*scale+j*26*scale));ctx.fillStyle='#201931ee';ctx.fillRect(left,top,w,25*scale);ctx.fillStyle='#e3d5ff';ctx.fillText(name,left+10*scale,top+18*scale);});
    });
  }

  function render(){
    const list=el('rel-list');list.replaceChildren();
    if(!data){list.innerHTML='<p class="empty">上传图片或加载官方示例，点击「分析关系」。</p>';return;}
    el('rel-reviewed').textContent=data.relations.filter(r=>reviews[r.id]&&reviews[r.id]!=='pending').length;
    data.relations.forEach((r,i)=>{const state=reviews[r.id]||'pending';if(filter!=='all'&&filter!==state)return;const s=data.detections[r.subject],o=data.detections[r.object];const card=document.createElement('div');card.className='rel-card'+(selected===i?' selected':'');card.innerHTML=`<button class="rel-evidence" aria-label="查看关系 ${i+1} 的证据"><div class="rel-triplet"><b>${safe(s.label)} #${r.subject+1}</b><em>→ ${safe(r.predicate)} →</em><b>${safe(o.label)} #${r.object+1}</b></div><div class="rel-card-meta"><span>${safe(r.predicate)} · 线索 ${String(i+1).padStart(2,'0')}</span><span>关系置信度 ${(r.score*100).toFixed(1)}%</span></div></button><div class="rel-review"><button data-state="confirmed">✓ 确认关系</button><button data-state="dismissed">× 排除</button><button data-state="pending" title="恢复待复核">重置</button><span>${statuses[state]}</span></div>`;card.querySelector('.rel-evidence').onclick=()=>{selected=reviews[r.id]==='dismissed'?-1:i;render();paint();};card.querySelectorAll('[data-state]').forEach(b=>b.onclick=()=>{reviews[r.id]=b.dataset.state;if(selected===i&&b.dataset.state==='dismissed')selected=-1;render();paint();});list.append(card);});
    if(!list.children.length)list.innerHTML=`<p class="empty">${data.relations.length?'此状态下暂无记录。':'当前目标与阈值下未发现关系线索。可检查目标框、调整阈值，或更换图片后重新分析。'}</p>`;
  }
  async function loadBlob(next,name){const token=++generation;const url=URL.createObjectURL(next);try{const im=new Image();await new Promise((res,rej)=>{im.onload=res;im.onerror=()=>rej(Error('无法读取图片，请使用 JPG、PNG 或 WebP'));im.src=url;});if(token!==generation)return;image=im;blob=next;fileName=name;el('rel-file-name').textContent=name;clear();}finally{URL.revokeObjectURL(url);}}
  async function sample(){await loadBlob(await fetch('/assets/relate-'+el('rel-example').value+'.jpg').then(r=>r.blob()),el('rel-example').value+'.jpg');}
  function modelState(){
    const det=detectorModels.find(m=>m.id===el('rel-model').value), rel=relationModels.find(m=>m.id===el('rel-relation-model').value);
    el('rel-detector-state').textContent=det?.pf_installed?'本机 CPU · Prompt-Free 权重已就绪':'本机 CPU · 首次分析自动下载权重';
    el('rel-relation-state').textContent=rel?(rel.description+' · '+(rel.installed?'已下载':'首次分析自动下载')):'模型状态读取中';
    if(rel)el('rel-model-link').href=rel.url;
  }
  async function models(){
    const [det,rel]=await Promise.all([fetch('/api/health').then(r=>r.json()),fetch('/api/relate/models').then(r=>r.json())]);
    detectorModels=det.models;relationModels=rel.models;
    const detValue=el('rel-model').value,relValue=el('rel-relation-model').value;
    el('rel-model').replaceChildren(...detectorModels.map(m=>new Option(m.label+' · Prompt-Free',m.id)));
    el('rel-relation-model').replaceChildren(...relationModels.map(m=>{const option=new Option(m.id+(m.supported?'':' · 暂无官方 ONNX'),m.id);option.disabled=!m.supported;return option;}));
    el('rel-model').value=detValue;el('rel-relation-model').value=relValue;modelState();
  }
  document.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>{if(busy||working){showToast('当前分析完成后再切换工作台');return;}stop();const name=b.dataset.workspace;el('see-view').classList.toggle('hidden',name!=='see');el('relate-view').classList.toggle('hidden',name!=='relate');document.querySelectorAll('[data-workspace]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});});
  document.querySelectorAll('[data-rel-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.relFilter;document.querySelectorAll('[data-rel-filter]').forEach(x=>x.classList.toggle('active',x===b));render();});
  el('rel-related-only').addEventListener('change',paint);
  el('rel-show-all').onclick=()=>{selected=-1;render();paint();};
  el('rel-upload').onclick=()=>el('rel-file').click();
  el('rel-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>20*1024*1024){showToast('图片不能超过 20 MB');return;}try{await loadBlob(f,f.name);}catch(e){showToast(e.message);}};
  el('rel-sample').onclick=()=>sample().catch(e=>showToast(e.message));
  ['rel-model','rel-relation-model'].forEach(id=>el(id).addEventListener('input',()=>{modelState();clear();}));
  el('rel-threshold').addEventListener('input',()=>{
    const threshold=Number(el('rel-threshold').value);
    el('rel-threshold-value').textContent=threshold.toFixed(2);
    if(!data)return;
    const selectedId=data.relations[selected]?.id;
    data.relation_threshold=threshold;
    data.relations=data.relation_candidates.filter(r=>r.score>=threshold).slice(0,data.relation_limit);
    selected=data.relations.findIndex(r=>r.id===selectedId);
    el('rel-count').textContent=data.relations.length;
    el('rel-status').textContent='已即时筛选';
    render();paint();
  });
  el('rel-run').onclick=async()=>{
    if(working||!blob)return;working=true;clear();el('rel-status').textContent='正在分析';el('rel-loading').classList.remove('hidden');
    const controls=document.querySelectorAll('#relate-view input,#relate-view select,#rel-run,#rel-upload,#rel-sample');controls.forEach(x=>x.disabled=true);
    el('rel-progress').textContent='正在准备模型，首次运行可能需要下载权重';
    const poll=setInterval(async()=>{try{const state=await fetch('/api/relate/models').then(r=>r.json());if(working&&state.progress)el('rel-progress').textContent=state.progress;}catch{}},1500);
    try{const form=new FormData();form.append('file',blob,'scene.jpg');form.append('relation_model_id',el('rel-relation-model').value);form.append('threshold',el('rel-threshold').value);form.append('model_id',el('rel-model').value);const response=await fetch('/api/relate',{method:'POST',body:form});const result=await response.json();if(!response.ok)throw Error(result.detail||'分析失败');data=result;data.analyzed_at=new Date().toISOString();data.filename=fileName;selected=-1;el('rel-status').textContent='分析完成';el('rel-objects').textContent=data.detections.length;el('rel-count').textContent=data.relations.length;el('rel-time').textContent=(data.total_ms/1000).toFixed(2);el('rel-result-note').textContent=`关系推理 ${(data.relation_ms/1000).toFixed(2)} s · ${data.objects_truncated?'已截取前 32 个目标 · ':''}本地 CPU`;el('rel-export').disabled=false;el('rel-show-all').disabled=false;render();paint();}
    catch(e){el('rel-status').textContent='分析失败';showToast(e.message);}finally{clearInterval(poll);working=false;el('rel-loading').classList.add('hidden');controls.forEach(x=>x.disabled=false);models().catch(()=>{});}
  };
  el('rel-export').onclick=async()=>{if(!data)return;const zip=new JSZip();zip.file('source-image.'+({'image/png':'png','image/webp':'webp'}[blob.type]||'jpg'),blob);zip.file('evidence.png',await new Promise(r=>canvas.toBlob(r,'image/png')));zip.file('relations.json',JSON.stringify({...data,relation_candidates:data.relation_candidates.map(r=>({...r,review:reviews[r.id]||'pending'})),relations:data.relations.map((r,i)=>({...r,review:reviews[r.id]||'pending'})),related_entities_only:el('rel-related-only').checked,annotation_view:selected<0?'all':'focused',evidence_relation_index:selected<0?null:selected},null,2));zip.file('README.txt','原始图像 source-image.*；当前高亮截图 evidence.png；关系、目标框、模型、阈值、耗时和人工复核状态见 relations.json。坐标为原图像素 XYXY。关系为模型预测，确认仅代表人工确认该关系，不代表违规结论。复核状态只保存在当前页面，刷新前请导出。\n');const url=URL.createObjectURL(await zip.generateAsync({type:'blob'}));const a=document.createElement('a');a.href=url;a.download=`relate-${Date.now()}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('证据包已导出');};
  models().catch(()=>showToast('模型列表读取失败，请检查本地服务'));
  sample().catch(e=>showToast(e.message));
})();
