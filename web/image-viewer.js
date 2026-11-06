(() => {
  const dialog=document.createElement('dialog');
  dialog.className='image-viewer';
  dialog.setAttribute('aria-labelledby','image-viewer-title');
  dialog.innerHTML='<div class="image-viewer-heading"><div><b id="image-viewer-title">放大查看</b><small>当前画面快照 · 保留结果标注</small></div><button type="button" autofocus aria-label="关闭放大窗口">关闭 ×</button></div><canvas aria-label="放大的图像与结果标注"></canvas>';
  document.body.append(dialog);
  const preview=dialog.querySelector('canvas'),ctx=preview.getContext('2d');
  let opener=null;
  document.querySelectorAll('[data-enlarge-canvas]').forEach(button=>{
    button.addEventListener('click',()=>{
      const source=document.getElementById(button.dataset.enlargeCanvas);
      preview.width=source.width;preview.height=source.height;
      ctx.drawImage(source,0,0);
      dialog.querySelector('b').textContent=button.dataset.enlargeTitle+' · 放大查看';
      opener=button;
      dialog.showModal();
    });
  });
  dialog.querySelector('button').addEventListener('click',()=>dialog.close());
  let backdropDown=false;
  const outside=e=>{const r=dialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
  dialog.addEventListener('pointerdown',e=>{backdropDown=e.target===dialog&&outside(e);});
  dialog.addEventListener('click',e=>{if(backdropDown&&e.target===dialog&&outside(e))dialog.close();backdropDown=false;});
  dialog.addEventListener('close',()=>{preview.width=0;preview.height=0;opener?.focus();opener=null;});
})();
