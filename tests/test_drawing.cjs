const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function drawing(){
  const context = vm.createContext({document:{getElementById:()=>({getContext:()=>({})}),createElement:()=>({})},window:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync('web/app.js','utf8'),context);
  vm.runInContext("promptMode='visual'; drawingTool='shape'; referenceImage={}; paintReference=()=>{}; updateRegions=()=>{}",context);
  const handlers={};
  const el={width:800,height:400,getBoundingClientRect:()=>({left:0,top:0,width:400,height:300}),addEventListener:(type,fn)=>handlers[type]=fn,setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};
  context.el=el;vm.runInContext('setupDrawing(el)',context);
  const event=(type,x,y,detail=1)=>handlers[type]({type,clientX:x,clientY:y,button:0,pointerId:1,detail});
  const click=(x,y,detail=1)=>{event('pointerdown',x,y,detail);event('pointerup',x,y,detail);};
  const value=code=>JSON.parse(vm.runInContext(`JSON.stringify(${code})`,context));
  return {context,event,click,value};
}
test('four-vertex polygon closes at origin and remains editable in letterboxed canvas',()=>{
  const d=drawing();
  d.click(100,10);assert.equal(d.value('draft'),null);
  [[50,100],[200,100],[200,200],[50,200],[50,100]].forEach(p=>d.click(...p));
  assert.deepEqual(d.value('regions'),[[[100,100],[400,100],[400,300],[100,300]]]);
  d.event('pointerdown',50,100);d.event('pointermove',75,125);d.event('pointerup',75,125);
  assert.deepEqual(d.value('regions[0][0]'),[150,150]);
  assert.equal(d.value('regions.length'),1);
  const calls=[];d.context.pen=new Proxy({}, {get:(_,key)=> (...args)=>calls.push([key,...args]),set:()=>true});
  vm.runInContext('drawRegions(pen,800)',d.context);
  assert.equal(calls.filter(c=>c[0]==='strokeRect').length,0);
  assert.equal(calls.filter(c=>c[0]==='arc').length,4);
});
test('double-click closes without duplicate terminal vertex',()=>{
  const d=drawing();[[50,100],[200,100],[200,200]].forEach(p=>d.click(...p));
  d.click(200,200,2);d.event('dblclick',200,200);
  assert.equal(d.value('regions[0].length'),3);assert.equal(d.value('draft'),null);
});
test('box pointer capture clamps outside coordinates and cancel discards draft',()=>{
  const d=drawing();vm.runInContext("drawingTool='box'",d.context);
  d.event('pointerdown',50,100);d.event('pointermove',500,400);d.event('pointerup',500,400);
  assert.deepEqual(d.value('regions'),[[100,100,800,400]]);
  d.event('pointerdown',50,100);d.event('pointermove',100,150);d.event('pointercancel',100,150);
  assert.equal(d.value('regions.length'),1);assert.equal(d.value('draft'),null);
});
test('press-drag draws a continuous contour and releasing closes it for vertex editing',()=>{
  const d=drawing();
  d.event('pointerdown',50,100);
  [[100,90],[180,110],[200,180],[120,210],[50,180]].forEach(p=>d.event('pointermove',...p));
  assert.equal(d.value('draft.length'),6);
  d.event('pointerup',48,150);
  assert.equal(d.value('draft'),null);
  assert.equal(d.value('regions.length'),1);
  assert.deepEqual(d.value('regions[0].at(-1)'),[100,260]); // Closing-edge sample is redundant.
  d.event('pointerdown',50,100);d.event('pointermove',60,90);d.event('pointerup',60,90);
  assert.deepEqual(d.value('regions[0][0]'),[120,80]);
  assert.equal(d.value('regions.length'),1);
});
test('cancelled freehand stroke is discarded and tiny pointer jitter does not add vertices',()=>{
  const d=drawing();d.event('pointerdown',50,100);d.event('pointermove',51,101);
  assert.equal(d.value('draft.length'),1);
  d.event('pointermove',150,100);d.event('pointermove',150,200);d.event('pointercancel',150,200);
  assert.equal(d.value('draft'),null);assert.equal(d.value('regions.length'),0);
});

test('dense freehand rectangle becomes four corners on release',()=>{
  const d=drawing();d.event('pointerdown',50,100);
  for(let x=60;x<=200;x+=10)d.event('pointermove',x,100);
  for(let y=110;y<=200;y+=10)d.event('pointermove',200,y);
  for(let x=190;x>=50;x-=10)d.event('pointermove',x,200);
  for(let y=190;y>=100;y-=10)d.event('pointermove',50,y);
  assert.ok(d.value('draft.length')>40);
  d.event('pointerup',50,100);
  assert.deepEqual(d.value('regions[0]'),[[100,100],[400,100],[400,300],[100,300]]);
});
test('round contours lose dense samples while concave corners and tiny polygons survive',()=>{
  const d=drawing();
  d.context.circle=Array.from({length:121},(_,i)=>[200+100*Math.cos(i*Math.PI/60),200+100*Math.sin(i*Math.PI/60)]);
  const circle=d.value('simplifyContour(circle,8)');
  assert.ok(circle.length>=6&&circle.length<=12);
  assert.deepEqual(d.value('simplifyContour([[0,0],[50,0],[100,0],[100,100],[50,40],[0,100]],8)'),[[0,0],[100,0],[100,100],[50,40],[0,100]]);
  assert.equal(d.value('simplifyContour([[0,0],[1,0],[1,1],[0,1]],8).length'),3);
});
test('visual name updates results and captured frames without changing other prompt modes',()=>{
  const d=drawing();
  d.context.nameInput={value:'  行人  '};
  vm.runInContext("document.getElementById=id=>id==='visual-label'?nameInput:{}; renderDetections=(data,count)=>{applyVisualLabel(data);if(count!==false)throw Error('rename must not increment frames');}; result={prompt_mode:'visual',classes:['object0'],detections:[{label:'object0',class_id:0}]}; trainingFrames.set(0,{mode:'visual',detections:[{label:'object0',class_id:0}]});updateVisualLabel()",d.context);
  assert.deepEqual(d.value('result.classes'),['行人']);
  assert.equal(d.value('result.detections[0].label'),'行人');
  assert.equal(d.value('trainingFrames.get(0).detections[0].label'),'行人');
  assert.deepEqual(d.value('trainingNames'),['行人']);
  vm.runInContext("nameInput.value=' ';updateVisualLabel()",d.context);
  assert.equal(d.value('result.detections[0].label'),'object0');
  vm.runInContext("const textResult={prompt_mode:'text',classes:['bus'],detections:[{label:'bus'}]};applyVisualLabel(textResult)",d.context);
  assert.equal(d.value('textResult.detections[0].label'),'bus');
});
test('YOLO and COCO exports use the same visual name as detection results',async()=>{
  const d=drawing();
  d.context.JSZip=require('../web/vendor/jszip.min.js');
  vm.runInContext(fs.readFileSync('web/training.js','utf8'),d.context);
  d.context.exportFrames=[{image:{arrayBuffer:async()=>new ArrayBuffer(0)},width:100,height:100,mode:'visual',detections:[{class_id:0,label:'行人',box:[10,10,50,50]}]}];
  for(const format of ['yolo','coco']){
    const blob=await vm.runInContext(`buildTrainingZip('${format}',exportFrames,['行人'],'')`,d.context);
    const zip=await d.context.JSZip.loadAsync(await blob.arrayBuffer());
    if(format==='yolo')assert.match(await zip.file('data.yaml').async('string'),/行人/);
    else assert.equal(JSON.parse(await zip.file('annotations/instances_train.json').async('string')).categories[0].name,'行人');
  }
});

test('painting the main view paints the reference even before any detections exist',()=>{
  const d=drawing();d.context.referencePaints=0;
  vm.runInContext('paintReference=()=>referencePaints++;source=null;paint()',d.context);
  assert.equal(d.context.referencePaints,1);
});
test('reference preview renders the current image immediately and centers import control when empty',()=>{
  const d=drawing();const elements={};let imageDraws=0;
  for(const id of ['reference-preview','upload-reference','enlarge-reference','ref-thumb','ref-editor','ref-dialog']){
    elements[id]={id,classList:{toggle(name,value){this[name]=value;}},getContext:()=>({clearRect(){},drawImage(){imageDraws++;}})};
  }
  d.context.elements=elements;
  // Restore the real renderer overridden by the drawing fixture.
  const source=fs.readFileSync('web/app.js','utf8');
  vm.runInContext(source.slice(source.indexOf('function paintReference(){'),source.indexOf('function drawRegions(')),d.context);
  vm.runInContext("document.getElementById=id=>elements[id];drawRegions=()=>{};referenceImage={naturalWidth:800,naturalHeight:400};referenceExternal=false;paintReference()",d.context);
  assert.equal(imageDraws,1);assert.equal(elements['upload-reference'].classList.hidden,true);
  assert.equal(elements['ref-thumb'].width,800);
  vm.runInContext('referenceExternal=true;referenceImage=null;paintReference()',d.context);
  assert.equal(elements['upload-reference'].classList.hidden,false);
  assert.equal(elements['upload-reference'].textContent,'选择参考图片');
  assert.equal(elements['reference-preview'].classList['has-image'],false);
  assert.equal(elements['enlarge-reference'].disabled,true);
});
