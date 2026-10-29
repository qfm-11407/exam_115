import { InkPad } from './canvas.js';
import { client, GASClient, saveBackend } from './transport.js?v=20261029-grace-270';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const allowedStudentId = value => typeof value === 'string' && /^(?:14107(?:0[1-9]|1[0-5])|14207(?:1[6-9]|2[0-8]))$/.test(value);
const studentId = p => escape(p.studentId || '');
const storage = { get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, remove(key) { try { localStorage.removeItem(key); } catch {} } };
let toastTimer, offset = 0, liveState = null;
function toast(message, error = false) { if (!$('toast')) return; $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
async function api(url,data,token) { return client.request(url,data,token); }
function connect(code,receive) {
  return client.subscribe(code,state=>{offset=state.serverTime-Date.now();liveState=state;receive(state);},(ok,message)=>{connection(ok);if(!ok&&message)toast(message,true);},document.body.dataset.page==='screen');
}
function connection(connected) { const el = $('connection'); if (!el) return; el.textContent = connected ? '已連線' : '重新連線中'; el.className = `connection ${connected ? 'connected' : 'offline'}`; }
function remaining(round) { return round?.phase === 'writing' ? Math.max(0, Math.ceil((round.deadline - Date.now() - offset) / 1000)) : null; }
function timerText(round) { const left = remaining(round); return left !== null ? String(left).padStart(2, '0') : round?.phase === 'revealed' ? '✓' : ['closed','collecting'].includes(round?.phase) ? '00' : '—'; }
function phaseLabel(round) { if(round?.phase==='closed'&&round.closeReason==='all-submitted')return '全員已交卷'; return !round ? '等待出題' : ({ writing:'作答進行中', collecting:'傳送緩衝中', closed:'作答已截止', revealed:'結果已揭曉', cancelled:'本題已取消' })[round.phase]; }
function rankRows(players, max = 60) {
  return [...players].sort((a, b) => b.score - a.score || a.studentId.localeCompare(b.studentId, 'en', { numeric: true })).slice(0, max).map((p, i) => `<div class="rank-row"><span class="rank-number">${i + 1}</span><span class="rank-name"><small>${studentId(p)}</small>${escape(p.name)}</span><strong>${p.score}<small>分</small></strong></div>`).join('') || '<p class="list-empty">參賽者加入後顯示排名</p>';
}
function bindDialogs() {
  document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
}
bindDialogs();
const page = document.body.dataset.page;

if (page === 'teacher') {
  let room, admin, refreshing = false, idiomCount = 0, previousPhase, workers = 0;
  function pumpWorkers() { if (!room?.round?.pending) return; const count=Math.min(admin.settings.concurrency,room.round.pending); while(workers<count) { workers++; client.rpc('worker',{room:room.code}).catch(error=>toast(error.message,true)).finally(()=>{workers--;}); } }
  let displayedQuestionId = null;
  let pendingCreateRoom='',replacementRequired=false,roomsLoaded=false,roomsLoading=false;
  $('help-button').onclick = () => $('help-dialog').showModal();
  async function refresh() {
    if (!client.backend || !client.token || refreshing) return; refreshing = true;
    try {
      const data = await api('/api/admin/state'); admin = data;
      $('login-panel').hidden = true; $('teacher-app').hidden = false; $('settings-button').hidden = false;
      idiomCount = data.idiomCount || 0;
      $('key-status').textContent = data.settings.configured ? '已設定金鑰（不顯示內容）' : '尚未設定 API 金鑰';
      room = data.room; liveState = room; if (room) offset = room.serverTime - Date.now(); renderTeacher(); pumpWorkers();
    } catch (error) { if (error.status === 401) { client.token=''; $('login-error').textContent=error.message; $('login-panel').hidden = false; $('teacher-app').hidden = true; $('settings-button').hidden = true; } else toast(error.message, true); }
    finally { refreshing = false; }
  }
  function showQuestion() {
    const ready=!room.round||room.round.phase==='revealed',q=ready?room.draft:room.round;
    $('question-prompt').value=q?.prompt||''; $('answer').value=q?.answer||'';
    $('draw-info').textContent=q ? '已抽中「'+q.idiom+'」，挖空第 '+(q.blankIndex+1)+' 字。題庫 '+idiomCount+' 則，共 '+(idiomCount*4)+' 種題型。' : '按「隨機抽題」預覽下一題。';
    if(q?.id!==displayedQuestionId){$('accepted').value=(q?.accepted||[]).join('，');displayedQuestionId=q?.id;}
  }
  function canManageRooms(){return Boolean(admin?.features?.roomManagement);}
  function renderAIStatus() {
    const configured=Boolean(admin?.settings.configured),management=canManageRooms();
    $('app-version').textContent='網頁 v2.7.0 · GAS '+(admin?.version||'未回報版本');
    $('ai-ready-status').textContent=configured?'AI 金鑰：後端已設定':'AI 金鑰：後端尚未設定';
    $('create-ai-room-button').hidden=false;$('create-ai-room-button').disabled=!configured;
    $('backend-update-note').hidden=management;
    $('room-manager').hidden=!management;
    $('player-management-note').textContent=admin?.features?.playerManagement?'移除學生連線後，同學號可重新加入；已交卷答案與累計成績保留。':'移除學生功能需更新 GAS Code.gs 至 2.3.0，並將原部署更新為新版本。';
    $('end-room-button').hidden=!management;$('delete-room-button').hidden=!management;
    $('ai-mode-note').textContent=!configured?'後端尚未讀到 API 金鑰。請確認 GAS 指令碼屬性名稱是 OPENAI_API_KEY，或在「AI 設定」中填入金鑰。':room?.ended?'目前測驗已結束，可直接建立新的 AI 挑戰。':room?.mode==='live'?'目前房間：AI 正式判讀。學生交卷後會呼叫 AI。':'按「建立 AI 正式比賽」確認新房間；若有尚未結束的測驗，可勾選先結束再建立。';
    if($('room-dialog').open){updateModeNote();updateRoomConfirmation();}
    if(management&&!roomsLoaded&&!roomsLoading){roomsLoaded=true;loadRooms();}
  }
  function renderTeacher() {
    renderAIStatus();
    $('welcome-panel').hidden = Boolean(room); $('room-dashboard').hidden = !room; if (!room) return;
    const round = room.round, writing = !room.ended&&round?.phase === 'writing', ready = !room.ended&&(!round || round.phase === 'revealed');
    $('auto-close-note').hidden=!admin?.features?.autoClose;
    $('auto-close-note').textContent=admin?.features?.submissionGrace?'作答時間到後保留 5 秒傳送緩衝，暫不公開筆跡。全員已存圖則提早截止；手動截止會立即結束接收。':'全員交卷後自動截止，直接展示筆跡；對錯仍由教師統一揭曉。';
    $('room-mode').textContent=room.mode==='live'?'AI 正式判讀':'流程演練（不使用 AI）';
    $('room-status').textContent=room.ended?'已結束':'開放中';$('end-room-button').disabled=Boolean(room.ended);
    $('practice-banner').hidden = room.mode !== 'practice'; $('room-title').textContent = room.title; $('room-code').textContent = room.code;
    $('open-screen').href = client.pageURL('screen.html',room.code); $('open-play').href = studentEntryURL(room.code); $('export-link').href = '#';
    updateJoinLink();
    $('round-label').textContent = round ? `第 ${round.number} 題` : '尚未開始'; $('phase-pill').textContent = phaseLabel(round); $('phase-pill').className = `pill ${writing ? 'active-pill' : 'neutral'}`;
    $('teacher-countdown').textContent = timerText(round); $('submitted-count').textContent = `${round?.submitted || 0} / ${room.players.length}`; $('judged-count').textContent = round?.judged || 0; $('player-count').textContent = `${room.players.length} 人`;
    $('close-button').disabled = room.ended||!['writing','collecting'].includes(round?.phase); $('reveal-button').disabled = room.ended || !round || round.phase !== 'closed' || round.pending > 0; $('retry-button').hidden = room.ended || !round || !round.unresolved || round.phase === 'revealed';
    showQuestion(); $('draw-button').disabled = !ready; $('start-button').disabled = !ready || !room.players.length || !room.draft; $('start-button').textContent = round?.phase === 'revealed' ? '開始下一題 →' : '開始作答 →';
    ['question-prompt','answer','seconds','accepted'].forEach(id => { $(id).disabled = !ready; });
    document.querySelectorAll('[data-step]').forEach(el => el.classList.toggle('current', el.dataset.step === (round?.phase==='collecting'?'writing':round?.phase)));
    $('judge-summary').textContent = !round ? '交卷後即在背景判讀，結果暫時隱藏。' : round.pending ? `${round.pending} 份正在排隊或判讀中，${round.judged} 份已完成。` : round.unresolved ? `${round.unresolved} 份未完成判讀，可先重試；揭曉後這些答案標示「無法判定」，不判錯。` : round.phase === 'revealed' ? '結果已揭曉並計分，可準備下一題。' : round.submitted ? '目前交卷均已判讀完成，截止後即可揭曉。' : '等待參賽者交卷。';
    const status = { uploading:'保存中', 'upload-error':'上傳待重試', queued:'排隊', judging:'判讀中', done:'已判讀', error:'判讀失敗', uncertain:'辨識不明', waiting:'待交卷' };
    $('teacher-players').innerHTML = room.players.map(p => `<div class="player-chip ${p.submitted ? 'submitted' : ''}" title="${escape(p.error)}"><span class="seat-number">${studentId(p)}</span><span class="player-name">${escape(p.name)}</span><span class="player-status ${p.judgeStatus === 'error' ? 'failed' : ''}">${round?.phase === 'revealed' && p.status === 'done' ? p.correct ? '✓' : '✗' : status[p.judgeStatus] || '待交卷'}</span>${admin?.features?.playerManagement?`<button type="button" class="remove-player-button" data-remove-player="${escape(p.id)}" data-connection-version="${Number(p.connectionVersion)||0}" aria-label="移除學號 ${studentId(p)} 的連線" ${room.ended?'disabled':''}>移除</button>`:''}</div>`).join('') || '<p class="list-empty">分享平板網址，等待第一位參賽者加入。</p>';
    $('leaderboard').innerHTML = rankRows(room.players, 8); const u = room.usage;
    $('usage-info').textContent = room.mode === 'practice' ? '流程演練・API 用量為 0' : `${u.calls} 次有效判讀回應 · 輸入 ${u.input.toLocaleString()} / 輸出 ${u.output.toLocaleString()} tokens`;

    if(round?.phase==='collecting')$('judge-summary').textContent='作答時間到，正在接收延遲交卷；緩衝結束後才展示筆跡與開放揭曉。';
    if(room.ended){$('draw-info').textContent='測驗已結束；已揭曉成績保留。請建立新測驗繼續。';$('judge-summary').textContent='本測驗已結束，未揭曉的當題不計分。';}
    previousPhase = round?.phase;
  }
  function studentEntryURL(code){return admin?.features?.directStudent?client.studentURL(code):client.pageURL('student.html',code); }
  function updateJoinLink() { if (room) setJoinLink(studentEntryURL(room.code)); }
  $('export-link').onclick=async event=>{event.preventDefault();if(!room)return;try{const result=await api(`/api/admin/rooms/${room.code}/export`);const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=result.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message,true);}};
  $('draw-button').onclick=async()=>{if(!room)return;try{$('draw-button').disabled=true;await api('/api/admin/rooms/'+room.code+'/draw',{});await refresh();}catch(error){toast(error.message,true);renderTeacher();}};
  async function login(pin) { await api('/api/login', { pin }); $('pin').value = ''; $('login-error').textContent = ''; await refresh(); }
  $('login-form').onsubmit = async event => { event.preventDefault(); try { await login($('pin').value); } catch (error) { $('login-error').textContent = error.message; } };
  refresh();
  if(!client.backend)$('login-error').textContent='請先回首頁設定 GAS 後端連線。';
  function updateRoomConfirmation(){ $('room-create-submit').disabled=(replacementRequired&&!$('end-current-confirm').checked)||($('new-mode').value==='live'&&!admin?.settings.configured); }
  const createDialog = () => {
    pendingCreateRoom=room?.code||'';replacementRequired=canManageRooms()&&Boolean(room&&!room.ended);
    $('end-current-container').hidden=!replacementRequired;$('end-current-confirm').checked=false;
    $('end-current-description').textContent=replacementRequired?'目前測驗「'+room.title+'」（'+room.code+'）將結束。尚未揭曉的當題取消、不計分；學生須使用新房號加入。':'';
    $('room-create-error').textContent='';$('room-dialog').showModal();$('new-mode').value=admin?.settings.configured?'live':'practice';updateModeNote();updateRoomConfirmation();
  };
  $('end-current-confirm').onchange=updateRoomConfirmation;
  $('create-ai-room-button').onclick=()=>{if(!admin?.settings.configured){$('settings-button').onclick();return;}createDialog();$('new-mode').value='live';updateModeNote();};
  $('new-room-button').onclick = createDialog; $('welcome-create').onclick = createDialog;
  function updateModeNote() {
    const live=$('new-mode').value==='live',configured=Boolean(admin?.settings.configured);
    $('mode-choice-practice').checked=!live;$('mode-choice-live').checked=live;
    $('mode-key-status').textContent=configured?'GAS 已讀到 API 金鑰設定，不需重填。':'GAS 尚未讀到 API 金鑰設定；AI 選項仍顯示，但建立前需先完成設定。';
    $('mode-note').textContent=live?(configured?'AI 會自動判定單字對錯，使用您的 API 額度。':'目前已選 AI 正式判讀；請先檢查 GAS 的 OPENAI_API_KEY 或按「檢查 AI 設定」。'):'演練不辨識筆跡，對錯為預設測試結果。';
    $('mode-note').className='notice '+(live&&configured?'':'amber');updateRoomConfirmation();
  }
  for(const mode of ['practice','live'])$('mode-choice-'+mode).onchange=()=>{if($('mode-choice-'+mode).checked){$('new-mode').value=mode;updateModeNote();}};
  $('mode-settings-button').onclick=()=>{$('room-dialog').close();$('settings-button').onclick();};
  $('new-mode').onchange=updateModeNote;
  $('room-form').onsubmit = async event => {
    event.preventDefault();if($('new-mode').value==='live'&&!admin?.settings.configured){$('room-create-error').textContent='GAS 尚未讀到 API 金鑰，請先檢查 AI 設定。';return;}if(replacementRequired&&!$('end-current-confirm').checked){$('room-create-error').textContent='請先勾選結束目前測驗，或取消後回到原測驗。';return;}
    $('room-create-submit').disabled=true;
    try {const request={title:$('new-title').value,mode:$('new-mode').value};if(canManageRooms()){request.previousRoom=pendingCreateRoom;request.endCurrent=replacementRequired&&$('end-current-confirm').checked;}
      const result=await api('/api/admin/rooms',request);if(result.room){room=result.room;admin.room=room;liveState=room;renderTeacher();}
      $('room-dialog').close();previousPhase=undefined;await refresh();if(canManageRooms())await loadRooms();toast('房間已建立，請讓學生使用新房號加入');
    }catch(error){$('room-create-error').textContent=error.message;toast(error.message,true);}finally{updateRoomConfirmation();}
  };
  $('settings-button').onclick = () => { $('api-model').value = admin.settings.model; $('concurrency').value = admin.settings.concurrency; $('settings-dialog').showModal(); };
  $('settings-form').onsubmit = async event => { event.preventDefault(); try { const result=await api('/api/admin/settings', { key: $('api-key').value.trim(), model: $('api-model').value.trim(), concurrency: Number($('concurrency').value) }); $('api-key').value = ''; $('settings-dialog').close(); admin.settings.configured=Boolean(result.configured); renderAIStatus(); await refresh(); if(result.configured&&(!room||room.ended||room.mode!=='live')){createDialog();$('new-mode').value='live';updateModeNote();toast('AI 設定已儲存；請確認建立 AI 挑戰，原房間在確認前維持不變');}else toast(result.configured?'AI 設定已套用；目前房間為 AI 正式判讀':'模型設定已套用，但後端尚未設定 API 金鑰',!result.configured); } catch (error) { toast(error.message, true); } };
  $('question-form').onsubmit = async event => {
    event.preventDefault(); if (!room) return;
    try { await api(`/api/admin/rooms/${room.code}/start`, { draftId: room.draft?.id, seconds: Number($('seconds').value), accepted: $('accepted').value.split(/[,，、\s]+/).filter(Boolean) }); await refresh(); }
    catch (error) { toast(error.message, true); }
  };
  for (const action of ['close','reveal','retry']) $(action + '-button').onclick = async () => { if (!room) return; try { $(action + '-button').disabled = true; await api(`/api/admin/rooms/${room.code}/${action}`, {}); await refresh(); } catch (error) { toast(error.message, true); renderTeacher(); } };
  function setJoinLink(url){if($('join-url').value!==url)$('join-copy-status').textContent='';$('join-url').value=url;}
  async function copyJoinURL(){
    const input=$('join-url'),url=input.value;if(!url){toast('請先建立測驗，再複製作答網址',true);return;}
    let copied=false;
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);copied=true;}}catch{}
    if(!copied){input.focus();input.select();input.setSelectionRange?.(0,url.length);try{copied=Boolean(document.execCommand?.('copy'));}catch{}}
    const message=copied?'已複製作答網址（含房號）':'無法自動複製，已選取網址；請按 Ctrl+C 或長按複製';
    $('join-copy-status').textContent=message;toast(message,!copied);
  }
  $('copy-link').onclick=copyJoinURL;$('copy-join-url').onclick=copyJoinURL;
  $('teacher-players').onclick=async event=>{
    const button=event.target.closest('[data-remove-player]');if(!button||!room||!admin?.features?.playerManagement)return;
    const code=room.code,playerId=button.dataset.removePlayer,connectionVersion=Number(button.dataset.connectionVersion),student=room.players.find(p=>p.id===playerId);
    if(!student||!confirm('確定移除學號 '+student.studentId+' 的舊裝置連線？同學號可以重新加入；累計成績與已交卷答案保留，已交卷者不能重寫本題。'))return;
    button.disabled=true;
    try{const result=await api('/api/admin/rooms/'+code+'/remove-player',{playerId,connectionVersion});if(room?.code===code){room=result.room;admin.room=room;liveState=room;renderTeacher();}toast('已移除舊連線，同學號現在可重新加入');}
    catch(error){toast(error.message,true);}finally{button.disabled=false;}
  };
  async function loadRooms(){
    if(!canManageRooms()||roomsLoading)return;roomsLoading=true;
    try{const result=await api('/api/admin/rooms/list'),selected=$('saved-room-select').value;
      $('saved-room-select').innerHTML=result.rooms.map(item=>'<option value="'+escape(item.code)+'">'+escape(item.title)+' · '+item.code+' · '+(item.ended?'已結束':'開放中')+' · '+(item.mode==='live'?'AI':'演練')+'</option>').join('');
      $('saved-room-select').value=result.rooms.some(item=>item.code===selected)?selected:result.active||result.rooms[0]?.code||'';
      $('room-manager-status').textContent='共 '+result.rooms.length+' 場測驗。刪除後舊房號失效，Drive 備份保留。';
    }catch(error){$('room-manager-status').textContent=error.message;}finally{roomsLoading=false;}
  }
  async function deleteRoom(code){
    if(!code||!canManageRooms())return;
    if(!confirm('確定刪除房號 '+code+' 的測驗？未結束的測驗會一併結束，未揭曉當題不計分。測驗從清單移除，Drive 圖片與成績備份保留。'))return;
    try{await api('/api/admin/rooms/'+code+'/delete',{});if(room?.code===code){room=null;admin.room=null;liveState=null;renderTeacher();}await refresh();await loadRooms();toast('測驗已刪除；Drive 備份保留');}catch(error){toast(error.message,true);}
  }
  $('refresh-rooms-button').onclick=loadRooms;
  $('end-room-button').onclick=async()=>{if(!room||room.ended||!canManageRooms())return;const code=room.code;if(!confirm('確定結束房號 '+code+' 的測驗？尚未揭曉的當題取消、不計分。已揭曉成績保留。'))return;try{const result=await api('/api/admin/rooms/'+code+'/end',{});room=result.room;admin.room=room;liveState=room;renderTeacher();await loadRooms();toast('測驗已結束，可以建立新的 AI 挑戰');}catch(error){toast(error.message,true);}};
  $('delete-room-button').onclick=()=>deleteRoom(room?.code);
  $('delete-saved-room-button').onclick=()=>deleteRoom($('saved-room-select').value);
  $('load-room-button').onclick=async()=>{const code=$('saved-room-select').value;if(!code||!canManageRooms())return;try{const result=await api('/api/admin/rooms/'+code+'/select',{});room=result.room;admin.room=room;liveState=room;renderTeacher();await refresh();}catch(error){toast(error.message,true);}};
  setInterval(refresh, 3500); setInterval(() => { if (room) $('teacher-countdown').textContent = timerText(room.round); }, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

if (page === 'play') {
  const params = new URLSearchParams(location.search), code = params.get('room')?.toUpperCase() || '';
  $('join-code').value = code;
  if(!client.backend)$('join-error').textContent='請使用教師分享的完整作答網址，或回首頁設定 GAS 後端。';
  function updateDirectStudentLink(){const link=$('direct-student-link');link.hidden=!client.backend;if(client.backend)link.href=client.studentURL($('join-code').value.trim().toUpperCase());}
  updateDirectStudentLink();$('join-code').addEventListener('input',updateDirectStudentLink);
  let identity = null, stream = null, state = null, activeRound = null, submitted = false, sending = false, joining = false;
  const joinClaims=new Map();
  let lastStudentVerdict='',frozenSubmission=null,deadlineLockedRound='';
  let pad; pad = new InkPad($('handwriting'), () => { if (!pad) return; $('canvas-hint').hidden = pad.strokes.length > 0; if (state?.round && identity) storage.set(`oneword:${client.backend}:draft:${state.code}`, { round: activeRound, strokes: pad.strokes }); });
  function applyStudentVerdict(round,own){
    const decided=round?.phase==='revealed'&&own.submitted&&own.status==='done'&&typeof own.correct==='boolean';
    const tone=decided?(own.correct?'correct':'wrong'):'',key=decided?round.id+':'+own.id+':'+tone:'';
    const first=Boolean(key&&key!==lastStudentVerdict);lastStudentVerdict=key;
    document.body.dataset.verdict=tone;document.body.dataset.resultEffect=first?'enter':'';
    $('own-result').className='own-result'+(tone?' '+tone:'')+(first?' result-enter':'');
    if(decided){$('lock-symbol').textContent=own.correct?'✓':'✗';$('lock-message').textContent=own.correct?'答對了！':'答錯了';$('lock-detail').textContent='結果已揭曉，等待教師開始下一題。';}
  }
  function resetPlayer(message){
    document.body.dataset.verdict='';document.body.dataset.resultEffect='';lastStudentVerdict='';
    const roomCode=state?.code||$('join-code').value;const student=identity?.player;stream?.close();stream=null;pad.enabled=false;submitted=false;sending=false;activeRound=null;frozenSubmission=null;storage.remove(`oneword:${client.backend}:pending:${roomCode}`);identity=null;state=null;storage.remove(`oneword:${client.backend}:player:${roomCode}`);if(student?.studentId){storage.remove(`oneword:${client.backend}:claim:${roomCode}:${student.studentId}`);joinClaims.delete(`oneword:${client.backend}:claim:${roomCode}:${student.studentId}`);}$('join-code').value=roomCode;if(student?.studentId)$('join-student-id').value=student.studentId;
    $('submit-button').disabled=true;['undo','eraser','clear'].forEach(id=>{$(id).disabled=true;});$('writing-panel').hidden=true;$('join-panel').hidden=false;$('join-error').textContent=message;connection(false);
  }
  function renderPlay(next) {
    if(!identity||!next)return;
    state = next; const round = state.round, own = state.players.find(p => p.id === identity?.player.id);
    if (!own) { resetPlayer('教師已移除此裝置連線，請重新輸入學號加入。原有成績與已交卷答案會保留。'); return; }
    if (activeRound !== round?.id) {
      activeRound = round?.id; const pending=storage.get(`oneword:${client.backend}:pending:${state.code}`);frozenSubmission=pending?.roundId===activeRound&&pending?.playerId===identity.player.id?pending:null; const draft = storage.get(`oneword:${client.backend}:draft:${state.code}`); pad.clear();
      if (draft && draft.round === activeRound && Array.isArray(draft.strokes)) { pad.strokes = draft.strokes; pad.render(); }
    }
    submitted = own.submitted;
    $('play-practice').hidden = state.mode !== 'practice'; $('player-identity').textContent = `學號 ${own.studentId} · ${own.name}`; $('play-room').textContent = `房號 ${state.code}`;
    $('play-round').textContent = round ? `第 ${String(round.number).padStart(2,'0')} 題 · 只寫一個字` : '等待教師出題'; $('play-prompt').textContent = round?.prompt || '好好握筆，準備上場。';
    $('play-countdown').textContent = timerText(round);
    const writing = !state.ended&&round?.phase === 'writing' && remaining(round) > 0;
    pad.enabled = Boolean(writing && !submitted && !sending && !frozenSubmission);
    const retryFrozen=Boolean(frozenSubmission&&!state.ended&&round&&!['revealed','cancelled'].includes(round.phase));
    $('submit-button').disabled = sending||submitted||!(pad.enabled||retryFrozen);
    ['undo','eraser','clear'].forEach(id => { $(id).disabled = !pad.enabled; });
    const lock = !writing || submitted || Boolean(frozenSubmission);
    $('canvas-lock').hidden = !lock;
    $('lock-symbol').textContent = !round ? '✦' : submitted ? '✓' : '⌛';
    $('lock-message').textContent = !round ? '等待出題' : submitted ? '已交卷' : '作答已截止';
    $('lock-detail').textContent = !round ? '教師開始後，就可以在這裡寫字。' : submitted ? '答案已鎖定，等待統一揭曉。' : '本題沒有送出答案，等待下一題。';
    $('write-state').textContent = !round ? '等待開始' : submitted ? '答案已送出' : writing ? '作答中' : '已截止';
    $('submit-button').textContent = sending ? '正在送出…' : submitted ? '✓ 已送出答案' : frozenSubmission ? '重送已鎖定答案 →' : '送出答案 →';
    const collecting=round?.phase==='collecting'||(round?.phase==='writing'&&remaining(round)===0&&Date.now()+offset<(round.submissionDeadline||round.deadline));
    if(!submitted&&(frozenSubmission||collecting)){$('lock-message').textContent=sending?'答案傳送中':frozenSubmission?'筆跡已鎖定':'作答時間到';$('lock-detail').textContent=frozenSubmission?'正在確認交卷；可重送同一份答案，不能修改筆跡。':'正在接收延遲交卷，手寫區已鎖定。';$('write-state').textContent=sending?'傳送中':collecting?'傳送緩衝中':'等待交卷確認';}
    $('play-message').textContent=collecting?'作答已結束，保留 5 秒接收延遲交卷。':frozenSubmission&&!submitted?'若尚未確認成功，可重送已鎖定答案。':'請在倒數結束前送出，送出後無法修改。';
    $('own-result').hidden = round?.phase !== 'revealed';
    if (round?.phase === 'revealed') {
      const done = own.submitted&&own.status === 'done'&&typeof own.correct==='boolean';
      $('own-result').textContent = !own.submitted ? '本題未交卷' : done ? own.correct ? `✓ 答對了！＋${state.points} 分` : '✗ 本題答錯' : '無法判定';
      $('lock-message').textContent = '本題已揭曉'; $('lock-detail').textContent = '等待教師開始下一題。';
    }
    applyStudentVerdict(round,own);
    if(state.ended){$('play-round').textContent='本測驗已結束';$('lock-message').textContent='測驗已結束';$('lock-detail').textContent='請使用教師提供的新房號加入下一場';$('write-state').textContent='已結束';}
  }
  async function join(data) {
    if(joining)return;
    if(!data.token&&data.studentId){const key=`oneword:${client.backend}:claim:${data.room}:${data.studentId}`;let claim=joinClaims.get(key)||storage.get(key);if(typeof claim!=='string'||!/^[a-f0-9]{64}$/.test(claim)){claim=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');storage.set(key,claim);}joinClaims.set(key,claim);data={...data,joinKey:claim};}
    joining=true;$('join-submit').disabled=true;$('join-submit').textContent='正在連線…';$('join-status').textContent='正在連接教室雲端後端，請稍候…';$('join-error').textContent='';
    try{const result=await api('/api/join',data);identity=result;storage.set(`oneword:${client.backend}:player:${data.room}`,result);
      $('join-panel').hidden=true;$('writing-panel').hidden=false;if(stream)stream.close();stream=connect(data.room,renderPlay);history.replaceState(null, '', client.pageURL('student.html',data.room));
    }catch(error){if(error.status===401){const old=storage.get(`oneword:${client.backend}:player:${data.room}`),id=data.studentId||old?.player?.studentId;storage.remove(`oneword:${client.backend}:player:${data.room}`);if(id){storage.remove(`oneword:${client.backend}:claim:${data.room}:${id}`);joinClaims.delete(`oneword:${client.backend}:claim:${data.room}:${id}`);}}throw error;}
    finally{joining=false;$('join-submit').disabled=false;$('join-submit').textContent='加入比賽 →';$('join-status').textContent='';}
  }
  $('join-form').onsubmit = async event => { event.preventDefault(); try { const room = $('join-code').value.trim().toUpperCase(), id = $('join-student-id').value.trim(); if (!allowedStudentId(id)) throw new Error('此學號不在允許名單，無法登入'); await join({ room, studentId: id, name: $('join-name').value }); } catch (error) { $('join-error').textContent = error.message; } };
  const saved = storage.get(`oneword:${client.backend}:player:${code}`);
  if (saved?.token) join({ room: code, token: saved.token }).catch(error => { $('join-error').textContent = error.message; });
  $('undo').onclick = () => pad.undo(); $('clear').onclick = () => { if (pad.enabled) pad.clear(); };
  $('eraser').onclick = () => { pad.eraser = !pad.eraser; $('eraser').setAttribute('aria-pressed', String(pad.eraser)); $('eraser').textContent = pad.eraser ? '✎ 改用黑筆' : '▱ 橡皮擦'; };
  $('submit-button').onclick = async () => {
    if (sending || submitted || !state?.round || state.ended || ['revealed','cancelled'].includes(state.round.phase)) return;
    if (!frozenSubmission&&(!pad.enabled||remaining(state.round)<=0)){renderPlay(state);return;}
    if (!frozenSubmission&&!pad.hasInk()) return toast('請先在格內寫一個字', true);
    if(!frozenSubmission){frozenSubmission={roundId:state.round.id,image:pad.export(),playerId:identity.player.id};storage.set(`oneword:${client.backend}:pending:${state.code}`,frozenSubmission);}
    const {roundId,image}=frozenSubmission; sending = true; renderPlay(state);
    try { await api('/api/submit', { room: state.code, roundId, image }, identity.token); submitted = true; client.rpc('studentWorker',{room:state.code,roundId},identity.token).catch(()=>{}); toast('圖片已保存，等待統一揭曉'); }
    catch (error) { toast(error.message, true); }
    finally { sending = false; if(!identity||!state)return; try { const latest = await api(`/api/room?room=${state.code}`); liveState = latest; renderPlay(latest); } catch { renderPlay(state); } }
  };
  setInterval(() => { if (!state?.round) return; $('play-countdown').textContent=timerText(state.round); $('play-countdown').classList.toggle('urgent',remaining(state.round)!==null&&remaining(state.round)<=5); if(state.round.phase==='writing'&&remaining(state.round)===0&&deadlineLockedRound!==state.round.id){deadlineLockedRound=state.round.id;renderPlay(state);} }, 200);
}

if (page === 'screen') {
  const code = new URLSearchParams(location.search).get('room')?.toUpperCase(); let state, rankings = false, effectRound='';const shownVerdicts=new Set();
  const render = next => {
    state = next; const round = state.round, shown = round && ['closed','revealed','cancelled'].includes(round.phase), revealed = round?.phase === 'revealed';
    if(effectRound!==round?.id){effectRound=round?.id||'';shownVerdicts.clear();}
    $('screen-practice').hidden = state.mode !== 'practice'; $('screen-mode').textContent = state.mode === 'practice' ? '流程演練' : 'AI 正式判讀';
    $('screen-room').textContent = state.code; $('screen-title').textContent = state.title; $('screen-round').textContent = round ? `第 ${String(round.number).padStart(2,'0')} 題` : '等待參賽者加入';
    $('screen-phase').textContent = phaseLabel(round); $('screen-prompt').textContent = round?.prompt || '每一筆，都是你的實力。'; $('screen-countdown').textContent = timerText(round);
    $('screen-timer-label').textContent = !round ? '準備落筆' : round.phase === 'writing' ? '秒後截止' : round.phase === 'collecting' ? '傳送緩衝中' : round.phase === 'closed' ? '作答已截止' : '結果已揭曉';
    $('screen-subtitle').textContent = revealed ? `本題正解：${round.answer}${round.idiom ? ` · 完整成語：${round.idiom}` : ''}` : shown ? round.closeReason==='all-submitted'?'全員已交卷，等待教師統一揭曉對錯。':'作答已截止，等待教師統一揭曉對錯。' : round?.phase==='collecting' ? '作答時間到，正在接收延遲交卷；筆跡暫不公開。' : round ? '只寫一個字，寫好後請在平板按下送出。' : '請在平板開啟作答頁，輸入房號加入。';
    $('screen-progress').textContent = round ? `${round.submitted} / ${state.players.length} 人已交卷` : `${state.players.length} 人已加入`;
    $('screen-footer-hint').textContent = revealed ? '答對加 10 分 · 原始筆跡保留' : shown ? '點選筆跡圖片，可以放大查看' : '作答期間不公開筆跡與結果';
    $('screen-grid').innerHTML = state.players.map(p => {
      const done = revealed && p.submitted && p.status === 'done' && typeof p.correct==='boolean', correct = done && p.correct;
      const key=round?.id+':'+p.id+':'+p.correct,enter=done&&!shownVerdicts.has(key);if(done)shownVerdicts.add(key);
      const paper = shown && p.imageUrl ? `<img src="${p.imageUrl}" alt="${studentId(p)} 的手寫答案" data-image="${p.imageUrl}" data-label="${escape(`${studentId(p)} · ${p.name}`)}">` : shown ? '<span class="empty-ink">未交卷</span>' : `<div class="paper-state"><b>${p.submitted ? '✓' : '✎'}</b><span>${p.submitted ? '已交卷・答案保密' : round?.phase==='collecting' ? '等待交卷確認' : round ? '專心作答中' : '準備就緒'}</span></div>`;
      return `<article class="answer-card ${revealed ? 'revealed' : ''} ${done ? correct ? 'correct' : 'wrong' : ''} ${enter?'result-enter':''}"><div class="answer-card-head"><span class="answer-seat">${studentId(p)}</span><span class="answer-name">${escape(p.name)}</span><span class="answer-score">${p.score} 分</span></div><div class="answer-paper">${paper}</div><div class="answer-foot"><span>${revealed ? done ? correct ? '答對 ＋10 分' : '答錯 ＋0 分' : p.submitted ? '無法判定' : '未交卷' : state.ended ? '測驗已結束' : shown ? '等待揭曉' : p.submitted ? '答案已鎖定' : '一人一字'}</span><span class="${done ? 'answer-verdict' : 'pending-verdict'}">${done ? correct ? '✓' : '✗' : revealed && p.submitted ? '—' : '·'}</span></div></article>`;
    }).join('') || '<div class="screen-empty"><span>筆</span><h2>擂台已準備就緒</h2><p>參賽者加入後，會依座號出現在這裡。</p></div>';
    if(state.ended){$('screen-phase').textContent='測驗已結束';$('screen-timer-label').textContent='已結束';$('screen-subtitle').textContent='已揭曉成績保留。請使用教師提供的新房號加入下一場。';$('screen-prompt').textContent='本場測驗已結束';}
    $('screen-ranking').innerHTML = rankRows(state.players); $('screen-grid').hidden = rankings; $('screen-ranking').hidden = !rankings;
  };
  if (code) connect(code, render); else { $('screen-subtitle').textContent = '請從教師控制台按「開啟大螢幕」進入。'; connection(false); }
  $('ranking-toggle').onclick = () => { rankings = !rankings; $('ranking-toggle').textContent = rankings ? '回到答案牆 ↗' : '查看排行榜 ↗'; if (state) render(state); };
  $('fullscreen-button').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('此瀏覽器無法啟用全螢幕'); } };
  $('screen-grid').onclick = event => { const img = event.target.closest('[data-image]'); if (!img) return; $('enlarged-image').src = img.dataset.image; $('enlarged-label').textContent = img.dataset.label; $('image-dialog').showModal(); };
  setInterval(() => { if (state) { $('screen-countdown').textContent = timerText(state.round); $('screen-countdown').classList.toggle('urgent', remaining(state.round) !== null && remaining(state.round) <= 5); } }, 200);
}

if(page==='home') {
  $('backend-url').value=client.backend; $('site-origin').textContent=location.origin;
  $('backend-details').open=!client.backend;
  $('backend-description').textContent=client.backend?'已預設教室雲端後端，可直接進入教師端或學生端，不需重新貼上網址。':'尚未設定教室雲端後端，請展開下方設定並測試連線。';
  const entryLinks=Array.from(document.querySelectorAll('a[href="./teacher.html"],a[href="./student.html"]'),a=>({node:a,file:a.getAttribute('href').includes('teacher')?'teacher.html':'student.html'}));
  function updateEntryLinks(){entryLinks.forEach(item=>{item.node.href=item.file==='student.html'&&client.backend?client.studentURL():client.pageURL(item.file);});}
  updateEntryLinks();
  $('backend-form').onsubmit=async event=>{event.preventDefault();const button=$('backend-form').querySelector('button');button.disabled=true;let tester;try{const url=saveBackend($('backend-url').value.trim());tester=new GASClient(url);$('backend-status').textContent='正在連接 GAS…';await tester.rpc('ping',{},'',0);$('backend-status').textContent='連線成功。現在可以進入教師控制台或學生作答頁。';client.dispose();client.backend=url;updateEntryLinks();}catch(error){$('backend-status').textContent=error.message;}finally{tester?.dispose();button.disabled=false;}};
}
