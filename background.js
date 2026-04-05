// background.js — 서비스 워커

// 툴바 아이콘 클릭 시 사이드패널 열기
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// content.js → sidepanel.js 메시지 중계
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_DONE') {
    // 캡처 완료 데이터를 사이드패널로 전달
    chrome.runtime.sendMessage(msg);
  }
  if (msg.type === 'CAPTURE_ERROR') {
    chrome.runtime.sendMessage(msg);
  }
});
