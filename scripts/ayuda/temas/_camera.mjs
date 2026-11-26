// A drawn camera for the help captures: headless Chrome has none, and its built-in fake one is a
// green test pattern. Replaces `getUserMedia`, in the page, with a canvas showing a barcode on a
// light shelf. Run it with `js(CAMERA)` before opening the scanner.
export const CAMERA = `(()=>{const gum=async()=>{const c=document.createElement('canvas');c.width=1080;c.height=1920;const x=c.getContext('2d');
const draw=()=>{x.fillStyle='#d9d4cc';x.fillRect(0,0,1080,1920);x.fillStyle='#fbfaf7';x.fillRect(330,820,420,250);x.fillStyle='#111';
let p=370;const w=[3,1,2,1,4,1,1,3,2,1,1,2,3,1,2,2,1,4,1,1,2,3,1,1,2,1,3,2,1,2,1,1,4,1,2,1,3];for(let i=0;i<w.length;i++){if(i%2===0)x.fillRect(p,840,w[i]*4,160);p+=w[i]*4;}
x.font='30px monospace';x.fillText('7 591234 567894',395,1050);};draw();setInterval(draw,200);
const s=c.captureStream(15);const t=s.getVideoTracks()[0];t.getCapabilities=()=>({torch:true});t.getSettings=()=>({width:1080,height:1920});t.applyConstraints=async()=>{};return s;};
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:gum,enumerateDevices:async()=>[]},configurable:true});return 1})()`;
