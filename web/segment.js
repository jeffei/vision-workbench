(() => {
  const $=id=>document.getElementById(id), canvas=$('sam-canvas'), ctx=canvas.getContext('2d');
  let image=null,blob=null,points=[],labels=[],box=null,history=[],draft=null,start=null,pointer=null;
  let data=null,selected=-1,maskImages=[],busy=false,loadVersion=0,toastTimer;
  const colors=[[80,229,194],[88,189,255],[211,154,255],[245,207,112],[250,134,162],[155,222,115]];
  let allMasks=null,highlight=null,animation=null,pulseStart=0;
  function stopPulse(){if(animation!==null)cancelAnimationFrame(animation);animation=null;pulseStart=0;}
  function pulse(){stopPulse();pulseStart=performance.now();function tick(now){paint(now);if(now-pulseStart<4800)animation=requestAnimationFrame(tick);else{stopPulse();paint();}}animation=requestAnimationFrame(tick);}
  function composeMasks(){allMasks=document.createElement('canvas');allMasks.width=canvas.width;allMasks.height=canvas.height;const c=allMasks.getContext('2d');data.masks.map((m,i)=>({m,i})).sort((a,b)=>b.m.area-a.m.area).forEach(({i})=>c.drawImage(maskImages[i],0,0));}
  function selectMask(i){selected=i;highlight=document.createElement('canvas');highlight.width=canvas.width;highlight.height=canvas.height;const c=highlight.getContext('2d');c.drawImage(maskImages[i],0,0);c.globalCompositeOperation='source-in';c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);render();exportState();pulse();}
  function toast(text){$('toast').textContent=text;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3500);}
  function lock(value){busy=value;document.querySelectorAll('#segment-view button,#sam-mode,#sam-model,#sam-tool,#sam-file,#sam-example').forEach(e=>e.disabled=value);$('sam-loading').classList.toggle('hidden',!value);$('sam-tool').disabled=value||$('sam-mode').value==='auto';exportState();}
  function exportState(){for(const id of ['export-mask','export-cutout','export-json'])$(id).disabled=busy||!data?.masks.length||selected<0;}
  function clearResult(){stopPulse();data=null;selected=-1;maskImages=[];allMasks=null;highlight=null;$('mask-list').innerHTML='<p class="empty">分割完成后选择候选掩膜</p>';$('mask-count').textContent='—';$('elapsed').textContent='—';$('status').textContent='待分割';exportState();}
  function update(){ $('prompt-count').textContent=`${points.length} 个点 · ${box?'已框选':'无框选'}`;paint(); }
  function remember(){history.push({points:points.map(p=>p.slice()),labels:[...labels],box:box?.slice()||null});}
  function paint(now=performance.now()){
    if(!image)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
    const overlay=data?.mode==='auto'?allMasks:maskImages[selected];
    if(overlay){ctx.save();ctx.globalAlpha=Number($('opacity').value);ctx.drawImage(overlay,0,0);ctx.restore();}
    if(pulseStart&&highlight){ctx.save();ctx.globalAlpha=0.2+0.5*(0.5-0.5*Math.cos((now-pulseStart)*Math.PI/800));ctx.drawImage(highlight,0,0);ctx.restore();}
    const rect=canvas.getBoundingClientRect(), scale=Math.min(rect.width/canvas.width,rect.height/canvas.height)||1;
    points.forEach((p,i)=>{ctx.beginPath();ctx.arc(p[0],p[1],5/scale,0,Math.PI*2);ctx.fillStyle=labels[i]?'#50e5c2':'#ff739a';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5/scale;ctx.stroke();});
    const b=draft||box;if(b){ctx.strokeStyle='#ffd47a';ctx.lineWidth=2/scale;ctx.strokeRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);}
  }
  function position(e,clamp=false){const r=canvas.getBoundingClientRect(),s=Math.min(r.width/canvas.width,r.height/canvas.height);let x=(e.clientX-r.left-(r.width-canvas.width*s)/2)/s,y=(e.clientY-r.top-(r.height-canvas.height*s)/2)/s;if(!clamp&&(x<0||y<0||x>=canvas.width||y>=canvas.height))return null;return [Math.max(0,Math.min(canvas.width-1,x)),Math.max(0,Math.min(canvas.height-1,y))];}
  canvas.addEventListener('pointerdown',e=>{
    if(busy||!image||$('sam-mode').value==='auto'||pointer!==null||e.button!==0)return;
    const p=position(e);if(!p)return;
    if($('sam-tool').value==='box'){start=p;draft=[...p,...p];pointer=e.pointerId;canvas.setPointerCapture(pointer);}
    else{if(points.length>=64){toast('最多添加 64 个提示点');return;}remember();points.push(p);labels.push($('sam-tool').value==='positive'?1:0);clearResult();update();}
  });
  canvas.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;const p=position(e,true);draft=[Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.max(start[0],p[0]),Math.max(start[1],p[1])];paint();});
  function release(e){if(e.pointerId!==pointer)return;if(e.type!=='pointercancel'&&draft[2]-draft[0]>2&&draft[3]-draft[1]>2){remember();box=draft;clearResult();}draft=null;start=null;pointer=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);update();}
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  async function load(file,name){
    if(busy)return;const version=++loadVersion;const url=URL.createObjectURL(file);const next=new Image();
    try{await new Promise((resolve,reject)=>{next.onload=resolve;next.onerror=()=>reject(Error('无法读取图片'));next.src=url;});if(version!==loadVersion)return;
      const s=Math.min(1,1600/Math.max(next.naturalWidth,next.naturalHeight));const input=document.createElement('canvas');input.width=Math.round(next.naturalWidth*s);input.height=Math.round(next.naturalHeight*s);input.getContext('2d').drawImage(next,0,0,input.width,input.height);
      const converted=await new Promise(r=>input.toBlob(r,'image/png'));if(version!==loadVersion)return;
      image=input;blob=converted;canvas.width=input.width;canvas.height=input.height;points=[];labels=[];box=null;history=[];clearResult();$('file-name').textContent=name;$('size').textContent=`${input.width} × ${input.height}`;update();if(s<1)toast('图片已等比缩小至最长边 1600 像素，导出使用此尺寸');
    }finally{URL.revokeObjectURL(url);}
  }
  async function status(){try{const r=await fetch('/api/segment/status');if(!r.ok)throw Error();const s=await r.json();$('connection').textContent='已连接';const m=s.models?.find(m=>m.id===$('sam-model').value);$('model-state').textContent=m?(m.ready?'权重已就绪 · 本机 CPU':m.note):(s.installed?'权重已就绪 · 本机 CPU':'请先运行 setup-segment.command');if(s.progress)$('progress').textContent=s.progress;}catch{$('connection').textContent='服务未连接';$('model-state').textContent='请启动或重启本地服务';}}
  async function maskCanvas(record,index){const im=new Image();await new Promise((res,rej)=>{im.onload=res;im.onerror=rej;im.src='data:image/png;base64,'+record.png;});const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const x=c.getContext('2d');x.drawImage(im,0,0);const pixels=x.getImageData(0,0,c.width,c.height);for(let i=0;i<pixels.data.length;i+=4){const a=pixels.data[i];const color=colors[index%colors.length];pixels.data[i]=color[0];pixels.data[i+1]=color[1];pixels.data[i+2]=color[2];pixels.data[i+3]=a;}x.putImageData(pixels,0,0);return c;}
  function render(){const list=$('mask-list');list.replaceChildren();data.masks.forEach((m,i)=>{const b=document.createElement('button');b.className='mask-card'+(i===selected?' active':'');b.style.borderLeftColor=`rgb(${colors[i%colors.length].join(',')})`;b.setAttribute('aria-pressed',String(i===selected));const title=document.createElement('strong');title.textContent=`掩膜 ${m.id} · ${i===selected?'当前选择':'点击查看'}`;const detail=document.createElement('small');detail.textContent=`估计 IoU ${m.score.toFixed(3)} · 区域占比 ${(m.area/(data.width*data.height)*100).toFixed(1)}%`;b.append(title,detail);b.onclick=()=>selectMask(i);list.append(b);});if(!data.masks.length)list.innerHTML='<p class="empty">未得到有效掩膜，请调整提示后重试</p>';}
  $('sam-run').onclick=async()=>{
    if(!blob){toast('请先导入图片');return;}const mode=$('sam-mode').value;if(mode==='prompt'&&!points.length&&!box){toast('请先添加提示点或框选区域');return;}
    clearResult();lock(true);$('status').textContent='正在分割';$('progress').textContent='正在准备模型与图像编码';const polling=setInterval(status,2000);
    try{const form=new FormData();form.append('file',blob,'input.png');form.append('mode',mode);form.append('model_id',$('sam-model').value);form.append('prompts',JSON.stringify({points,labels,box}));const response=await fetch('/api/segment',{method:'POST',body:form});const result=await response.json();if(!response.ok)throw Error(result.detail||'分割失败');const previews=await Promise.all(result.masks.map(maskCanvas));data=result;maskImages=previews;selected=mode==='auto'?-1:0;composeMasks();render();paint();$('mask-count').textContent=data.masks.length;$('elapsed').textContent=(data.elapsed_ms/1000).toFixed(1);$('status').textContent='分割完成';if(data.truncated)toast('自动分割结果按质量保留前 40 个区域');}
    catch(e){clearResult();$('status').textContent='分割失败';toast(e.message);}finally{clearInterval(polling);lock(false);status();}
  };
  $('sam-model').onchange=()=>{clearResult();paint();status();};
  $('sam-sample').onclick=()=>sample().catch(e=>toast(e.message));
  $('sam-upload').onclick=()=>$('sam-file').click();$('sam-file').onchange=e=>{const f=e.target.files[0];if(f){if(f.size>20*1024*1024)toast('图片不能超过 20 MB');else load(f,f.name).catch(e=>toast(e.message));}e.target.value='';};
  $('undo').onclick=()=>{const previous=history.pop();if(previous){({points,labels,box}=previous);clearResult();update();}};
  $('clear').onclick=()=>{remember();points=[];labels=[];box=null;clearResult();update();};
  $('sam-mode').onchange=()=>{clearResult();points=[];labels=[];box=null;history=[];const auto=$('sam-mode').value==='auto';$('sam-tool').disabled=auto;$('help').textContent=auto?'自动扫描整张图像生成多个区域。使用稀疏采样以适配 CPU，可能遗漏小目标；显示所有返回的掩膜，点击右侧结果呼吸高亮；最多保留 40 个区域。':'添加前景点或矩形框确定目标，背景点用于排除误选区域。调整提示后重新分割。';update();};
  $('opacity').oninput=()=>{$('opacity-value').textContent=Math.round(Number($('opacity').value)*100)+'%';paint();};
  function download(content,name){const url=URL.createObjectURL(content),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('export-mask').onclick=()=>{const bytes=Uint8Array.from(atob(data.masks[selected].png),c=>c.charCodeAt(0));download(new Blob([bytes],{type:'image/png'}),'sam-mask.png');};
  $('export-cutout').onclick=()=>{const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const x=c.getContext('2d');x.drawImage(image,0,0);x.globalCompositeOperation='destination-in';x.drawImage(maskImages[selected],0,0);c.toBlob(b=>download(b,'sam-cutout.png'),'image/png');};
  $('export-json').onclick=()=>download(new Blob([JSON.stringify({...data,prompts:{points,labels,box},selected_mask:data.masks[selected].id,source:$('file-name').textContent},null,2)],{type:'application/json'}),'sam-annotations.json');
  async function sample(){const version=++loadVersion;const name=$('sam-example').value+'.jpg';const response=await fetch('/assets/sam-'+name);if(!response.ok)throw Error('官方示例加载失败');const b=await response.blob();if(version===loadVersion)await load(b,name);}
  window.addEventListener('resize',()=>paint());window.addEventListener('pagehide',stopPulse);status();sample().catch(e=>toast(e.message));
})();
