
/* ===================== Inicialização do mapa ===================== */
const map = L.map('map', { zoomControl:true }).setView([-22.4955, -48.5715], 13);

// Camadas base
const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'ESRI' }).addTo(map);
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'OpenStreetMap' });

// camada que representa o canal (polyline) — aproximação para demonstração
// sequência de pontos que seguem o leito no trecho Barra Bonita → Jaú (aproximação)
const canalCoords = [
  [-22.4750, -48.5400],
  [-22.4855, -48.5485],
  [-22.4949, -48.5581],
  [-22.5018, -48.5655],
  [-22.5085, -48.5740],
  [-22.5155, -48.5825],
  [-22.5250, -48.5930]
];

const canalLine = L.polyline(canalCoords, { color:'#1e90ff', weight:5, opacity:0.5 }).addTo(map);

/* posição do usuário simulada = centro do mapa */
const userIcon = L.divIcon({ html:'<div style="width:16px;height:16px;border-radius:50%;background:#3aa6ff;border:2px solid #fff"></div>', className:'', iconSize:[16,16] });
let userMarker = L.marker(map.getCenter(), { icon:userIcon }).addTo(map);
map.on('move', ()=> userMarker.setLatLng(map.getCenter()));

/* ===================== dados de boias (aproximações) ===================== */
/* Estas coordenadas iniciais são aproximações; em seguida aplicamos snap para o canal */
let boiasAprox = [
  { id:'BCE-155', nome:'BCE-155', tipo:'BB', estado:'Boa', lat:-22.4945, lng:-48.5578 },
  { id:'BCV-158', nome:'BCV-158', tipo:'EB', estado:'Boa', lat:-22.5010, lng:-48.5658 },
  { id:'BCV-158A', nome:'BCV-158A', tipo:'EB', estado:'Boa', lat:-22.5082, lng:-48.5739 },
  { id:'B-BB-10', nome:'BB-10', tipo:'BB', estado:'Boa', lat:-22.5150, lng:-48.5820 },
  { id:'B-ESP-01', nome:'ESP-01', tipo:'ESP', estado:'Boa', lat:-22.4852, lng:-48.5482 }
];

// carregar relatos do localStorage (mantemos protótipo)
let relatos = JSON.parse(localStorage.getItem('relatos')||'null') || [
  { id:uid(), tipo:'PERIGO', titulo:'Tronco submerso', descricao:'Visível na margem esquerda em baixa vazão', gravidade:'ALTA', lat:-22.5002, lng:-48.5668, status:'ATIVO', confirmacoes:0, atualizadoEm: Date.now() }
];

saveAll();

/* ===================== camadas e ícones ===================== */
const layerBoias = L.layerGroup().addTo(map);
const layerRelatos = L.layerGroup().addTo(map);

function makeDot(color){
  return L.divIcon({ html:`<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.9)"></div>`, className:'', iconSize:[16,16] });
}
const iconBoiaOk = makeDot('#10b981');
const iconBoiaProb = makeDot('#ef4444');
const iconPerigo = makeDot('#f59e0b');

/* ===================== Função: ponto mais próximo em polilinha (snap) =====================
   Implementação simples: para cada segmento [A,B], calcule a projeção do ponto P na
   reta AB, limite ao segmento, calcule distância e selecione o ponto com menor distância.
   Retorna {lat,lng,distMeters}.
*/
function toRad(v){ return v * Math.PI/180; }
function haversine(a,b){
  const R = 6371000; // m
  const dLat = toRad(b[0]-a[0]); const dLon = toRad(b[1]-a[1]);
  const lat1 = toRad(a[0]); const lat2 = toRad(b[0]);
  const sinDLat = Math.sin(dLat/2), sinDLon = Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon), Math.sqrt(1 - (sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon)));
  return R * c;
}

// converte lat/lng em vetor cartesiano aproximado (m) para operações de projeção local
function latLngToXY(lat, lng){
  // projeção equirectangular local (bom para pequenas distâncias)
  const R = 6378137;
  const x = R * toRad(lng) * Math.cos(toRad(lat));
  const y = R * toRad(lat);
  return [x,y];
}
function xyToLatLng(x,y){
  const R = 6378137;
  const lat = (y / R) * 180/Math.PI;
  const lng = (x / (R * Math.cos(toRad(lat)))) * 180/Math.PI;
  return [lat,lng];
}

function nearestPointOnSegment(A, B, P){
  // A,B,P: [lat,lng]
  const aXY = latLngToXY(A[0], A[1]);
  const bXY = latLngToXY(B[0], B[1]);
  const pXY = latLngToXY(P[0], P[1]);
  const AB = [bXY[0]-aXY[0], bXY[1]-aXY[1]];
  const AP = [pXY[0]-aXY[0], pXY[1]-aXY[1]];
  const ab2 = AB[0]*AB[0] + AB[1]*AB[1];
  const dot = AB[0]*AP[0] + AB[1]*AP[1];
  const t = (ab2===0) ? 0 : Math.max(0, Math.min(1, dot/ab2));
  const proj = [ aXY[0] + AB[0]*t, aXY[1] + AB[1]*t ];
  const latlng = xyToLatLng(proj[0], proj[1]);
  return { lat: latlng[0], lng: latlng[1] };
}

function nearestPointOnPolyline(poly, P){
  let best = null;
  let bestDist = Infinity;
  for(let i=0;i<poly.length-1;i++){
    const A = poly[i], B = poly[i+1];
    const np = nearestPointOnSegment(A,B,P);
    const d = haversine([np.lat,np.lng], P);
    if (d < bestDist){ bestDist = d; best = { lat: np.lat, lng: np.lng, dist: d }; }
  }
  return best;
}

/* ===================== Snap das boias para o canal ===================== */
function snapBoiasToCanal(){
  const snapped = boiasAprox.map(b=>{
    const np = nearestPointOnPolyline(canalCoords, [b.lat,b.lng]);
    // se a distância for muito grande (>100 m) mantemos original e marcamos warning
    const used = (np && np.dist < 200) ? { lat: np.lat, lng: np.lng, snapped:true, dist:Math.round(np.dist) } : { lat:b.lat, lng:b.lng, snapped:false, dist:null };
    return Object.assign({}, b, { lat: used.lat, lng: used.lng, snapped:used.snapped, snapDist:used.dist });
  });
  return snapped;
}

/* ===================== Render das camadas ===================== */
let boiaMarkers = new Map();
function renderBoias(){
  layerBoias.clearLayers(); boiaMarkers.clear();
  const snapped = snapBoiasToCanal();
  snapped.forEach(b=>{
    const icon = (b.estado && b.estado.toLowerCase().includes('boa')) ? iconBoiaOk : iconBoiaProb;
    const marker = L.marker([b.lat, b.lng], { icon }).addTo(layerBoias);
    let html = `<div style="min-width:220px"><b>${b.nome}</b><br>Tipo: ${b.tipo} · Estado: ${b.estado || 'Indefinido'}<br>`;
    if (b.snapped) html += `<span class="muted">Snap ao canal: ${b.snapDist} m</span><br>`;
    else html += `<span style="color:#ffd595">Sem snap (distância alta)</span><br>`;
    html += `<div style="margin-top:8px"><button class="btn btn-primary" onclick="openReportFormAt([${b.lat}, ${b.lng}], 'BOIA_DANIFICADA', 'Problema em ${b.nome}')">Reportar problema nesta boia</button></div></div>`;
    marker.bindPopup(html);
    boiaMarkers.set(b.id, marker);
  });
}

function renderRelatos(){
  layerRelatos.clearLayers();
  relatos.forEach(r=>{
    const icon = (r.tipo==='BOIA_DANIFICADA') ? iconBoiaProb : iconPerigo;
    const m = L.marker([r.lat, r.lng], { icon }).addTo(layerRelatos);
    const info = `<div style="min-width:240px"><b>${(r.titulo||labelTipo(r.tipo))}${r.gravidade ? ' · ' + r.gravidade : ''}</b><br>${r.descricao||''}<br><span class="muted">Confirmações: ${r.confirmacoes||0}</span><div class="hr"></div><div style="display:flex;gap:6px"><button class="btn btn-primary" onclick="validarRelato('${r.id}', true)">Sim, continua</button><button class="btn" onclick="validarRelato('${r.id}', false)">Não, resolvido</button></div></div>`;
    m.bindPopup(info);
  });
}

renderBoias();
renderRelatos();

/* ===================== Interação: Mostrar/Ocultar camadas ===================== */
document.getElementById('btnBoias').onclick = function(){
  if (map.hasLayer(layerBoias)){ map.removeLayer(layerBoias); this.classList.remove('btn-primary'); }
  else { map.addLayer(layerBoias); this.classList.add('btn-primary'); }
};
document.getElementById('btnRelatos').onclick = function(){
  if (map.hasLayer(layerRelatos)){ map.removeLayer(layerRelatos); this.classList.remove('btn-primary'); }
  else { map.addLayer(layerRelatos); this.classList.add('btn-primary'); }
};

/* ===================== Modo adição e formulário ===================== */
let addMode = false, selectedLatLng = null;
document.getElementById('btnAdd').onclick = function(){ addMode = true; document.getElementById('formWrap').style.display='block'; toast('Modo adição ativado: clique no mapa para selecionar o local do relato.'); };
document.getElementById('btnCancelar').onclick = function(){ addMode=false; selectedLatLng=null; document.getElementById('formWrap').style.display='none'; document.getElementById('selLatLng').textContent='-'; };
map.on('click', function(e){
  if (!addMode) return;
  selectedLatLng = e.latlng;
  document.getElementById('selLatLng').textContent = selectedLatLng.lat.toFixed(6)+', '+selectedLatLng.lng.toFixed(6);
});
document.getElementById('btnSalvar').onclick = function(){
  if (!selectedLatLng){ toast('Selecione um ponto no mapa primeiro.'); return; }
  const t = document.getElementById('tipo').value;
  const g = document.getElementById('gravidade').value;
  const titulo = document.getElementById('titulo').value.trim();
  const descricao = document.getElementById('descricao').value.trim();
  const novo = { id: uid(), tipo:t, titulo, descricao, gravidade:g, lat:selectedLatLng.lat, lng:selectedLatLng.lng, status:'ATIVO', confirmacoes:0, atualizadoEm:Date.now() };
  relatos.push(novo); saveAll(); renderRelatos(); toast('Relato salvo.'); addMode=false; document.getElementById('formWrap').style.display='none'; document.getElementById('selLatLng').textContent='-';
};

/* botão re-snap (forçar re-alinhamento) */
document.getElementById('btnSnap').onclick = function(){ renderBoias(); toast('Re-snap realizado.'); };

/* ===================== Validação de relatos ===================== */
function validarRelato(id, persiste){
  const idx = relatos.findIndex(r=>r.id===id);
  if (idx===-1) return;
  if (persiste){ relatos[idx].confirmacoes = (relatos[idx].confirmacoes||0) + 1; relatos[idx].atualizadoEm = Date.now(); toast('Confirmação registrada.'); }
  else { relatos.splice(idx,1); toast('Relato marcado como resolvido e removido.'); }
  saveAll(); renderRelatos();
}

function labelTipo(t){ return t==='BOIA_DANIFICADA' ? 'Boia danificada' : t==='PERIGO' ? 'Perigo' : 'Anomalia'; }

/* ===================== Utilitários ===================== */
function uid(){ return 'id-'+Math.random().toString(36).substring(2,10); }
function saveAll(){ localStorage.setItem('relatos', JSON.stringify(relatos)); }

// toast simples
let toastEl = null, toastTimer = null;
function toast(msg){
  if (!toastEl){ toastEl = document.createElement('div'); toastEl.style.position='fixed'; toastEl.style.left='50%'; toastEl.style.bottom='28px'; toastEl.style.transform='translateX(-50%)'; toastEl.style.background='rgba(0,0,0,0.75)'; toastEl.style.color='#fff'; toastEl.style.padding='10px 14px'; toastEl.style.borderRadius='10px'; toastEl.style.zIndex=9999; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.style.display='block'; clearTimeout(toastTimer); toastTimer = setTimeout(()=> toastEl.style.display='none', 3000);
}

/* ===================== Check visual / satélite note ===================== */
L.control.attribution({prefix:false}).addAttribution('Camada satélite: ESRI World Imagery').addTo(map);

/* ===================== Ajuste inicial de zoom para exibir o trecho ===================== */
map.fitBounds(canalLine.getBounds().pad(0.5));

// Mostra coordenadas no movimento do mouse
map.on('mousemove', function(e) {
    document.getElementById('coords').innerText = 
        `Lat: ${e.latlng.lat.toFixed(6)} , Lng: ${e.latlng.lng.toFixed(6)}`;
});

// Mostra coordenadas ao clicar no mapa
map.on('click', function(e) {
    alert(`Coordenadas clicadas:\nLat: ${e.latlng.lat.toFixed(6)}, Lng: ${e.latlng.lng.toFixed(6)}`);
});
