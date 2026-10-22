/* ===== 考公备考计划表 · 主应用逻辑 =====
 * 改造要点：
 * 1) 任务自定义修改真正持久化 —— 修改存进 state[date].items，渲染/统计全程以它为准
 * 2) 点击任务文字直接编辑，弹出多行文本框（手机端可正常换行）
 * 3) 多端同步靠 GitHub Gist（纯静态站点的唯一免费可行方案）
 * 4) 手机端优化：弹窗、防抖保存、触摸友好
 */

(function () {
'use strict';

/* ================= 常量 ================= */
var STORE_KEY = 'kaogong_plan_v4';
var SYNC_KEY = 'kaogong_sync_creds';
var REMOTE_FILE = 'kaogong-plan-state.json';

/* ================= 状态 ================= */
// state 结构：{ [date]: { items:[...], tasks:{i:bool}, hours, note } }
var state = {};
try { state = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { state = {}; }

/* ================= 行数据 ================= */
// 关键：有自定义任务时以 state 为准，否则用 DATA.days 原版
var dayRows = DATA.days.map(function (d) {
  var st = state[d.date];
  var items = (st && Array.isArray(st.items) && st.items.length) ? st.items.slice() : d.items.slice();
  return { date: d.date, wk: d.wk, dtype: d.dtype, tag: d.tag, stage: d.stage, ms: d.ms, items: items, pct: 0 };
});

/* ================= 阶段归属 ================= */
var stageOf = {};
DATA.stages.forEach(function (s) {
  var p1 = s.start.split('.').map(Number), p2 = s.end.split('.').map(Number);
  var ss = new Date(p1[0], p1[1] - 1, p1[2]), ee = new Date(p2[0], p2[1] - 1, p2[2]);
  for (var d = new Date(ss); d <= ee; d.setDate(d.getDate() + 1)) {
    stageOf[d.toISOString().slice(0, 10)] = s.name;
  }
});
var stageDays = {}, stageDone = {};
DATA.stages.forEach(function (s) {
  var p1 = s.start.split('.').map(Number), p2 = s.end.split('.').map(Number);
  var days = Math.round((new Date(p2[0], p2[1] - 1, p2[2]) - new Date(p1[0], p1[1] - 1, p1[2])) / 86400000) + 1;
  stageDays[s.name] = days; stageDone[s.name] = 0;
});

/* ================= 工具 ================= */
function pad(n) { return String(n).padStart(2, '0'); }
function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function tip(msg, kind) {
  var t = document.getElementById('tip'); if (!t) return;
  t.textContent = msg;
  t.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(tip._timer);
  tip._timer = setTimeout(function () { t.className = ''; }, 1900);
}
function showConfirm(title, bodyHtml, onOk) {
  document.getElementById('confirmTitle').innerHTML = title;
  document.getElementById('confirmBody').innerHTML = bodyHtml;
  document.getElementById('confirmMask').classList.add('show');
  document.getElementById('confirmBox').classList.add('show');
  var ok = document.getElementById('confirmOk'), cancel = document.getElementById('confirmCancel'), mask = document.getElementById('confirmMask');
  var close = function () { mask.classList.remove('show'); document.getElementById('confirmBox').classList.remove('show'); };
  ok.onclick = function () { close(); onOk(); };
  cancel.onclick = close;
  mask.onclick = close;
}

/* ================= 状态归一化（兼容旧版 tasks 数组格式） ================= */
function normalize(s) {
  var out = {};
  Object.keys(s || {}).forEach(function (k) {
    var v = s[k]; if (!v || typeof v !== 'object') return;
    var rec = { tasks: {} };
    if (Array.isArray(v.tasks)) v.tasks.forEach(function (b, i) { rec.tasks[i] = !!b; });
    else if (v.tasks && typeof v.tasks === 'object') Object.keys(v.tasks).forEach(function (i) { rec.tasks[i] = !!v.tasks[i]; });
    if (Array.isArray(v.items) && v.items.length) rec.items = v.items.slice();
    if ('hours' in v && v.hours !== '' && v.hours != null) rec.hours = v.hours;
    if ('note' in v && v.note != null) rec.note = v.note;
    out[k] = rec;
  });
  return out;
}
state = normalize(state);

/* ================= 保存 ================= */
function recOf(date, autocreate) {
  if (!state[date] && autocreate) state[date] = { tasks: {} };
  return state[date] || {};
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { }
  schedulePush();
}
function persist() { save(); }

/* ================= 合并云端数据 ================= */
function mergeFromCloud(cloud) {
  cloud = normalize(cloud);
  var merged = 0, dayCount = 0;
  Object.keys(cloud).forEach(function (k) {
    var remote = cloud[k], local = state[k] || {};
    var localItems = Array.isArray(local.items) ? local.items : null;
    var remoteItems = Array.isArray(remote.items) ? remote.items : null;
    // 任务清单取字数更多的一方（编辑通常更长）
    var winner = remoteItems && (!localItems || remoteItems.join('\n').length >= localItems.join('\n').length) ? remoteItems : localItems;
    var lt = local.tasks || {}, rt = remote.tasks || {}, keys = {};
    Object.keys(lt).forEach(function (i) { keys[i] = true; });
    Object.keys(rt).forEach(function (i) { keys[i] = true; });
    var tasks = {};
    Object.keys(keys).forEach(function (i) { tasks[i] = i in rt ? !!rt[i] : !!lt[i]; });
    var rec = { tasks: tasks };
    if (winner && winner.length) rec.items = winner.slice();
    if ('hours' in remote) rec.hours = remote.hours; else if ('hours' in local) rec.hours = local.hours;
    if ('note' in remote) rec.note = remote.note; else if ('note' in local) rec.note = local.note;
    state[k] = rec;
    var row = dayRows.find(function (x) { return x.date === k; });
    if (row && Array.isArray(rec.items) && rec.items.length) row.items = rec.items.slice();
    dayCount++; if (remoteItems) merged += remoteItems.length;
  });
  return { dayCount: dayCount, merged: merged };
}

/* ================= 统计 ================= */
function calc() {
  var doneDays = 0, taskDone = 0, taskTotal = 0;
  DATA.stages.forEach(function (s) { stageDone[s.name] = 0; });
  dayRows.forEach(function (d) {
    var st = state[d.date] || {}; var t = st.tasks || {};
    var c = 0; d.items.forEach(function (_, i) { if (t[i]) c++; });
    d.pct = d.items.length ? Math.round(c / d.items.length * 100) : 0;
    taskDone += c; taskTotal += d.items.length;
    if (d.pct >= 100) doneDays++;
    stageDone[d.stage] = (stageDone[d.stage] || 0) + (d.pct >= 100 ? 1 : 0);
  });
  document.getElementById('stDone').textContent = doneDays;
  document.getElementById('stRate').textContent = Math.round(doneDays / dayRows.length * 100) + '%';
  document.getElementById('stTask').textContent = taskDone;
  document.getElementById('stTotal').textContent = taskTotal;
  document.getElementById('stStage').textContent = stageOf[todayKey()] || '阶段四';
  renderStages();
  document.querySelectorAll('#dayTbl tr[data-date]').forEach(function (tr) {
    var d = dayRows.find(function (x) { return x.date === tr.dataset.date; }); if (!d) return;
    tr.querySelector('.pct').textContent = d.pct + '%';
    tr.classList.toggle('done-row', d.pct >= 100);
    tr.classList.toggle('part-row', d.pct > 0 && d.pct < 100);
  });
}

/* ================= 阶段卡片 ================= */
function renderStages() {
  var grid = document.getElementById('stageGrid'); if (!grid) return;
  grid.innerHTML = '';
  DATA.stages.forEach(function (s) {
    var done = stageDone[s.name] || 0, total = stageDays[s.name] || 1, pct = Math.round(done / total * 100);
    grid.insertAdjacentHTML('beforeend',
      '<div class="stage-card"><div class="sn">' + s.name + '</div><div class="sd">' + s.start + ' ~ ' + s.end + '（' + total + '天）</div><div class="sg">🎯 ' + s.goal + '</div><div class="st">✅ ' + s.std + '</div><div class="pbar"><div class="pl"><span>' + done + '/' + total + ' 天</span><span>' + pct + '%</span></div><div class="track"><div class="fill" style="width:' + pct + '%"></div></div></div></div>');
  });
  var bars = document.getElementById('stageBars'); if (!bars) return;
  bars.innerHTML = '';
  DATA.stages.forEach(function (s) {
    var done = stageDone[s.name] || 0, total = stageDays[s.name] || 1, pct = Math.round(done / total * 100);
    bars.insertAdjacentHTML('beforeend', '<div class="pbar"><div class="pl"><span>' + s.name + '（' + s.start + ' ~ ' + s.end + '）</span><span>' + pct + '%  ' + done + '/' + total + '</span></div><div class="track"><div class="fill" style="width:' + pct + '%"></div></div></div>');
  });
}

/* ================= 里程碑 / 周计划 ================= */
DATA.milestones.forEach(function (m) {
  var el = document.getElementById('msList');
  if (el) el.insertAdjacentHTML('beforeend', '<li><span class="md">' + m.date + '</span><span><span class="mt">' + esc(m.title) + '</span><br><span style="color:#666;">目标：' + esc(m.goal) + ' ｜ ' + esc(m.note) + '</span></span></li>');
});
var weekRows = DATA.weekly.map(function (w) { return w; });
function renderWeek() {
  ensureCellLabels();
  var tb = document.querySelector('#weekTbl tbody'); if (!tb) return;
  tb.innerHTML = weekRows.map(function (r) {
    return '<tr><td>' + r.w + '</td><td>' + r.range + '</td><td>' + r.duty + '</td><td><b>' + r.theme + '</b></td><td style="font-size:11px;">' + r.task + '</td><td style="font-size:11px;color:#2e7d32;">' + r.std + '</td></tr>';
  }).join('');
}
var weekSort = { k: 'w', asc: true };
document.querySelectorAll('#weekTbl th').forEach(function (th) {
  th.onclick = function () {
    var k = th.dataset.k; if (!k) return;
    if (weekSort.k === k) weekSort.asc = !weekSort.asc; else { weekSort.k = k; weekSort.asc = true; }
    weekRows.sort(function (a, b) { var va = a[k], vb = b[k]; return (va > vb ? 1 : -1) * (weekSort.asc ? 1 : -1); });
    renderWeek();
  };
});

/* ================= 每日打卡渲染 ================= */
var daySort = { k: 'date', asc: true };
function renderDays() {
  var q = document.getElementById('qDate').value.trim();
  var fs = document.getElementById('fStage').value, ft = document.getElementById('fType').value, fd = document.getElementById('fDone').value;
  var tb = document.querySelector('#dayTbl tbody'); if (!tb) return;
  var rows = dayRows.filter(function (d) {
    if (q && d.date.indexOf(q) < 0) return false;
    if (fs && d.stage !== fs) return false;
    if (ft && d.dtype !== ft) return false;
    if (fd === 'done' && d.pct < 100) return false;
    if (fd === 'part' && (d.pct <= 0 || d.pct >= 100)) return false;
    if (fd === 'none' && d.pct > 0) return false;
    return true;
  });
  tb.innerHTML = rows.map(function (d) {
    var st = state[d.date] || {};
    var cbs = d.items.map(function (it, i) {
      var ck = st.tasks && st.tasks[i] ? 'checked' : '';
      var dl = st.tasks && st.tasks[i] ? 'done' : '';
      return '<li class="' + dl + '" data-i="' + i + '"><input type="checkbox" data-d="' + d.date + '" data-i="' + i + '" ' + ck + '><span class="task-text" data-d="' + d.date + '" data-i="' + i + '">' + esc(it) + '</span></li>';
    }).join('');
    if (!cbs) cbs = '<li style="color:#bbb;">（暂无任务，点 ✎ 添加）</li>';
    var rowCls = d.pct >= 100 ? 'done-row' : (d.pct > 0 ? 'part-row' : '');
    var tagTxt = d.ms ? '<span class="tag lc">节点</span> ' + esc(d.ms) : (d.tag ? '<span class="tag ' + d.tag + '">' + d.dtype + '</span>' : d.dtype);
    return '<tr class="' + rowCls + '" data-date="' + d.date + '"><td>' + d.date + '</td><td>' + d.wk + '</td><td>' + d.stage + '</td><td>' + tagTxt + '</td><td style="font-size:11px;">' + esc(d.ms || '—') + '</td><td><div class="taskbox"><ul>' + cbs + '</ul></div></td><td class="pct">' + d.pct + '%</td><td><input class="mini-note" type="number" min="0" max="12" step="0.5" placeholder="h" data-h="' + d.date + '" value="' + esc(st.hours || '') + '"></td><td><input class="mini-note" placeholder="备注" data-n="' + d.date + '" value="' + esc(st.note || '') + '"></td><td style="text-align:center;white-space:nowrap;"><button class="mini-note" title="编辑当天任务" data-edit="' + d.date + '" style="cursor:pointer;background:#fff;border-color:#90caf9;color:#1565c0;">✎</button><button class="mini-note" title="恢复当天初始任务" data-reset="' + d.date + '" style="cursor:pointer;background:#fff;border-color:#ef9a9a;color:#c62828;">↺</button></td></tr>';
  }).join('');
  bindChecks();
  ensureCellLabels();
}

function bindChecks() {
  document.querySelectorAll('#dayTbl input[type=checkbox]').forEach(function (cb) {
    cb.onchange = function () {
      var d = cb.dataset.d, i = +cb.dataset.i;
      var st = recOf(d, true); st.tasks = st.tasks || {}; st.tasks[i] = cb.checked;
      var li = cb.closest('li'); if (cb.checked) li.classList.add('done'); else li.classList.remove('done');
      calc(); save();
    };
  });
  document.querySelectorAll('#dayTbl input[data-h]').forEach(function (inp) {
    inp.onchange = function () { var st = recOf(inp.dataset.h, true); st.hours = inp.value; save(); };
  });
  document.querySelectorAll('#dayTbl input[data-n]').forEach(function (inp) {
    inp.onchange = function () { var st = recOf(inp.dataset.n, true); st.note = inp.value; save(); };
  });
  document.querySelectorAll('#dayTbl .task-text').forEach(function (sp) {
    sp.onclick = function () { openEditModal(sp.dataset.d, +sp.dataset.i); };
  });
  document.querySelectorAll('#dayTbl [data-edit]').forEach(function (btn) {
    btn.onclick = function (e) { e.stopPropagation(); openEditModal(btn.dataset.edit, null); };
  });
  document.querySelectorAll('#dayTbl [data-reset]').forEach(function (btn) {
    btn.onclick = function (e) { e.stopPropagation(); resetDayTasks(btn.dataset.reset); };
  });
}

/* ================= 编辑弹窗（支持换行） ================= */
var editCtx = null; // { date, index|null }
function openEditModal(date, idx) {
  var row = dayRows.find(function (x) { return x.date === date; }); if (!row) return;
  editCtx = { date: date, index: idx };
  document.getElementById('editModalTitle').textContent = '✎ ' + date + ' · ' + row.wk + (idx == null ? ' 任务清单' : ' 第' + (idx + 1) + '项');
  document.getElementById('editTextarea').value = idx == null ? row.items.join('\n') : row.items[idx];
  document.getElementById('editModal').classList.add('show');
  setTimeout(function () { var t = document.getElementById('editTextarea'); t.focus(); try { t.setSelectionRange(t.value.length, t.value.length); } catch (e) { } }, 60);
}
function closeEditModal() {
  document.getElementById('editModal').classList.remove('show');
  editCtx = null;
}
function saveEditModal() {
  if (!editCtx) return;
  var row = dayRows.find(function (x) { return x.date === editCtx.date; }); if (!row) return;
  var st = recOf(editCtx.date, true);
  var newText = document.getElementById('editTextarea').value;
  if (editCtx.index == null) {
    // 整单编辑：一行一条
    var arr = newText.split('\n').map(function (s) { return s.replace(/\s+$/, ''); }).filter(function (s) { return s.length > 0; });
    if (!arr.length) { tip('任务不能为空，至少保留一条', 'warn'); return; }
    var oldItems = row.items;
    var newTasks = {};
    arr.forEach(function (txt, ni) {
      var inh = false;
      for (var oi = 0; oi < oldItems.length; oi++) {
        if (oldItems[oi] === txt && st.tasks && st.tasks[oi]) { inh = true; break; }
      }
      newTasks[ni] = inh;
    });
    st.items = arr.slice(); st.tasks = newTasks; row.items = arr.slice();
  } else {
    var t = newText.replace(/\s+$/, '');
    if (!t) { tip('内容不能为空', 'warn'); return; }
    row.items[editCtx.index] = t;
    st.items = row.items.slice();
  }
  persist(); renderDays(); calc();
  closeEditModal();
  tip('已保存任务');
}

/* ================= 恢复初始任务 ================= */
function resetAllTasks() {
  showConfirm('恢复初始任务', '<div>确定<b>恢复全部 ' + dayRows.length + ' 天的初始任务清单</b>吗？<br><br>· 改动过的任务文字将还原成最初版本<br>· <b>打卡勾选进度会保留</b><br>· 用时和备注也会保留</div>', function () {
    DATA.days.forEach(function (src) {
      var row = dayRows.find(function (x) { return x.date === src.date; }); if (!row) return;
      var oldItems = row.items;
      var st = recOf(src.date, true);
      var newTasks = {};
      src.items.forEach(function (txt, i) {
        var inh = false;
        for (var j = 0; j < oldItems.length; j++) {
          if (oldItems[j] === txt && st.tasks && st.tasks[j]) { inh = true; break; }
        }
        newTasks[i] = inh;
      });
      st.items = src.items.slice(); st.tasks = newTasks; row.items = src.items.slice();
    });
    save(); renderDays(); calc(); tip('已恢复初始任务清单');
  });
}
function resetDayTasks(date) {
  showConfirm('恢复当天初始任务', '确定恢复 <b>' + date + '</b> 的原始任务清单吗？当天打卡进度会尽量保留。', function () {
    var src = DATA.days.find(function (x) { return x.date === date; });
    var row = dayRows.find(function (x) { return x.date === date; }); if (!src || !row) return;
    var oldItems = row.items;
    var st = recOf(date, true);
    var newTasks = {};
    src.items.forEach(function (txt, i) {
      var inh = false;
      for (var j = 0; j < oldItems.length; j++) {
        if (oldItems[j] === txt && st.tasks && st.tasks[j]) { inh = true; break; }
      }
      newTasks[i] = inh;
    });
    st.items = src.items.slice(); st.tasks = newTasks; row.items = src.items.slice();
    save(); renderDays(); calc(); tip('已恢复 ' + date + ' 的初始任务');
  });
}

/* ================= 新增 / 删除当天 ================= */
function addNewDay() {
  var last = dayRows[dayRows.length - 1];
  var next;
  if (last) { var p = last.date.split('-'); next = new Date(+p[0], +p[1] - 1, +p[2]); next.setDate(next.getDate() + 1); }
  else { next = new Date(); }
  var key = next.getFullYear() + '-' + pad(next.getMonth() + 1) + '-' + pad(next.getDate());
  var wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][next.getDay()];
  var row = { date: key, wk: wk, dtype: '标准工作日', tag: '', stage: '阶段四', ms: '', items: ['书法日课·早上(06:50-07:15) 25min', '上午学习块1h 09:00-10:00', '午休学习40min 12:30-13:10', '下午学习块1h 15:00-16:00', '书法35min 19:30-20:05', '晚间学习块55min 20:05-21:00', '锻炼1h 21:00-22:00'], pct: 0 };
  dayRows.push(row);
  state[key] = state[key] || { tasks: {} };
  save(); renderDays(); calc();
  setTimeout(function () { var tr = document.querySelector('#dayTbl tr[data-date="' + key + '"]'); if (tr) { tr.scrollIntoView({ block: 'center' }); tr.style.background = '#fff9c4'; setTimeout(function () { tr.style.background = ''; }, 2000); } }, 60);
  tip('已新增 ' + key + '，点任务文字即可编辑');
}
function delDay(date) {
  showConfirm('删除当天', '确定删除 <b>' + date + '</b> 这一天的计划吗？\n（该天的打卡记录会一并清除）', function () {
    var idx = dayRows.findIndex(function (x) { return x.date === date; });
    if (idx < 0) return;
    dayRows.splice(idx, 1); delete state[date];
    save(); renderDays(); calc(); tip('已删除 ' + date);
  });
}

/* ================= 导出 / 导入 / 清空 ================= */
function exportData() {
  var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '考公计划进度备份.json'; a.click(); tip('已导出备份');
}
function clearAll() {
  showConfirm('清空全部记录', '<b>确定清空全部打卡记录？</b><br>此操作不可恢复！', function () {
    localStorage.removeItem(STORE_KEY); state = {};
    dayRows.forEach(function (d) { d.items = (DATA.days.find(function (x) { return x.date === d.date; }) || d).items.slice(); });
    renderDays(); calc(); tip('已清空');
  });
}
function importData(file) {
  var reader = new FileReader();
  reader.onload = function (ev) {
    var raw;
    try { raw = JSON.parse(ev.target.result); } catch (e) { tip('导入失败：文件不是合法的 JSON', 'warn'); return; }
    if (!raw || typeof raw !== 'object') { tip('导入失败：内容格式不正确', 'warn'); return; }
    var incoming = (raw.state && typeof raw.state === 'object') ? raw.state : raw;
    var nDay = 0, nTask = 0;
    Object.keys(incoming).forEach(function (date) {
      var day = incoming[date]; if (!day || typeof day !== 'object') return;
      state[date] = state[date] || {};
      if (day.items && Array.isArray(day.items) && day.items.length) state[date].items = day.items.slice();
      if (day.tasks && typeof day.tasks === 'object') {
        var merged = {};
        Object.keys(day.tasks).forEach(function (i) { merged[i] = day.tasks[i] === true; if (merged[i]) nTask++; });
        var old = state[date].tasks || {};
        Object.keys(old).forEach(function (i) { if (merged[i] === undefined) merged[i] = old[i] === true; });
        state[date].tasks = merged;
      }
      if (day.hours !== undefined && day.hours !== null && day.hours !== '') state[date].hours = day.hours;
      if (day.note !== undefined && day.note !== null) state[date].note = String(day.note);
      nDay++;
    });
    state = normalize(state);
    dayRows.forEach(function (d) {
      var st = state[d.date];
      if (st && Array.isArray(st.items) && st.items.length) d.items = st.items.slice();
    });
    save(); renderDays(); calc(); tip('已导入 ' + nDay + ' 天、恢复 ' + nTask + ' 项勾选');
  };
  reader.onerror = function () { tip('导入失败：读取文件出错', 'warn'); };
  reader.readAsText(file, 'UTF-8');
}

/* ================= 回到今日 / 标签页 ================= */
function scrollToToday() {
  var key = todayKey();
  var target = null;
  document.querySelectorAll('#dayTbl tbody tr').forEach(function (tr) { if (tr.dataset.date === key) target = tr; });
  if (target) {
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
    target.style.transition = 'background .6s';
    var old = target.style.background;
    target.style.background = '#fff9c4';
    setTimeout(function () { target.style.background = old; }, 2000);
  } else {
    for (var i = document.querySelectorAll('#dayTbl tbody tr').length - 1; i >= 0; i--) {
      var rows = document.querySelectorAll('#dayTbl tbody tr');
      if ((rows[i].dataset.date || '') < key) { rows[i].scrollIntoView({ block: 'center' }); break; }
    }
  }
}
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
  document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('tabBtn-' + name).classList.add('active');
  if (name === 'daily') setTimeout(scrollToToday, 50);
}
var daySort = { k: 'date', asc: true };
document.querySelectorAll('#dayTbl th').forEach(function (th) {
  th.onclick = function () {
    var k = th.dataset.k; if (!k) return;
    if (daySort.k === k) daySort.asc = !daySort.asc; else { daySort.k = k; daySort.asc = true; }
    dayRows.sort(function (a, b) {
      var va = a[k], vb = b[k];
      if (k === 'pct') { va = a.pct; vb = b.pct; }
      if (va == null) va = ''; if (vb == null) vb = '';
      return (va > vb ? 1 : -1) * (daySort.asc ? 1 : -1);
    });
    renderDays();
  };
});
['qDate', 'fStage', 'fType', 'fDone'].forEach(function (id) { document.getElementById(id).addEventListener('input', renderDays); });

/* ================= 手机端标签 ================= */
function ensureCellLabels() {
  if (window.innerWidth > 768) return;
  var labels = ['日期', '星期', '阶段', '类型', '节点', '任务', '完成度', '用时', '备注', '操作'];
  document.querySelectorAll('#dayTbl tbody tr').forEach(function (tr) {
    tr.querySelectorAll('td').forEach(function (td, i) { if (!td.dataset.l) td.dataset.l = labels[i] || ''; });
  });
}

/* ================= 云同步（GitHub Gist） ================= */
var sync = null;           // { username, gistId, token }
var pushTimer = null;
var suppressApply = false;  // 本地刚写上去时，跳过即将到来的 pull

function setSyncUI(text, cls) {
  var dot = document.getElementById('syncDot'), t = document.getElementById('syncText');
  if (dot) dot.className = 'sync-dot' + (cls ? ' ' + cls : '');
  if (t) t.textContent = text;
}
function saveCreds(c) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(c)); } catch (e) { } sync = c; }
function loadCreds() {
  try { sync = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { sync = null; }
  if (!sync || !sync.token || !sync.gistId || !sync.username) sync = null;
}
function gh(path, opt) {
  opt = opt || {};
  return fetch('https://api.github.com' + path, {
    method: opt.method || 'GET',
    headers: Object.assign({ 'Authorization': 'token ' + sync.token, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, opt.headers || {}),
    body: opt.body
  }).then(function (r) {
    if (!r.ok) return r.text().then(function (txt) { throw new Error(r.status + '：' + txt.slice(0, 180)); });
    return r.json();
  });
}
function readRemote() {
  return gh('/gists/' + sync.gistId).then(function (g) {
    var file = g.files && g.files[REMOTE_FILE];
    if (!file || !file.content) return {};
    try { return JSON.parse(file.content); } catch (e) { return {}; }
  });
}
function buildPayload() {
  var payload = {};
  Object.keys(state).forEach(function (k) {
    var v = state[k]; if (!v) return;
    var rec = {};
    if (Array.isArray(v.items) && v.items.length) rec.items = v.items;
    var t = v.tasks || {};
    if (Object.keys(t).length) rec.tasks = t;
    if ('hours' in v && v.hours !== '' && v.hours != null) rec.hours = v.hours;
    if ('note' in v && v.note != null && v.note !== '') rec.note = v.note;
    if (Object.keys(rec).length) payload[k] = rec;
  });
  return payload;
}
function writeRemote() {
  var files = {};
  files[REMOTE_FILE] = { content: JSON.stringify(buildPayload(), null, 1) };
  return gh('/gists/' + sync.gistId, { method: 'PATCH', body: JSON.stringify({ files: files }) }).then(function () { return true; });
}
function pullRemote() {
  if (!sync) return Promise.resolve();
  setSyncUI('正在从云端拉取…', 'syncing');
  return readRemote().then(function (cloud) {
    var info = mergeFromCloud(cloud);
    saveLocalOnly(); renderDays(); calc();
    setSyncUI('云端同步已连接 · 已同步', 'online');
    tip('已从云端同步 ' + info.dayCount + ' 天');
  }).catch(function (e) {
    setSyncUI('同步失败：' + e.message.slice(0, 26), 'error');
    tip('拉取云端失败：' + e.message, 'warn');
  });
}
function schedulePush() {
  if (!sync) return;
  clearTimeout(pushTimer);
  setSyncUI('正在保存到云端…', 'syncing');
  pushTimer = setTimeout(function () {
    writeRemote().then(function () {
      setSyncUI('云端同步已连接 · 已同步', 'online');
    }).catch(function (e) {
      setSyncUI('同步失败：' + e.message.slice(0, 26), 'error');
      tip('保存到云端失败：' + e.message, 'warn');
    });
  }, 800);
}
function saveLocalOnly() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { }
}
function connectCloud(opts) {
  saveCreds({ username: opts.username, gistId: opts.gistId, token: opts.token });
  pullRemote();
}
function disconnectCloud() {
  localStorage.removeItem(SYNC_KEY); sync = null;
  setSyncUI('未连接云同步 · 点这里设置', 'offline');
  tip('已断开云同步');
}
function openSyncPanel() {
  document.getElementById('scUser').value = (sync && sync.username) || '';
  document.getElementById('scGist').value = (sync && sync.gistId) || '';
  document.getElementById('scToken').value = (sync && sync.token) || '';
  document.getElementById('syncPanel').classList.add('show');
}
function closeSyncPanel() { document.getElementById('syncPanel').classList.remove('show'); }
function submitSyncPanel() {
  var u = document.getElementById('scUser').value.trim();
  var g = document.getElementById('scGist').value.trim();
  var t = document.getElementById('scToken').value.trim();
  if (!u || !g || !t) { tip('三项都要填：GitHub 用户名、Gist ID、Token', 'warn'); return; }
  closeSyncPanel(); connectCloud({ username: u, gistId: g, token: t });
}

/* ================= 事件绑定 ================= */
document.getElementById('editModal').addEventListener('click', function (e) { if (e.target === this) closeEditModal(); });
document.getElementById('editTextarea').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEditModal(); }
  if (e.key === 'Escape') closeEditModal();
});
document.getElementById('importFile').addEventListener('change', function (e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!confirm('确定导入「' + file.name + '」的打卡进度吗？\n· 将按日期合并勾选/用时/备注/任务清单')) return;
  importData(file); e.target.value = '';
});
document.getElementById('syncStatus').addEventListener('click', openSyncPanel);
document.getElementById('syncBtn').addEventListener('click', openSyncPanel);
document.getElementById('syncClose').addEventListener('click', closeSyncPanel);
document.getElementById('syncSubmit').addEventListener('click', submitSyncPanel);
document.getElementById('syncDisconnect').addEventListener('click', function () {
  if (confirm('确定断开云同步？本机数据保留，之后打卡只存在本地。')) disconnectCloud();
});
document.getElementById('editCancel').addEventListener('click', closeEditModal);
document.getElementById('editSave').addEventListener('click', saveEditModal);

/* ================= 初始化 ================= */
loadCreds();
renderWeek();
renderDays();
calc();
scrollToToday();

window.exportData = exportData;
window.clearAll = clearAll;
window.resetAllTasks = resetAllTasks;
window.backToToday = scrollToToday;
window.addNewDay = addNewDay;
window.switchTab = switchTab;
window.closeEditModal = closeEditModal;
window.saveEditModal = saveEditModal;
window.delDay = delDay;

if (sync) {
  pullRemote();
} else {
  setSyncUI('未连接云同步 · 点这里设置', 'offline');
}
})();
