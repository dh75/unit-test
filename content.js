// content.js — E-GENE 페이지에서 실행되는 콘텐츠 스크립트

(function () {
  if (window.__egeneAnalyzerInjected) return;
  window.__egeneAnalyzerInjected = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'CAPTURE_REQUEST') return;

    try {
      const mode = msg.mode || 'current';

      if (mode === 'current') {
        sendResponse({
          ok: true,
          sources: [{
            memo: getCurrentRadioLabel() || getScreenName(),
            raw: document.documentElement.outerHTML
          }]
        });

      } else if (mode === 'auto') {
        captureAllRadioStates()
          .then(sources => sendResponse({ ok: true, sources }))
          .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  });

  /* ── 화면명 감지 (analyzer.js detectScreenName과 동일 로직) ── */
  function getScreenName() {
    const formTitle = document.querySelector('.form-header .title');
    if (formTitle) {
      const t = (formTitle.getAttribute('title') || formTitle.textContent).trim();
      if (t) return t;
    }
    const navTitle = document.querySelector('.navBar .history .title');
    if (navTitle) {
      const t = navTitle.textContent.trim();
      if (t) return t;
    }
    return document.title || '캡처';
  }

  /* ── 현재 선택된 라디오 레이블 ── */
  function getCurrentRadioLabel() {
    const radios = getFnSetCatRadios();
    for (const r of radios) {
      if (r.checked) {
        const lb = document.querySelector(`label[for="${r.id}"]`);
        return lb ? lb.textContent.trim() : r.value;
      }
    }
    return null;
  }

  /* ── fnSetCat 라디오 탐색 (onclick/onchange/이벤트리스너 등 통합) ── */
  function getFnSetCatRadios() {
    // 1) onclick/onchange 속성에 fnSetCat이 있는 라디오
    const byAttr = Array.from(document.querySelectorAll(
      'input[type="radio"][onclick*="fnSetCat"], input[type="radio"][onchange*="fnSetCat"]'
    ));
    if (byAttr.length > 0) return byAttr;

    // 2) 같은 name 그룹에서 가장 많은 라디오를 가진 그룹 (분류 선택 라디오로 추정)
    const groups = {};
    document.querySelectorAll('input[type="radio"]').forEach(r => {
      const n = r.name || r.id || '__noname__';
      if (!groups[n]) groups[n] = [];
      groups[n].push(r);
    });
    let biggest = [];
    Object.values(groups).forEach(g => {
      if (g.length > biggest.length) biggest = g;
    });
    return biggest;
  }

  /* ── DOM 변화 감지 대기 ── */
  function waitForDomSettle(timeoutMs = 3000, stableMs = 400) {
    return new Promise(resolve => {
      let timer = null;
      let resolved = false;

      const done = () => {
        if (resolved) return;
        resolved = true;
        observer.disconnect();
        resolve();
      };

      const reset = () => {
        clearTimeout(timer);
        timer = setTimeout(done, stableMs);
      };

      const observer = new MutationObserver(reset);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      // DOM 변화가 없어도 stableMs 후 진행
      reset();

      // 최대 대기 시간 초과 시 강제 진행
      setTimeout(done, timeoutMs);
    });
  }

  /* ── 라디오 옵션 자동 순회 ── */
  async function captureAllRadioStates() {
    const radios = getFnSetCatRadios();

    if (radios.length === 0) {
      return [{ memo: '현재 상태 (라디오 없음)', raw: document.documentElement.outerHTML }];
    }

    const sources = [];
    const originalChecked = radios.find(r => r.checked);

    for (const radio of radios) {
      // 이미 선택된 경우도 click() 호출해서 fnSetCat 재실행
      radio.click();

      // DOM이 안정될 때까지 대기 (AJAX 응답 포함)
      await waitForDomSettle(3000, 400);

      const lb = document.querySelector(`label[for="${radio.id}"]`);
      const memo = lb ? lb.textContent.trim() : (radio.value || radio.id || `옵션${sources.length + 1}`);

      sources.push({
        memo,
        raw: document.documentElement.outerHTML
      });
    }

    // 원래 선택 복원
    if (originalChecked) {
      originalChecked.click();
      await waitForDomSettle(2000, 300);
    }

    return sources;
  }

})();
