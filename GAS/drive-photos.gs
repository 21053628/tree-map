/* ---------- 相片上傳工具（在鎖外執行，縮短佔鎖時間） ---------- */
function mimeToExt_(mime){ if(mime==='image/png') return 'png'; if(mime==='image/webp') return 'webp'; return 'jpg'; }
function extractBase64PayloadForUpload_(s){ const str=String(s||''); const comma=str.indexOf(','); if(str.slice(0,5)==='data:' && comma!==-1) return {prefix:str.slice(0,comma), clean:str.slice(comma+1)}; return {prefix:'', clean:str}; }
function parseImageMimeFromPrefixForUpload_(prefix){ if(!prefix) return ''; const m=prefix.match(/^data:([^;]+);base64$/i); return m?String(m[1]).toLowerCase().trim():''; }
function detectImageMimeFromBytesForUpload_(bytes){ if(!bytes||bytes.length<4) return ''; if(bytes[0]===0xFF&&bytes[1]===0xD8&&bytes[2]===0xFF) return 'image/jpeg'; if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47) return 'image/png'; if(bytes.length>=12&&bytes[0]===0x52&&bytes[1]===0x49&&bytes[2]===0x46&&bytes[3]===0x46&&bytes[8]===0x57&&bytes[9]===0x45&&bytes[10]===0x42&&bytes[11]===0x50) return 'image/webp'; return ''; }
function parseImageForUpload_(base64Str){
  const part=extractBase64PayloadForUpload_(base64Str);
  const declaredMime=parseImageMimeFromPrefixForUpload_(part.prefix);
  const allowed=(typeof ALLOWED_IMAGE_MIME_SET_!=='undefined')?ALLOWED_IMAGE_MIME_SET_:{'image/jpeg':true,'image/png':true,'image/webp':true};
  const maxBytes=(typeof MAX_IMAGE_BYTES_!=='undefined')?MAX_IMAGE_BYTES_:10*1024*1024;
  const allowedList=(typeof ALLOWED_IMAGE_MIMES_!=='undefined')?ALLOWED_IMAGE_MIMES_:['image/jpeg','image/png','image/webp'];
  if(declaredMime&&!allowed[declaredMime]) throw new Error('UNSUPPORTED_FORMAT:'+declaredMime);
  const clean=String(part.clean||'').replace(/\s/g,'');
  if(!clean) throw new Error('EMPTY');
  if(!/^[A-Za-z0-9+/=]+$/.test(clean)) throw new Error('INVALID_BASE64');
  const bytes=Utilities.base64Decode(clean);
  if(bytes.length>maxBytes) throw new Error('FILE_TOO_LARGE:'+bytes.length);
  if(bytes.length===0) throw new Error('DECODE_EMPTY');
  const sniffed=detectImageMimeFromBytesForUpload_(bytes);
  if(declaredMime&&sniffed&&declaredMime!==sniffed) throw new Error('MIME_MISMATCH:'+declaredMime+'->'+sniffed);
  const effectiveMime=sniffed||declaredMime;
  if(!effectiveMime) throw new Error('UNKNOWN_FORMAT');
  if(!allowed[effectiveMime]) throw new Error('UNSUPPORTED_FORMAT:'+effectiveMime);
  return {bytes:bytes, mime:effectiveMime, ext:mimeToExt_(effectiveMime)};
}
function uploadPhotoBlob_(folder, base64Str, filename){
  const info=parseImageForUpload_(base64Str);
  let finalName=String(filename||'');
  if(/\.jpg$/i.test(finalName) && info.ext!=='jpg') finalName=finalName.replace(/\.jpg$/i, '.'+info.ext);
  else if(!/\.[a-z0-9]+$/i.test(finalName)) finalName=finalName+'.'+info.ext;
  const blob = Utilities.newBlob(info.bytes, info.mime, finalName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w1200';
}

// 多張相片上傳（逐張容錯：單張失敗不影響其他）
function uploadPhotos_(treeId, photoBase64, startIndex){
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const bases = Array.isArray(photoBase64) ? photoBase64 : [photoBase64];
  const urls = [];
  bases.forEach((base64Str, index) => {
    try {
      urls.push(uploadPhotoBlob_(folder, base64Str, treeId + '_' + Date.now() + '_' + (startIndex + index) + '.jpg'));
    } catch(err) { console.error('Photo upload failed:', err.message||err); }
  });
  return urls;
}

// 單張相片上傳（嚴格模式：失敗即 throw，供 inspection_photo 回報錯誤）
function uploadPhotoStrict_(treeId, photoBase64, index){
  const folder = DriveApp.getFolderById(FOLDER_ID);
  return uploadPhotoBlob_(folder, photoBase64, treeId + '_' + Date.now() + '_' + index + '.jpg');
}