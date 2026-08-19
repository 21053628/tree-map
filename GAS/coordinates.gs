/* =========================================================
 * WGS84 → HK80 座標轉換（同前端 proj4 同一套參數）
 * ========================================================= */
function geo2xyz_(lat, lng, h, a, f){
  const e2 = f*(2-f);
  const sL = Math.sin(lat), cL = Math.cos(lat);
  const sG = Math.sin(lng), cG = Math.cos(lng);
  const N = a/Math.sqrt(1-e2*sL*sL);
  return [(N+h)*cL*cG, (N+h)*cL*sG, (N*(1-e2)+h)*sL];
}

function xyz2geo_(x, y, z, a, f){
  const e2 = f*(2-f);
  const p = Math.sqrt(x*x+y*y);
  let lat = Math.atan2(z, p*(1-e2));
  for(let i=0;i<10;i++){
    const sL = Math.sin(lat);
    const N = a/Math.sqrt(1-e2*sL*sL);
    const nl = Math.atan2(z + e2*N*sL, p);
    if(Math.abs(nl-lat)<1e-13){ lat=nl; break; }
    lat = nl;
  }
  const sL = Math.sin(lat), cL = Math.cos(lat);
  const N = a/Math.sqrt(1-e2*sL*sL);
  const h = p/cL - N;
  return [lat, Math.atan2(y,x), h];
}

function wgs84ToHk80_(latDeg, lngDeg){
  if(latDeg===''||lngDeg===''||latDeg==null||lngDeg==null||isNaN(+latDeg)||isNaN(+lngDeg)) return null;
  const lat = deg2rad_(+latDeg), lng = deg2rad_(+lngDeg);
  const xyz = geo2xyz_(lat, lng, 0, WGS_A_, WGS_F_);
  const x=xyz[0], y=xyz[1], z=xyz[2];
  const dx=162.619, dy=276.959, dz=161.764;
  const rx=-0.067753*ARC_, ry=2.243649*ARC_, rz=1.158827*ARC_;
  const s=1+1.094246/1e6;
  const X = dx + s*(x + rz*y - ry*z);
  const Y = dy + s*(-rz*x + y + rx*z);
  const Z = dz + s*(ry*x - rx*y + z);
  const g = xyz2geo_(X, Y, Z, INTL_A_, INTL_F_);
  const lat0 = deg2rad_(22.31213333333334), lon0 = deg2rad_(114.1785555555556);
  const k0=1, x0=836694.05, y0=819069.8;
  const a=INTL_A_, f=INTL_F_;
  const e2=f*(2-f), ep2=e2/(1-e2);
  const L=g[0], P=g[1];
  const sL=Math.sin(L), cL=Math.cos(L), tL=Math.tan(L);
  const N=a/Math.sqrt(1-e2*sL*sL);
  const Tt=tL*tL, C=ep2*cL*cL, A=(P-lon0)*cL;
  const e4=e2*e2, e6=e4*e2;
  const M=a*((1-e2/4-3*e4/64-5*e6/256)*L-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*L)+(15*e4/256+45*e6/1024)*Math.sin(4*L)-(35*e6/3072)*Math.sin(6*L));
  const M0=a*((1-e2/4-3*e4/64-5*e6/256)*lat0-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*lat0)+(15*e4/256+45*e6/1024)*Math.sin(4*lat0)-(35*e6/3072)*Math.sin(6*lat0));
  const E = k0*N*(A+(1-Tt+C)*A*A*A/6+(5-18*Tt+Tt*Tt+72*C-58*ep2)*A*A*A*A*A/120)+x0;
  const Nn = k0*(M-M0+N*tL*(A*A/2+(5-Tt+9*C+4*C*C)*A*A*A*A/24+(61-58*Tt+Tt*Tt+600*C-330*ep2)*A*A*A*A*A*A/720))+y0;
  return { N: Math.round(Nn*10)/10, E: Math.round(E*10)/10 };
}
/* =========================================================
 * HK80 → WGS84 反向轉換（測量師現場記 HK80 用）
 * ========================================================= */
function hk80ToGeo_(E, N){
  const a=INTL_A_, f=INTL_F_;
  const e2=f*(2-f), ep2=e2/(1-e2);
  const k0=1, x0=836694.05, y0=819069.8;
  const lat0=deg2rad_(22.31213333333334), lon0=deg2rad_(114.1785555555556);
  const M=(N-y0)/k0;
  const e4=e2*e2, e6=e4*e2;
  const mu=M/(a*(1-e2/4-3*e4/64-5*e6/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const e12=e1*e1, e13=e12*e1, e14=e13*e1;
  const phi1=mu+(3*e1/2-27*e13/32)*Math.sin(2*mu)+(21*e12/16-55*e14/32)*Math.sin(4*mu)
            +(151*e13/96)*Math.sin(6*mu)+(1097*e14/512)*Math.sin(8*mu);
  const sL=Math.sin(phi1), cL=Math.cos(phi1), tL=Math.tan(phi1);
  const N1=a/Math.sqrt(1-e2*sL*sL);
  const T1=tL*tL, C1=ep2*cL*cL;
  const R1=a*(1-e2)/Math.pow(1-e2*sL*sL,1.5);
  const D=(E-x0)/(k0*N1);
  const D2=D*D, D3=D2*D, D4=D3*D, D5=D4*D, D6=D5*D;
  const lat=phi1-(N1*tL/R1)*(D2/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D4/24
            +(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D6/720);
  const lng=lon0+(D-(1+2*T1+C1)*D3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D5/120)/cL;
  return [lat, lng];
}

function hk80ToWgs84_(Nn, Ee){
  if(Nn===''||Ee===''||Nn==null||Ee==null||isNaN(+Nn)||isNaN(+Ee)) return null;
  const g=hk80ToGeo_(+Ee, +Nn);
  const xyz=geo2xyz_(g[0], g[1], 0, INTL_A_, INTL_F_);
  const dx=162.619, dy=276.959, dz=161.764;
  const rx=-0.067753*ARC_, ry=2.243649*ARC_, rz=1.158827*ARC_;
  const s=1+1.094246/1e6;
  const x1=(xyz[0]-dx)/s, y1=(xyz[1]-dy)/s, z1=(xyz[2]-dz)/s;
  const xw=x1-rz*y1+ry*z1;
  const yw=rz*x1+y1-rx*z1;
  const zw=-ry*x1+rx*y1+z1;
  const geo=xyz2geo_(xw, yw, zw, WGS_A_, WGS_F_);
  return { lat: rad2deg_(geo[0]), lng: rad2deg_(geo[1]) };
}