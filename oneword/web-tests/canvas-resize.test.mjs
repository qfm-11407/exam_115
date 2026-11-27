import test from 'node:test';
import assert from 'node:assert/strict';
import {InkPad} from '../canvas.js';

test('resizing a student pad preserves strokes, maps the new display bounds, and exports a square 512px image',()=>{
 let box={left:10,top:20,width:256,height:256};const events={};
 const ctx={clearRect(){},beginPath(){},moveTo(){},lineTo(){},arc(){},fill(){},stroke(){},fillRect(){},drawImage(){}};
 const canvas={width:512,height:512,getContext:()=>ctx,getBoundingClientRect:()=>box,addEventListener:(type,fn)=>events[type]=fn,setPointerCapture(){}};
 const pad=new InkPad(canvas);pad.enabled=true;
 const event=(x,y)=>({pointerType:'pen',pointerId:1,clientX:x,clientY:y,preventDefault(){}});
 events.pointerdown(event(138,148));events.pointerup({pointerId:1});
 assert.deepEqual(pad.strokes[0].points,[{x:256,y:256}]);
 box={left:20,top:10,width:512,height:512};
 events.pointerdown(event(276,266));events.pointerup({pointerId:1});
 assert.equal(pad.strokes.length,2);assert.deepEqual(pad.strokes[1].points,[{x:256,y:256}]);
 assert.equal(canvas.width,512);assert.equal(canvas.height,512);
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');const out={getContext:()=>ctx,toDataURL:type=>type};
 try{globalThis.document={createElement:()=>out};assert.equal(pad.export(),'image/png');assert.equal(out.width,512);assert.equal(out.height,512);}finally{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}
});
