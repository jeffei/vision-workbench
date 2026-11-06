const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function page(){
 const elements={};
 function element(){return {value:'',textContent:'',innerHTML:'',getContext:()=>({}),classList:{add(){},remove(){},toggle(){}},appendChild(){},querySelector:()=>element()};}
 const context=vm.createContext({document:{getElementById:id=>elements[id]||(elements[id]=element()),createElement:element},window:{addEventListener(){}},fetch(){throw Error('Slider must not make network requests');}});
 vm.runInContext(fs.readFileSync('web/app.js','utf8'),context);vm.runInContext('paint=()=>{}',context);
 elements.confidence={value:'.25'};
 context.response={threshold:.05,prompt_mode:'text',classes:['person'],detections:[.1,.25,.7,.95].map(confidence=>({class_id:0,label:'person',confidence,box:[0,0,10,10]}))};
 return {context,elements,run:code=>vm.runInContext(code,context),read:code=>JSON.parse(vm.runInContext(`JSON.stringify(${code})`,context))};
}
test('slider filters both directions without inference, loss of candidates, or extra frame count',()=>{
 const p=page();p.run('renderDetections(response)');assert.equal(p.read('result.detections.length'),3);
 for(const [threshold,count] of [['.95',1],['.05',4],['.7',2],['.25',3]]){
  p.elements.confidence.value=threshold;p.run('updateConfidence()');
  assert.equal(p.read('result.detections.length'),count);
  assert.equal(p.read('frames'),1);assert.equal(p.read('detectionCandidates.detections.length'),4);
  assert.equal(Number(p.elements.count.textContent),count);
 }
 assert.equal(p.read('result.threshold'),.25);assert.equal(p.read('result.inference_threshold'),.05);
});
test('exports filter all stored frames at the current slider threshold without destroying candidates',()=>{
 const p=page();p.run("recordTraining({},response)");p.elements.confidence.value='.7';
 assert.equal(p.read('Array.from(trainingFrames.values(),filterDetections)[0].detections.length'),2);
 assert.equal(p.read('trainingFrames.get(0).detections.length'),4);
 p.elements.confidence.value='.05';assert.equal(p.read('Array.from(trainingFrames.values(),filterDetections)[0].detections.length'),4);
});
test('empty results and reset do not resurrect an old image; late response uses current slider value',()=>{
 const p=page();p.elements.confidence.value='.95';p.run('renderDetections(response)');assert.equal(p.read('result.detections.length'),1);
 p.run('clearResults();updateConfidence()');assert.equal(p.read('result'),null);assert.equal(p.read('detectionCandidates'),null);
 p.run('renderDetections({...response,detections:[]});updateConfidence()');assert.equal(p.read('result.detections.length'),0);
});
