const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function ui(){
 const elements={},draws=[],canceled=[];let next=0;
 const context2d=()=>({clearRect(){},drawImage(image){draws.push(image);},save(){},restore(){},fillRect(){},beginPath(){},arc(){},fill(){},stroke(){},strokeRect(){}});
 function element(){return {value:'',style:{},classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},append(){},replaceChildren(){},getContext:context2d,getBoundingClientRect:()=>({width:800,height:600})};}
 const ctx=vm.createContext({document:{getElementById:id=>elements[id]||(elements[id]=element()),createElement:element},window:{},performance:{now:()=>100},requestAnimationFrame:()=>++next,cancelAnimationFrame:id=>canceled.push(id),setTimeout,clearTimeout});
 let source=fs.readFileSync('web/segment.js','utf8');source=source.slice(0,source.indexOf("  window.addEventListener('resize'"))+` globalThis.api={set(value){data=value;image={};maskImages=value.masks.map(m=>({id:m.id}));canvas.width=800;canvas.height=600;selected=-1;composeMasks();},paint,selectMask,clearResult,exportState};})();`;
 vm.runInContext(source,ctx);elements.opacity.value='.45';
 return {api:ctx.api,elements,draws,canceled};
}
test('automatic overview composites all masks largest first; no export until selection',()=>{
 const u=ui();u.api.set({mode:'auto',masks:[{id:1,area:10,score:.9},{id:2,area:100,score:.8}]});
 assert.deepEqual(u.draws.map(d=>d.id),[2,1]);u.api.exportState();assert.equal(u.elements['export-mask'].disabled,true);
 u.draws.length=0;u.api.paint();assert.equal(u.draws.length,2); // original + all-mask composite
 u.api.selectMask(0);assert.equal(u.elements['export-mask'].disabled,false);
 u.api.clearResult();assert.equal(u.canceled.length,1);assert.equal(u.elements['export-mask'].disabled,true);
});
test('switching highlighted masks cancels the previous animation',()=>{
 const u=ui();u.api.set({mode:'auto',masks:[{id:1,area:10,score:.9},{id:2,area:100,score:.8}]});
 u.api.selectMask(0);u.api.selectMask(1);assert.equal(u.canceled.length,1);
 u.api.clearResult();assert.equal(u.canceled.length,2);
});
