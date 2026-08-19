/* ---------- 相片上傳工具（在鎖外執行，縮短佔鎖時間） ---------- */
function uploadPhotoBlob_(folder, base64Str, filename){
  const cleanBase64 = String(base64Str).split(',').pop();
  const blob = Utilities.newBlob(Utilities.base64Decode(cleanBase64), 'image/jpeg', filename);
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
    } catch(err) { console.error('Photo upload failed:', err); }
  });
  return urls;
}

// 單張相片上傳（嚴格模式：失敗即 throw，供 inspection_photo 回報錯誤）
function uploadPhotoStrict_(treeId, photoBase64, index){
  const folder = DriveApp.getFolderById(FOLDER_ID);
  return uploadPhotoBlob_(folder, photoBase64, treeId + '_' + Date.now() + '_' + index + '.jpg');
}