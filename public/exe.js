(() => {
'use strict';
const $=id=>document.getElementById(id);
const status=(id,message)=>{$(id).textContent=message;};
const MAX_BYTES=160*1024*1024, MAX_FILES=600;
const allowedRun=/\.(exe|com|bat)$/i;
let readyFiles=[],jsdosBundle=null,dosActive=false,mediaObjectURL=null;
const tabNames=['dos','win','media'];

for (const button of document.querySelectorAll('.tab')) button.addEventListener('click',()=>showTab(button.dataset.target));
function showTab(name){
 for(const n of tabNames){const active=n===name;const tab=$('tab-'+n),panel=$('panel-'+n);tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;panel.hidden=!active;}
}

function safePath(path){
 let p=path.replaceAll('\\','/').replace(/^\/+/, '').replace(/\/+/g,'/');
 const bits=p.split('/').filter(Boolean);
 if(!bits.length||bits.some(x=>x==='.'||x==='..'||/[\x00-\x1f"'<>|:*?]/.test(x))||p.length>200)throw Error('A file contains an unsafe name.');
 return bits.join('/');
}
async function inspectType(bytes){
 const d=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(d.length<2 || d[0]!==0x4d || d[1]!==0x5a) return 'Not a standard MZ executable (may still be a COM/BAT file).';
 if(d.length>=64){const offset=(d[60]|(d[61]<<8)|(d[62]<<16)|(d[63]<<24))>>>0;
   if(offset+6<d.length && d[offset]===0x50 && d[offset+1]===0x45 && d[offset+2]===0 && d[offset+3]===0){
     const m=d[offset+4]|(d[offset+5]<<8);
     return m===0x8664?'Windows 64-bit (PE x64)':m===0x14c?'Windows 32-bit (PE x86)':'Windows PE executable';
   }
   if(offset+2<d.length && d[offset]===0x4e && d[offset+1]===0x45)return 'Windows 16-bit (NE) executable';
 }
 return 'Likely a DOS (MZ) executable';
}
async function loadFiles(files,fromZip=false){
 if(dosActive){status('dosStatus','An emulator session is running. Use Restart emulator to select a new game.');return;}
 status('dosStatus','Reading local files…');
 try{
  const items=[...files];if(!items.length)return;
  if(items.length>MAX_FILES)throw Error('Too many files (limit '+MAX_FILES+').');
  let entries=[];let bundle=null;
  if(items.length===1 && /\.(zip|jsdos)$/i.test(items[0].name) && !fromZip){
    const f=items[0];if(f.size>MAX_BYTES)throw Error('Archive exceeds 160 MB.');
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js','JSZip');
    const archive=await JSZip.loadAsync(f);
    const all=Object.values(archive.files).filter(x=>!x.dir && !x.name.startsWith('__MACOSX/'));
    if(all.length>MAX_FILES)throw Error('Archive contains too many files.');
    if(all.some(x=>safePath(x.name)==='.jsdos/dosbox.conf') || /\.jsdos$/i.test(f.name)){
      bundle=f;entries=[];
    }else{
      let total=0;
      for(const member of all){const p=safePath(member.name);if(p.startsWith('.'))continue;
        const sz=member._data && member._data.uncompressedSize || 0;
        total+=sz;if(total>MAX_BYTES)throw Error('Unpacked archive exceeds 160 MB.');
        entries.push({path:p,bytes:new Uint8Array(await member.async('uint8array'))});
      }
    }
  }else{
    let total=0;
    for(const file of items){const name=safePath(file.webkitRelativePath || file.name);total+=file.size;if(total>MAX_BYTES)throw Error('Files exceed 160 MB.');
      entries.push({path:name,bytes:new Uint8Array(await file.arrayBuffer())});
    }
  }
  if(!bundle && !entries.length)throw Error('No suitable files were found.');
  if(!bundle){
    const executable=entries.filter(x=>allowedRun.test(x.path));
    if(!executable.length)throw Error('No DOS executable (.exe, .com, .bat) found in your files.');
    const sel=$('exeentry');sel.replaceChildren();
    for(const e of executable){const option=document.createElement('option');option.value=e.path;option.textContent=e.path;sel.append(option);}
    const preferred=executable.find(x=>/\.(com|bat)$/i.test(x.path))||executable.find(x=>!/setup|install|uninst|config/i.test(x.path))||executable[0];sel.value=preferred.path;
    $('exeentry').disabled=false;
  }else{
    const sel=$('exeentry');sel.replaceChildren();const o=document.createElement('option');o.value='bundle';o.textContent='Launch packaged .jsdos bundle';sel.append(o);sel.disabled=true;
  }
  readyFiles=entries;jsdosBundle=bundle;$('chosen').hidden=false;
  $('dosfilesummary').textContent=bundle?bundle.name:(entries.length+' file'+(entries.length===1?'':'s'));
  status('dosStatus','Files loaded locally. Select a program and press Run.');
 }catch(e){readyFiles=[];jsdosBundle=null;$('chosen').hidden=true;status('dosStatus','Could not prepare files: '+e.message);}
}
function clearSelection(){readyFiles=[];jsdosBundle=null;$('chosen').hidden=true;$('dosfile').value='';$('dosfolder').value='';status('dosStatus','Selection cleared.');}
$('clearDos').addEventListener('click',clearSelection);
$('dosfile').addEventListener('change',e=>loadFiles(e.target.files));
$('dosfolder').addEventListener('change',e=>loadFiles(e.target.files));
for(const id of ['dosdrop']){
 const area=$(id);
 for(const type of ['dragenter','dragover'])area.addEventListener(type,e=>{e.preventDefault();area.classList.add('dragging');});
 for(const type of ['dragleave','drop'])area.addEventListener(type,e=>{e.preventDefault();area.classList.remove('dragging');});
 area.addEventListener('drop',e=>{if(e.dataTransfer.files.length)loadFiles(e.dataTransfer.files);});
}
function loadScript(url,global){return new Promise((resolve,reject)=>{
 if(window[global])return resolve();const el=document.createElement('script');el.src=url;el.onload=()=>window[global]?resolve():reject(Error('The emulator library did not initialize.'));el.onerror=()=>reject(Error('Cannot load a required library. Check your connection or content blocker.'));document.head.append(el);
});}
function dosboxConfig(path){
 const pieces=path.split('/'),exe=pieces.pop();let cmd='@echo off\nmount c .\nc:\n';
 for(const part of pieces)cmd+='cd "'+part+'"\n';
 return '[sdl]\nfullscreen=false\n[dosbox]\nmemsize=32\n[cpu]\ncore=auto\ncycles=auto\n[autoexec]\n'+cmd+'"'+exe+'"\n';
}
async function launchDos(demo=false){
 if(dosActive){status('dosStatus','An emulator is already running. Click Restart emulator to change games.');return;}
 if(!demo&&!jsdosBundle&&!readyFiles.length){status('dosStatus','First select a DOS program or ZIP.');return;}
 dosActive=true;$('runDos').disabled=$('demo').disabled=true;
 status('dosStatus','Loading js-dos emulator…');
 try{
  if(!demo && !jsdosBundle){
    const selected=readyFiles.find(x=>x.path===$('exeentry').value);
    if(selected && /\.exe$/i.test(selected.path)){
      const format=await inspectType(selected.bytes);
      if(format.startsWith('Windows')){dosActive=false;$('runDos').disabled=$('demo').disabled=false;status('dosStatus',format+' detected. This EXE cannot run in DOSBox. Use the Windows EXE tab.');showTab('win');$('winInfo').textContent='Windows executable detected in the DOS file picker. Use the external Windows emulator for compatible classic Windows programs.';return;}
    }
  }
  await loadScript('https://v8.js-dos.com/latest/js-dos.js','Dos');
  const opts=demo?{url:'https://v8.js-dos.com/bundles/digger.jsdos'}:jsdosBundle?{url:URL.createObjectURL(jsdosBundle)}:{
    dosboxConf:dosboxConfig($('exeentry').value),
    initFs:readyFiles.map(x=>({path:x.path,contents:x.bytes})),
  };
  opts.onEvent=(event)=>{
    if(event==='ci-ready')status('dosStatus','DOS engine ready. If a game needs other data files, load its complete folder or ZIP.');
    if(event==='error')status('dosStatus','Emulator reported an error. Check the browser console for details.');
  };
  const screen=$('dosScreen');screen.replaceChildren();
  window.Dos(screen,opts);
  status('dosStatus',demo?'Starting Digger demo…':'Starting '+(jsdosBundle?jsdosBundle.name:$('exeentry').value)+'…');
 }catch(e){dosActive=false;$('runDos').disabled=$('demo').disabled=false;status('dosStatus','Emulator could not start: '+e.message);}
}
$('demo').addEventListener('click',()=>launchDos(true));
$('runDos').addEventListener('click',()=>launchDos(false));
$('reset').addEventListener('click',()=>location.reload());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('screenShell').requestFullscreen();}catch(e){status('dosStatus','Fullscreen unavailable: '+e.message);}});
$('winfile').addEventListener('change',async e=>{
 const f=e.target.files?.[0];if(!f)return;
 try{const bytes=new Uint8Array(await f.slice(0,1024*1024).arrayBuffer());const type=await inspectType(bytes);
   $('winInfo').textContent=f.name+' · '+type+'. For compatible classic Windows files, click Open Windows EXE emulator and choose the file again there. Modern VLC may not run.';
 }catch(e){$('winInfo').textContent='Could not inspect file: '+e.message;}
});
$('mediafile').addEventListener('change',e=>loadMedia(e.target.files?.[0]));
function loadMedia(file){if(!file)return;
 if(mediaObjectURL){URL.revokeObjectURL(mediaObjectURL);mediaObjectURL=null;}
 $('video').pause();$('audio').pause();$('video').hidden=$('audio').hidden=true;
 const isAudio=file.type.startsWith('audio/')||/\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i.test(file.name);
 const player=$(isAudio?'audio':'video');mediaObjectURL=URL.createObjectURL(file);player.src=mediaObjectURL;player.hidden=false;$('mediaPlaceholder').hidden=true;
 status('mediaStatus','Loaded '+file.name+'. Press Play. Playback depends on browser codec support.');
 player.oncanplay=()=>status('mediaStatus','Ready to play '+file.name+' · file stays on your device.');
 player.onerror=()=>status('mediaStatus','Your browser may not support the codec used by '+file.name+'. Try MP4/H.264, WebM or MP3.');
 player.load();
}
window.addEventListener('pagehide',()=>{if(mediaObjectURL)URL.revokeObjectURL(mediaObjectURL);});
})();
