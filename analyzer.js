// analyzer.js — 폼 분석 핵심 로직 (sidepanel에서 로드)
'use strict';

const VERSION = 'v1.0';

/* ════════════════════════════════════════
   1. fnSetCat 파싱
════════════════════════════════════════ */
function parseFnSetCat(raw) {
  const showCondMap = {}, allDynamicNames = new Set();
  const fnIdx = raw.indexOf('function fnSetCat');
  if (fnIdx === -1) return { showCondMap, allDynamicNames };

  let depth = 0, started = false, fnBody = '';
  for (let i = fnIdx; i < raw.length; i++) {
    if (raw[i] === '{') { depth++; started = true; }
    if (started) fnBody += raw[i];
    if (raw[i] === '}' && started) { depth--; if (depth === 0) break; }
  }

  const topRe = /(?:show|hide)FormField\(['"]([^'"]+)['"]\)/g;
  let t;
  while ((t = topRe.exec(fnBody)) !== null) allDynamicNames.add(t[1].toLowerCase());

  const ifRe = /(?:else\s+)?if\s*\(\s*cat_cd\s*==\s*['"](\w+)['"]\s*\)/g;
  let m;
  while ((m = ifRe.exec(fnBody)) !== null) {
    const catCd = m[1];
    let blockStart = -1;
    for (let i = m.index + m[0].length; i < fnBody.length; i++) {
      if (fnBody[i] === '{') { blockStart = i; break; }
      if (fnBody[i] !== '\n' && fnBody[i] !== '\r' && fnBody[i] !== ' ' && fnBody[i] !== '\t') break;
    }
    if (blockStart === -1) continue;
    let bdepth = 0, block = '';
    for (let i = blockStart; i < fnBody.length; i++) {
      if (fnBody[i] === '{') bdepth++;
      if (fnBody[i] === '}') bdepth--;
      block += fnBody[i];
      if (bdepth === 0) break;
    }
    const showRe = /showFormField\(['"]([^'"]+)['"]\)/g;
    let s;
    while ((s = showRe.exec(block)) !== null) {
      const fn = s[1].toLowerCase();
      if (!showCondMap[fn]) showCondMap[fn] = [];
      if (!showCondMap[fn].includes(catCd)) showCondMap[fn].push(catCd);
    }
  }
  return { showCondMap, allDynamicNames };
}

/* ════════════════════════════════════════
   2. 필드 추출 (단일 소스)
════════════════════════════════════════ */
function extractFormFields(doc, showCondMap, allDynamicNames) {
  const fields = [];
  doc.querySelectorAll('[frf_name]').forEach(wrap => {
    const frfId   = wrap.getAttribute('frf_id')  || '';
    const fidAttr = wrap.getAttribute('fid')      || '';
    const fname   = wrap.getAttribute('frf_name') || '';
    const key     = fidAttr || frfId;
    if (!key) return;

    const isSys = fname === 'DIVIDER_LINE';
    const labelEl = wrap.querySelector('.field-label');
    const label = (labelEl
      ? labelEl.textContent
      : (wrap.getAttribute('title') || fname || key)
    ).replace(/[*\s]+/g, ' ').trim();

    // 내부 코드명이 레이블로 노출된 필드 제외
    // - 대문자+숫자+언더스코어로만 구성 (예: SRM_ACP_CNT_INFO)
    // - "Field"가 포함된 내부 ID 형태 (예: Field_F401)
    const isCodeLabel = /^[A-Z][A-Z0-9_]{3,}$/.test(label) || /Field/i.test(label);
    if (isCodeLabel && !isSys) return;

    const condKey   = fname.toLowerCase();
    const showConds = showCondMap[condKey] || [];
    const hiddenInSrc = wrap.classList.contains('field_hide')
      || wrap.getAttribute('ui_hidden') === 'true'
      || (wrap.getAttribute('style') || '').replace(/\s/g, '').includes('display:none');
    const isDynamic = hiddenInSrc || showConds.length > 0 || allDynamicNames.has(condKey);

    const required = !!(
      wrap.querySelector('.field_label_require') ||
      wrap.querySelector('input.field_rq, select.field_rq, textarea.field_rq')
    );

    let type = 'text', options = [], relId = '';
    const relDiv  = wrap.querySelector('.uiitem.relation, [atom="Relation"]');
    const radio   = wrap.querySelector('input[type="radio"]');
    const chk     = wrap.querySelector('input[type="checkbox"]');
    const dateEl  = wrap.querySelector('input[name$="_dt"], input[id$="_dt"]');
    const selEl   = wrap.querySelector('select');
    const taEl    = wrap.querySelector('textarea');
    const ckDiv   = wrap.querySelector('.ckeditor, .ck-editor, .ck-content');
    const treeDiv = wrap.querySelector('[id^="trdiv_"]');

    // readonly/disabled 감지
    // 1) input.field_ro + disabled → 시스템 자동입력 (예: 현업담당자)
    const hasFieldRoDisabled = !!(
      wrap.querySelector('input.field_ro[disabled]') ||
      (wrap.querySelector('input.field_ro') && wrap.querySelector('input[disabled]'))
    );
    // 2) employee 타입인데 검색버튼이 display:none → 검색 불가, 자동표시 전용
    const searchBtn = wrap.querySelector('.atom-group-prepend.atom-group-prepend, .btn-search, .atom-group-prepend');
    const searchBtnHidden = searchBtn
      ? (searchBtn.getAttribute('style') || '').replace(/\s/g, '').includes('display:none')
      : false;
    // 3) 트리 필드는 표시 전용 (reloadField로 AJAX 세팅, 사용자가 직접 선택 안함)
    const isTreeReadonly = !!treeDiv;

    const isReadonly = hasFieldRoDisabled || (searchBtnHidden && !!wrap.querySelector('.text-group input[type="hidden"]')) || isTreeReadonly;

    if (relDiv) {
      type = 'relation';
      const rm = (relDiv.getAttribute('page') || '').match(/rlt_id=([^&"]+)/);
      relId = rm ? rm[1] : '';
    } else if (treeDiv) {
      type = 'tree';
      // ETrees script에서 노드 목록 추출
      const scriptEl = wrap.querySelector('script');
      if (scriptEl) {
        const re = /\.add\s*\(\s*'[^']+'\s*,\s*'([^']+)'\s*,\s*'([^']*)'\s*\)/g;
        let m;
        while ((m = re.exec(scriptEl.textContent)) !== null) {
          const nodeText = m[1], parentId = m[2];
          if (!parentId) options.push({ value: nodeText, text: nodeText, isRoot: true });
          else options.push({ value: nodeText, text: nodeText, isRoot: false });
        }
      }
    } else if (radio) {
      type = 'radio';
      wrap.querySelectorAll('input[type="radio"]').forEach(r => {
        const lb = wrap.querySelector('label[for="' + r.id + '"]');
        const evAttr = (r.getAttribute('onclick') || '') + (r.getAttribute('onchange') || '');
        const catM = evAttr.match(/fnSetCat\s*\(\s*['"](\w+)['"]/);
        const text = lb ? lb.textContent.trim() : r.value;
        if (text) options.push({ value: r.value, text, catCd: catM ? catM[1] : r.value });
      });
    } else if (chk) {
      type = 'checkbox';
    } else if (dateEl) {
      type = 'date';
    } else if (selEl) {
      type = 'select';
      selEl.querySelectorAll('option').forEach(o => {
        if (o.value) options.push({ value: o.value, text: o.textContent.trim() });
      });
    } else if (wrap.querySelector('.uiitem .text-group input[type="hidden"]')) {
      type = 'employee';
    } else if (ckDiv) {
      // CKEditor만 editor 타입 — textarea는 일반 text
      type = 'editor';
    } else if (taEl) {
      type = 'text';
    }

    // 에디터 기본 템플릿 텍스트 감지 (CKEditor, contenteditable인 경우만)
    let defaultText = '';
    const ckEditable = wrap.querySelector('.ck-content[contenteditable="true"]');
    if (ckEditable) {
      const txt = (ckEditable.innerText || ckEditable.textContent || '').trim();
      if (txt.length > 1) defaultText = txt;
    }

    // 필드 안내 문구 감지
    // - .frm_comment 영역
    // - CKEditor가 없는데 ck-content(읽기전용)나 span 텍스트만 있는 경우 → comment로 처리
    const commentSpan = wrap.querySelector('.frm_comment span');
    const commentDiv  = wrap.querySelector('.frm_comment');
    let comment = (commentSpan || commentDiv)
      ? (commentSpan || commentDiv).textContent.trim()
      : '';

    // CKEditor가 없고 type이 editor로 잘못 감지된 경우: span/읽기전용 텍스트를 comment로
    if (!ckEditable && ckDiv) {
      const ckAny = wrap.querySelector('.ck-content');
      const spanTxt = ckAny
        ? (ckAny.innerText || ckAny.textContent || '').trim()
        : wrap.querySelector('span')?.textContent.trim() || '';
      if (spanTxt.length > 1) {
        comment = comment || spanTxt;
        type = 'text'; // editor 타입 해제
      }
    }

    fields.push({
      fid: key, name: fname,
      label: isSys ? '[구분선]' : label,
      type: isSys ? 'divider' : type,
      required, isDynamic, isReadonly, options, relId, showConds, isSys,
      defaultText, comment,
      _visibleInSrc: !hiddenInSrc
    });
  });
  return fields;
}

/* ════════════════════════════════════════
   3. 밸리데이션 규칙 추출
════════════════════════════════════════ */
function extractValidations(raw) {
  const result = {};

  function extractAlerts(body) {
    const msgs = [];
    const re = /(?:\$egene\.)?alert\s*\(\s*["'`]([^"'`]+)["'`]/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const msg = m[1].trim();
      if (msg.startsWith('Error') || msg.includes('세션') || msg.includes('파일이')) continue;
      msgs.push(msg);
    }
    return msgs;
  }

  function extractFnBody(src, fnName) {
    const idx = src.indexOf(fnName);
    if (idx === -1) return '';
    let braceStart = -1;
    for (let i = idx + fnName.length; i < Math.min(idx + fnName.length + 200, src.length); i++) {
      if (src[i] === '{') { braceStart = i; break; }
    }
    if (braceStart === -1) return '';
    let depth = 0, body = '';
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') depth--;
      body += src[i];
      if (depth === 0) break;
    }
    return body;
  }

  const validateRe = /validateField_(F\d+)\s*=\s*function/g;
  let m;
  while ((m = validateRe.exec(raw)) !== null) {
    const fid = 'Field_' + m[1];
    const body = extractFnBody(raw, m[0]);
    if (!result[fid]) result[fid] = { requireMsgs: [], validateMsgs: [], isRelationValidated: false };
    if (body.includes('relation_validate')) result[fid].isRelationValidated = true;
    else result[fid].validateMsgs.push(...extractAlerts(body));
  }

  const requireRe = /checkRequireField_(F\d+)\s*=\s*function/g;
  while ((m = requireRe.exec(raw)) !== null) {
    const fid = 'Field_' + m[1];
    const body = extractFnBody(raw, m[0]);
    if (!result[fid]) result[fid] = { requireMsgs: [], validateMsgs: [], isRelationValidated: false };
    if (body.includes('relation_check_require')) {
      result[fid].isRelationValidated = true;
    } else {
      result[fid].requireMsgs.push(...extractAlerts(body));
    }
  }

  return result;
}

/* ════════════════════════════════════════
   4. 릴레이션 컬럼 추출
════════════════════════════════════════ */
function extractRelationColumns(doc, fields) {
  const relations = [];
  fields.filter(f => f.type === 'relation').forEach(rf => {
    const container = doc.querySelector('#' + rf.fid) || doc.querySelector('[fid="' + rf.fid + '"]');
    const cols = [];
    if (container) {
      const headerCols = [];
      container.querySelectorAll('.scroll-columns .rel-row-sub').forEach(hdr => {
        const centerEl = hdr.querySelector('.rel-row-sub-center');
        const text = (centerEl ? centerEl.textContent : hdr.textContent).replace(/\*/g, '').trim();
        if (text) headerCols.push({ label: text, required: !!(hdr.querySelector('.grid_header_lb_require')) });
      });
      const dataRow = container.querySelector('.data-area .data, .rel-bottom .data');
      if (dataRow) {
        dataRow.querySelectorAll('.rel-row-sub-data').forEach((td, i) => {
          const fid2  = td.getAttribute('fid') || '';
          const alias = td.getAttribute('alias') || fid2 || '';
          let colType = 'text', colOpts = [];
          const sel = td.querySelector('select');
          const emp = td.querySelector('.atom-entity-employee') || td.querySelector('.uiitem .text-group input[type="hidden"]');
          const dtEl = td.querySelector('input[name$="_dt"], input[id$="_dt"]');
          if (sel) {
            colType = 'select';
            sel.querySelectorAll('option').forEach(o => { if (o.value) colOpts.push({ value: o.value, text: o.textContent.trim() }); });
          } else if (emp) {
            colType = 'employee';
          } else if (dtEl) {
            colType = 'date';
          }
          const hdr = headerCols[i];
          cols.push({
            label: hdr ? hdr.label : (alias || fid2), fid: fid2, alias,
            required: hdr ? hdr.required : td.classList.contains('field_rq'),
            type: colType, options: colOpts
          });
        });
      }
      if (cols.length === 0 && headerCols.length) {
        headerCols.forEach(h => cols.push({ label: h.label, fid: '', alias: '', required: h.required, type: 'unknown', options: [] }));
      }
    }
    relations.push({
      fid: rf.fid, name: rf.name, label: rf.label,
      relId: rf.relId, isDynamic: rf.isDynamic, showConds: rf.showConds,
      columns: cols, hasData: cols.some(c => c.type !== 'unknown'),
      _visibleInSrc: rf._visibleInSrc
    });
  });
  return relations;
}

/* ════════════════════════════════════════
   5. 다중 소스 머지
════════════════════════════════════════ */
function mergeSources(parsed, logFn) {
  const log = logFn || (() => {});
  let allFields = [], allRelations = [];
  const warnings = [];

  const formIds = [...new Set(parsed.map(p => p.formId).filter(Boolean))];
  if (formIds.length > 1) {
    warnings.push(`소스 간 폼 ID가 다릅니다: ${formIds.join(', ')}`);
  }

  const screenName = parsed.map(p => p.screenName).find(s => s) || '';

  const fieldMap = new Map();
  parsed.forEach(p => {
    p.fields.forEach(f => {
      if (fieldMap.has(f.fid)) {
        const ex = fieldMap.get(f.fid);
        if (f.options.length > ex.options.length) ex.options = f.options;
        if (f.required) ex.required = true;
        if (f._visibleInSrc) ex._visibleEver = true;
        if (f.defaultText && !ex.defaultText) ex.defaultText = f.defaultText;
        if (f.comment && !ex.comment) ex.comment = f.comment;
      } else {
        fieldMap.set(f.fid, { ...f, _visibleEver: f._visibleInSrc });
      }
    });
  });

  const before = fieldMap.size;
  // 한 번이라도 실제로 화면에 표시된 필드만 포함 (divider/hidden 시스템 필드 제외)
  allFields = [...fieldMap.values()].filter(f =>
    f.isSys || f.type === 'hidden' || f.type === 'divider' || f._visibleEver === true
  );
  const removed = before - allFields.length;
  if (removed > 0) log(`자동 제외: 한 번도 표시되지 않은 필드 ${removed}개`, 'info');

  const relMap = new Map();
  parsed.forEach(p => {
    p.relations.forEach(rel => {
      if (relMap.has(rel.fid)) {
        const ex = relMap.get(rel.fid);
        if (rel._visibleInSrc) ex._visibleEver = true;
        if (rel.hasData && !ex.hasData) {
          ex.columns = rel.columns; ex.hasData = true;
        } else if (rel.hasData && ex.hasData) {
          rel.columns.forEach((rc, i) => {
            if (ex.columns[i]) {
              if (rc.options.length > ex.columns[i].options.length) ex.columns[i].options = rc.options;
              if (rc.type !== 'unknown') ex.columns[i].type = rc.type;
            }
          });
        }
      } else {
        relMap.set(rel.fid, { ...rel, _visibleEver: rel._visibleInSrc });
      }
    });
  });
  // 한 번이라도 화면에 표시된 릴레이션만 포함
  allRelations = [...relMap.values()].filter(r => r._visibleEver === true);

  const valMap = {};
  parsed.forEach(p => {
    Object.entries(p.validations || {}).forEach(([fid, v]) => {
      if (!valMap[fid]) valMap[fid] = { requireMsgs: [], validateMsgs: [], isRelationValidated: false };
      v.requireMsgs.forEach(m => { if (!valMap[fid].requireMsgs.includes(m)) valMap[fid].requireMsgs.push(m); });
      v.validateMsgs.forEach(m => { if (!valMap[fid].validateMsgs.includes(m)) valMap[fid].validateMsgs.push(m); });
      if (v.isRelationValidated) valMap[fid].isRelationValidated = true;
    });
  });
  allFields.forEach(f => { f.validation = valMap[f.fid] || null; });
  allRelations.forEach(r => { r.validation = valMap[r.fid] || null; });

  // 버튼 머지 (text 기준 중복 제거)
  const btnMap = new Map();
  parsed.forEach(p => {
    (p.buttons || []).forEach(b => {
      if (!btnMap.has(b.text)) btnMap.set(b.text, b);
    });
  });
  const allButtons = [...btnMap.values()];

  log(`머지 결과: 필드 ${allFields.length}개, 릴레이션 ${allRelations.length}개, 버튼 ${allButtons.length}개`, 'ok');
  return { allFields, allRelations, allButtons, warnings, screenName };
}

/* ════════════════════════════════════════
   6. 폼 ID 감지
════════════════════════════════════════ */
function detectFormId(raw) {
  const m = raw.match(/form_id\s*[=:]\s*['"]?([A-Za-z0-9_\-]+)['"]?/);
  if (m) return m[1];
  const m2 = raw.match(/<form[^>]+id=['"]([^'"]+)['"]/i);
  if (m2) return m2[1];
  return raw.includes('fnSetCat') ? '__egene__' : '';
}

/* ════════════════════════════════════════
   7. TC 생성
════════════════════════════════════════ */
function genTCs(allFields, allRelations, allButtons = []) {
  const tcs = []; let id = 1;

  function s(text, level = 0) { return { text, level }; }
  function colStep(c, level = 1) {
    if (c.type === 'select' && c.options.length) return s(`[${c.label}] 드롭다운에서 "${c.options[0].text}" 선택`, level);
    if (c.type === 'employee') return s(`[${c.label}] 직원 검색 팝업에서 선택`, level);
    if (c.type === 'date')     return s(`[${c.label}] 날짜 선택`, level);
    return s(`[${c.label}] 값 입력`, level);
  }
  function valSteps(f, level = 1) {
    const steps = [];
    const v = f.validation;
    if (!v) return steps;
    v.requireMsgs.forEach(msg => steps.push(s(`미입력 저장 → "${msg}" 확인`, level)));
    v.validateMsgs
      .filter(msg => !v.requireMsgs.includes(msg))
      .forEach(msg => steps.push(s(`유효하지 않은 값 입력 → "${msg}" 확인`, level)));
    return steps;
  }

  // 릴레이션 label → rel 객체 빠른 조회용
  const relByLabel = {};
  allRelations.forEach(r => { relByLabel[r.label] = r; });

  // 이미 TC를 생성한 릴레이션 추적 (중복 방지)
  const emittedRels = new Set();

  function emitRelTC(rel) {
    if (emittedRels.has(rel.label)) return;
    emittedRels.add(rel.label);
    const actTxt = rel.isDynamic
      ? `해당 분류 선택 후 [${rel.label}] 섹션 활성화 확인`
      : `[${rel.label}] 섹션 표시 확인`;
    if (!rel.columns.length) {
      tcs.push({
        id: id++, group: `릴레이션 — ${rel.label}`, title: '기본 동작 검증',
        steps: [s(actTxt), s('"추가" 클릭 → 새 행 생성'), s('필수 컬럼 미입력 저장 → 오류 확인', 1), s('행 체크 후 "삭제" → 행 제거'), s('저장 후 데이터 정합성 확인')],
        tags: ['릴레이션', '기능검증']
      }); return;
    }
    tcs.push({
      id: id++, group: `릴레이션 — ${rel.label}`, title: '정상 입력 (Happy Path)',
      steps: [s(actTxt), s('"추가" 버튼 클릭 → 새 행 생성'), ...rel.columns.map(c => colStep(c, 1)), s('저장 후 행 데이터 정합성 확인')],
      tags: ['릴레이션', 'HappyPath']
    });
    const reqCols = rel.columns.filter(c => c.required);
    if (reqCols.length)
      tcs.push({
        id: id++, group: `릴레이션 — ${rel.label}`, title: '필수 컬럼 미입력 검증',
        steps: [s(actTxt), s('"추가" 클릭 → 새 행 생성'), ...reqCols.map(c => s(`[${c.label}] 미입력 상태 유지`, 1)), s('저장 → 필수 항목 오류 메시지 확인')],
        tags: ['릴레이션', '필수검증', 'Negative']
      });
    if (rel.validation?.isRelationValidated)
      tcs.push({
        id: id++, group: `릴레이션 — ${rel.label}`, title: '릴레이션 정합성 검증',
        steps: [s(actTxt), s('"추가" 클릭 → 새 행 생성'), s('필수 컬럼 입력 후 저장'), s('저장된 행 데이터 서버 정합성 확인', 1), s('저장 실패 시 오류 메시지 확인', 1)],
        tags: ['릴레이션', '정합성검증', 'Negative']
      });
    tcs.push({
      id: id++, group: `릴레이션 — ${rel.label}`, title: '행 추가/삭제',
      steps: [s(actTxt), s('"추가" 클릭 → 새 행 생성 확인'), s('행 체크박스 선택 후 "삭제" 클릭 → 행 제거 확인', 1), s('저장 후 삭제 반영 확인')],
      tags: ['릴레이션', '기능검증']
    });
    rel.columns.filter(c => c.type === 'select' && c.options.length > 1).forEach(sc => {
      tcs.push({
        id: id++, group: `릴레이션 — ${rel.label}`, title: `[${sc.label}] 전체 옵션 검증`,
        steps: sc.options.map(o => s(`"${o.text}" 선택 후 저장 → 정상 저장 확인`)),
        tags: ['릴레이션', '옵션검증']
      });
    });
  }

  // 화면 순서대로 각 필드의 TC 생성
  const radioFields = allFields.filter(f => f.type === 'radio' && f.options.length);

  allFields.forEach(f => {
    if (f.isSys || f.type === 'hidden' || f.type === 'divider') return;

    // 릴레이션 필드 → 릴레이션 TC
    if (f.type === 'relation') {
      const rel = relByLabel[f.label];
      if (rel) emitRelTC(rel);
      return;
    }

    // 자동 표시 (readonly) 필드
    if (f.isReadonly) {
      let stepText;
      if (f.type === 'tree') stepText = `[${f.label}] 선택된 분류 값이 텍스트로 올바르게 표시되는지 확인`;
      else if (f.type === 'employee') stepText = `[${f.label}] 로그인 사용자 정보가 자동으로 표시되는지 확인`;
      else stepText = `[${f.label}] 시스템 값이 자동 표시되는지 확인`;
      tcs.push({
        id: id++, group: '자동 표시 필드',
        title: `[${f.label}] 자동 표시 확인`,
        steps: [s(stepText)],
        tags: ['자동표시', 'UI확인']
      });
      return;
    }

    // 라디오 필드 → 옵션별 동적 동작 TC
    if (f.type === 'radio' && f.options.length) {
      f.options.forEach(opt => {
        const matchKey = opt.catCd || opt.value;
        const rels = allRelations.filter(r => r.showConds && r.showConds.includes(matchKey));
        const dynFields = allFields.filter(df => df.isDynamic && !df.isSys && df.type !== 'relation'
          && df.showConds && df.showConds.includes(matchKey));

        const steps = [s(`[${f.label}]에서 "${opt.text}" 선택`)];
        dynFields.forEach(df => steps.push(s(`동적 필드 [${df.label}] 표시 확인`, 1)));
        if (rels.length === 0) {
          steps.push(s('이전에 표시됐던 릴레이션 섹션 모두 숨김 확인', 1));
        } else {
          rels.forEach(rel => {
            steps.push(s(`릴레이션 섹션 [${rel.label}] 표시 확인`, 1));
            rel.columns.forEach(c => steps.push(colStep(c, 2)));
            const reqCols = rel.columns.filter(c => c.required);
            if (reqCols.length) steps.push(s(`필수 컬럼(${reqCols.map(c => c.label).join(', ')}) 미입력 시 오류 확인`, 2));
          });
        }
        steps.push(s('나머지 필수 필드 입력 후 저장'));
        tcs.push({
          id: id++, group: '동적 필드 — 라디오',
          title: `[${f.label}] "${opt.text}" 선택 시 동작`,
          steps, tags: ['동적필드', '라디오', '기능검증']
        });
      });
      return;
    }

    // 동적 필드 (showConds 없는 기타)
    if (f.isDynamic && !(f.showConds && f.showConds.length)) {
      tcs.push({
        id: id++, group: '동적 필드 — 기타',
        title: `[${f.label}] 표시/숨김 검증`,
        steps: [s(`[${f.label}] 활성화 조건 충족 시 표시 / 비활성화 시 숨김 확인`)],
        tags: ['동적필드', '기능검증']
      });
      return;
    }

    // 에디터 필드
    if (f.type === 'editor') {
      const dt = f.defaultText || '';
      const cm = f.comment || '';
      const dtShort = dt.length > 60 ? dt.slice(0, 60) + '…' : dt;
      tcs.push({
        id: id++, group: '개별 필드', title: `에디터 [${f.label}] 입력 검증`,
        steps: [
          ...(dt ? [s(`화면 진입 시 기본 템플릿 텍스트 표시 확인: "${dtShort}"`)] : []),
          s('에디터 클릭 후 텍스트 입력'),
          s('굵게/기울임/색상 서식 적용 확인', 1),
          s(f.required ? '미입력 저장 → 오류 확인' : '빈 저장 정상 처리 확인'),
          ...valSteps(f),
          s('저장 후 내용 보존 확인'),
          ...(cm ? [s(`필드 안내 문구 표시 확인: "${cm}"`)] : [])
        ],
        tags: ['에디터', '기능검증']
      });
      return;
    }

    // 날짜 필드
    if (f.type === 'date') {
      tcs.push({
        id: id++, group: '개별 필드', title: `날짜 [${f.label}] 유효성`,
        steps: [
          s('달력 아이콘 클릭 → 팝업 표시 확인'),
          s('정상 날짜 선택 → 입력란 반영 확인'),
          ...(f.validation?.validateMsgs.length
            ? f.validation.validateMsgs.map(msg => s(`잘못된 형식 입력 → "${msg}" 확인`, 1))
            : [s('잘못된 형식 직접 입력(예: 20251332) → 오류 처리 확인', 1)]),
          s(f.required ? '미입력 후 저장 → 오류 확인' : '빈 상태 저장 정상 처리 확인'),
          ...valSteps(f).filter(vs => !f.validation?.validateMsgs.some(m => vs.text.includes(m)))
        ],
        tags: ['날짜', '유효성']
      });
      return;
    }

    // 직원검색 필드
    if (f.type === 'employee') {
      tcs.push({
        id: id++, group: '개별 필드', title: `직원검색 [${f.label}] 동작 검증`,
        steps: [
          s('검색 아이콘 클릭 → 팝업 표시 확인'),
          s('이름/사번으로 검색 후 선택 → 필드 반영 확인', 1),
          s('선택 후 X(초기화) 클릭 → 값 제거 확인', 1),
          ...valSteps(f),
          s(f.required ? '미선택 저장 → 오류 확인' : '미선택 저장 정상 처리 확인')
        ],
        tags: ['직원검색', '기능검증']
      });
      return;
    }

    // 체크박스 필드
    if (f.type === 'checkbox') {
      tcs.push({
        id: id++, group: '개별 필드', title: `체크박스 [${f.label}] 동작 검증`,
        steps: [
          s(`[${f.label}] 체크 → 값 1 반영 확인`),
          s(`[${f.label}] 해제 → 값 0 반영 확인`),
          ...valSteps(f),
          s('체크 상태로 저장 후 재조회 → 값 유지 확인', 1)
        ],
        tags: ['체크박스', '기능검증']
      });
      return;
    }

    // 유효성 검증 있는 일반 필드
    if (f.validation && f.validation.validateMsgs.length > 0) {
      const cm = f.comment || '';
      tcs.push({
        id: id++, group: '개별 필드', title: `[${f.label}] 입력 유효성 검증`,
        steps: [
          s(`[${f.label}] 정상 값 입력 후 저장 → 정상 처리 확인`),
          ...f.validation.validateMsgs.map(msg => s(`유효하지 않은 값 입력 → "${msg}" 확인`, 1)),
          ...(f.required && f.validation.requireMsgs.length
            ? f.validation.requireMsgs.map(msg => s(`미입력 저장 → "${msg}" 확인`, 1))
            : []),
          ...(cm ? [s(`필드 안내 문구 표시 확인: "${cm}"`)] : [])
        ],
        tags: ['유효성검증', 'Negative']
      });
      return;
    }

    // 필수 필드 (단독 미입력 검증)
    if (f.required) {
      tcs.push({
        id: id++, group: '필수 검증',
        title: `[${f.label}] 필수 입력 검증`,
        steps: [
          s(`[${f.label}] 미입력 후 저장`),
          ...(f.validation?.requireMsgs.length
            ? f.validation.requireMsgs.map(msg => s(`"${msg}" 오류 메시지 확인`, 1))
            : [s('필수 오류 메시지 확인', 1)])
        ],
        tags: ['필수검증', 'Negative']
      });
      return;
    }

    // 안내 문구만 있는 필드
    if (f.comment && f.comment.length > 0 && f.type !== 'editor') {
      tcs.push({
        id: id++, group: '개별 필드', title: `[${f.label}] 안내 문구 표시 확인`,
        steps: [s(`필드 [${f.label}] 하단 안내 문구 표시 확인: "${f.comment}"`)],
        tags: ['UI확인']
      });
      return;
    }
  });

  // 아직 생성 안 된 릴레이션 (relation 타입 필드가 없는 경우 대비)
  allRelations.forEach(rel => emitRelTC(rel));

  // 버튼 TC
  allButtons.forEach(btn => {
    tcs.push({
      id: id++, group: '버튼',
      title: `[${btn.text}] 버튼 동작 검증`,
      steps: [
        s(`[${btn.text}] 버튼 클릭`),
        s('버튼 클릭 후 예상 동작 수행 확인', 1),
        s('처리 완료 메시지 또는 화면 전환 확인', 1)
      ],
      tags: ['버튼', '기능검증']
    });
  });

  // E2E
  const reqFields = allFields.filter(f => f.required && !f.isSys && f.type !== 'hidden');
  tcs.push({
    id: id++, group: 'E2E', title: '전체 정상 저장 (Happy Path)',
    steps: [
      ...reqFields.filter(f => !f.isDynamic && f.type !== 'relation').map(f => s(`[${f.label}] 값 입력`)),
      ...(radioFields.length ? [s(`[${radioFields[0].label}] 분류 선택`), s('연관 섹션 활성화 확인', 1)] : []),
      ...(allRelations.length ? [s('릴레이션 행 최소 1건 입력'), s('릴레이션 컬럼 전체 입력 후 행 저장', 1)] : []),
      s('"저장" 또는 "승인요청" 클릭'),
      s('성공 메시지 및 저장 결과 확인', 1)
    ],
    tags: ['E2E', 'HappyPath']
  });

  return tcs;
}

/* ════════════════════════════════════════
   8. 주요 버튼 추출
════════════════════════════════════════ */
function extractButtons(doc) {
  const buttons = [];

  // 폼 필드 내부의 .button-small-action 중 릴레이션 컨테이너 밖에 있는 것만
  doc.querySelectorAll('.btn-group button.button-small-action').forEach(btn => {
    // 릴레이션 컨테이너 내부면 제외
    if (btn.closest('.uiitem.relation, [atom="Relation"]')) return;
    const text = (btn.getAttribute('title') || btn.textContent).trim();
    if (text) buttons.push({ text });
  });

  return buttons;
}

/* ════════════════════════════════════════
   9. 화면명 추출
════════════════════════════════════════ */
function detectScreenName(doc) {
  // 1순위: form-header .title
  const formTitle = doc.querySelector('.form-header .title');
  if (formTitle) {
    const t = formTitle.getAttribute('title') || formTitle.textContent;
    const s = t.trim();
    if (s) return s;
  }

  // 2순위: navBar .history 의 마지막 .title
  const navTitle = doc.querySelector('.navBar .history .title');
  if (navTitle) {
    const s = navTitle.textContent.trim();
    if (s) return s;
  }

  return '';
}

/* ════════════════════════════════════════
   9. 단일 소스 파싱 (파이프라인)
════════════════════════════════════════ */
function parseSource(raw, label) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const formId = detectFormId(raw);
  const screenName = detectScreenName(doc);
  const { showCondMap, allDynamicNames } = parseFnSetCat(raw);
  const fields = extractFormFields(doc, showCondMap, allDynamicNames);
  const relations = extractRelationColumns(doc, fields);
  const validations = extractValidations(raw);
  const buttons = extractButtons(doc);
  return { formId, screenName, fields, relations, validations, buttons, label };
}
