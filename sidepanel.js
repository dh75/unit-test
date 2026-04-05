// sidepanel.js — 사이드패널 UI 로직

document.getElementById('versionLabel').textContent = VERSION;

/* ── 이벤트 바인딩 (CSP: inline onclick 금지 → addEventListener 사용) ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnCaptureCurrent').addEventListener('click', () => captureCurrentTab());
  document.getElementById('btnAnalyze').addEventListener('click', runAnalyze);
  document.getElementById('btnReset').addEventListener('click', doReset);
  document.getElementById('btnDebug').addEventListener('click', toggleDebug);
  document.getElementById('btnCopyJSON').addEventListener('click', copyJSON);
  document.getElementById('btnCSV').addEventListener('click', exportCSV);
  document.getElementById('tabTestcases').addEventListener('click', function() { swTab('testcases', this); });
  document.getElementById('tabJson').addEventListener('click', function() { swTab('json', this); });

  // TC 삭제 버튼 — 이벤트 위임 (동적 생성 요소)
  document.getElementById('tcWrap').addEventListener('click', e => {
    const btn = e.target.closest('.btn-tc-del');
    if (!btn) return;
    const key = btn.getAttribute('data-key');
    if (key) removeTC(key);
  });
  // 소스 삭제 버튼 — 이벤트 위임
  document.getElementById('srcList').addEventListener('click', e => {
    const btn = e.target.closest('.btn-src-del');
    if (!btn) return;
    const idx = parseInt(btn.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) removeSource(idx);
  });

  document.getElementById('tcWrap').addEventListener('mouseover', e => {
    if (e.target.classList.contains('btn-tc-del')) e.target.style.color = '#e00';
  });
  document.getElementById('tcWrap').addEventListener('mouseout', e => {
    if (e.target.classList.contains('btn-tc-del')) e.target.style.color = '#ccc';
  });
});

/* ── 상태 ── */
let _sources    = [];  // [{ memo, raw }]
let _allFields  = [];
let _allRelations = [];
let _allButtons = [];
let _screenName = '';
let _excludedTcKeys = new Set();
let _debugLines = [];

/* ════════════════════════════════════════
   소스 목록 관리
════════════════════════════════════════ */
function addSource(memo, raw) {
  _sources.push({ memo: memo || '소스' + (_sources.length + 1), raw });
  renderSrcList();
}

function removeSource(idx) {
  _sources.splice(idx, 1);
  renderSrcList();
}

function renderSrcList() {
  const el = document.getElementById('srcList');
  if (!_sources.length) { el.innerHTML = ''; return; }
  el.innerHTML = _sources.map((s, i) => `
    <div class="src-item">
      <div class="src-item-header">
        <span class="src-num">${i + 1}</span>
        <span class="src-memo" title="${escHtml(s.memo)}">${escHtml(s.memo)}</span>
        <span class="src-status ${s.raw ? 'ok' : 'empty'}">${s.raw ? '수집됨' : '비어있음'}</span>
        <button class="btn-src-del" data-idx="${i}">×</button>
      </div>
    </div>`).join('');
}

/* ════════════════════════════════════════
   자동 캡처 (content.js 호출)
════════════════════════════════════════ */
async function captureCurrentTab() {
  setStatus('<span class="spinner"></span> 캡처 중...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) throw new Error('활성 탭을 찾을 수 없습니다.');

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_REQUEST', mode: 'current' })
      .catch(async () => {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await wait(200);
        return chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_REQUEST', mode: 'current' });
      });

    if (!response || !response.ok) {
      throw new Error(response?.error || '캡처 실패');
    }

    response.sources.forEach(src => addSource(src.memo, src.raw));
    setStatus(`✅ 캡처 완료 (총 ${_sources.length}개)`);
    log(`캡처: ${response.sources.map(s => s.memo).join(', ')}`, 'ok');

  } catch (e) {
    setStatus(`❌ ${e.message}`);
    log(e.message, 'err');
  }
}

/* ════════════════════════════════════════
   분석 실행
════════════════════════════════════════ */
function runAnalyze() {
  const activeSrcs = _sources.filter(s => s.raw);
  if (!activeSrcs.length) { setStatus('❌ 수집된 소스가 없습니다. 먼저 캡처하세요.'); return; }

  _debugLines = [];
  _excludedTcKeys = new Set();
  document.getElementById('debugLog').innerHTML = '';

  log(`=== E-GENE Form Analyzer ${VERSION} 시작 ===`, 'ok');
  setStatus('<span class="spinner"></span> 분석 중...');

  // 비동기 처리 (대용량 소스 UI 블로킹 방지)
  setTimeout(() => {
    try {
      const parsed = activeSrcs.map((src, idx) => {
        const label = src.memo || `소스${idx + 1}`;
        log(`[${label}] 파싱 (${(src.raw.length / 1024).toFixed(1)}KB)`, 'info');
        const result = parseSource(src.raw, label);
        log(`[${label}]: 필드 ${result.fields.length}개, 릴레이션 ${result.relations.length}개`, 'ok');
        return result;
      });

      const { allFields, allRelations, allButtons, warnings, screenName } = mergeSources(parsed, log);
      _allFields    = allFields;
      _allRelations = allRelations;
      _allButtons   = allButtons;
      _screenName   = screenName;

      renderOutput(warnings);
      setStatus(`✅ 분석 완료 — 필드 ${allFields.length}개 / TC ${genTCs(allFields, allRelations, allButtons).length}개`);
      log('=== 분석 완료 ===', 'ok');
    } catch (e) {
      setStatus(`❌ 분석 오류: ${e.message}`);
      log(e.message, 'err');
      console.error(e);
    }
  }, 0);
}

/* ════════════════════════════════════════
   렌더링
════════════════════════════════════════ */
function renderOutput(warnings = []) {
  document.getElementById('output').style.display = 'block';
  const snEl = document.getElementById('screenNameLabel');
  if (_screenName) { snEl.textContent = '📋 ' + _screenName; snEl.style.display = 'block'; }
  else snEl.style.display = 'none';

  const warnEl = document.getElementById('warnings');
  const unknownRels = _allRelations.filter(r => !r.hasData).map(r => r.label);
  const allWarnings = [
    ...warnings,
    ...(unknownRels.length ? [`컬럼 정보 없는 릴레이션: ${unknownRels.join(', ')} — 해당 옵션 소스를 추가하세요.`] : [])
  ];
  warnEl.innerHTML = allWarnings.map(w => `<div class="warn-box">⚠ ${w}</div>`).join('');

  document.getElementById('tcWrap').innerHTML = renderTCs();
  document.getElementById('jsonPre').textContent = JSON.stringify(buildOutput(), null, 2);
}

function swTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

/* ════════════════════════════════════════
   TC 렌더링
════════════════════════════════════════ */
function tcKey(tc) { return tc.group + '|||' + tc.title; }

function removeTC(key) {
  _excludedTcKeys.add(key);
  document.getElementById('tcWrap').innerHTML = renderTCs();
  document.getElementById('jsonPre').textContent =
    JSON.stringify(buildOutput(), null, 2);
}

function filteredTCs() {
  return genTCs(_allFields, _allRelations, _allButtons).filter(tc => !_excludedTcKeys.has(tcKey(tc)));
}

function renderTCs() {
  const tcs = filteredTCs();
  if (!tcs.length) return '<p class="no-data">테스트케이스 없음</p>';

  const groups = [], groupMap = {};
  tcs.forEach(tc => {
    const g = tc.group || '기타';
    if (!groupMap[g]) { groupMap[g] = []; groups.push(g); }
    groupMap[g].push(tc);
  });

  let seq = 1;
  let html = `<table class="tc-table"><thead><tr>
    <th>ID</th><th>테스트 항목</th><th>테스트 스텝</th><th>태그</th><th></th>
  </tr></thead><tbody>`;

  groups.forEach(g => {
    html += `<tr><td colspan="5" class="tc-group-header">${escHtml(g)}</td></tr>`;
    groupMap[g].forEach(tc => {
      const key = escHtml(tcKey(tc)).replace(/'/g, '&#39;');
      html += `<tr>
        <td class="td-id">TC-${String(seq++).padStart(3, '0')}</td>
        <td class="td-title">${escHtml(tc.title)}</td>
        <td class="td-step">${renderStepCell(tc.steps)}</td>
        <td class="td-tags">${tc.tags.map(t => `<span class="badge">${escHtml(t)}</span>`).join('<br>')}</td>
        <td style="text-align:center;vertical-align:middle">
          <button class="btn-tc-del" data-key="${key}" title="이 TC 제거"
            style="background:none;border:none;color:#ccc;font-size:13px;cursor:pointer;padding:0 3px">×</button>
        </td>
      </tr>`;
    });
  });
  html += '</tbody></table>';
  return html;
}

function renderStepCell(steps) {
  return steps.map((st, i) => {
    const txt = escHtml(st.text);
    if (st.level === 2) return `<div class="step-sub2"><span class="step-icon-sub">└─</span>${txt}</div>`;
    if (st.level === 1) return `<div class="step-sub"><span class="step-icon-sub">└</span>${txt}</div>`;
    return `<div><b>${i + 1}.</b> ${txt}</div>`;
  }).join('');
}

/* ════════════════════════════════════════
   유틸
════════════════════════════════════════ */
function doReset() {
  _sources = []; _allFields = []; _allRelations = []; _allButtons = []; _screenName = '';
  _excludedTcKeys = new Set(); _debugLines = [];
  document.getElementById('srcList').innerHTML = '';
  document.getElementById('output').style.display = 'none';
  document.getElementById('debugLog').innerHTML = '';
  document.getElementById('debugLog').classList.remove('show');
  setStatus('');
}

function setStatus(msg) {
  document.getElementById('statusMsg').innerHTML = msg;
}

function log(msg, type = 'info') {
  const cls = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : 'log-info';
  _debugLines.push(`<span class="${cls}">[${type.toUpperCase()}] ${escHtml(msg)}</span>`);
  const el = document.getElementById('debugLog');
  el.innerHTML = _debugLines.join('\n');
  el.scrollTop = 9999;
}

function toggleDebug() {
  document.getElementById('debugLog').classList.toggle('show');
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildOutput() {
  const meta = {};
  if (_screenName) meta.screenName = _screenName;
  return { ...meta, testcases: filteredTCs() };
}

function copyJSON() {
  const data = JSON.stringify(buildOutput(), null, 2);
  navigator.clipboard.writeText(data)
    .then(() => setStatus('✅ JSON 복사 완료'))
    .catch(() => setStatus('❌ 복사 실패'));
}

function exportCSV() {
  const rows = [];
  if (_screenName) rows.push(['화면명', _screenName]);
  rows.push(['TC ID', '그룹', '테스트 항목', '스텝번호', '레벨', '스텝 내용', '태그']);
  filteredTCs().forEach((tc, ti) => {
    tc.steps.forEach((st, i) => {
      rows.push([
        'TC-' + String(ti + 1).padStart(3, '0'),
        tc.group || '',
        i === 0 ? tc.title : '',
        i + 1,
        st.level === 0 ? '메인' : st.level === 1 ? '하위1' : '하위2',
        st.text,
        i === 0 ? tc.tags.join('|') : ''
      ]);
    });
  });
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = 'egene_tc.csv';
  a.click();
}
