/* ---------- 只記日期工具 ---------- */
function dateOnly_(){
  const tz = Session.getScriptTimeZone() || 'Asia/Hong_Kong';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function deg2rad_(d){ return d*Math.PI/180; }
function rad2deg_(r){ return r*180/Math.PI; }

function json_(o){
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}