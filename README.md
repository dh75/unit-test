# E-GENE Form Analyzer

E-GENE ITSM 폼 페이지를 분석하여 단위 테스트케이스를 자동으로 생성하는 Chrome 확장 프로그램입니다.

---

## 주요 기능

- **폼 자동 캡처** — 현재 탭의 E-GENE 폼 HTML을 캡처
- **필드 자동 분석** — 텍스트, 날짜, 직원검색, 라디오, 체크박스, 에디터, 릴레이션 등 필드 유형 자동 감지
- **동적 필드 추적** — `fnSetCat()` 함수를 파싱하여 라디오 선택에 따라 표시/숨김되는 동적 필드 조건 추출
- **단위 테스트케이스 생성** — 화면에 표시된 필드 순서대로 TC 자동 생성
- **다중 소스 병합** — 라디오 옵션별로 여러 번 캡처한 소스를 병합하여 전체 필드 분석
- **JSON / CSV 내보내기** — 생성된 TC를 JSON 복사 또는 CSV 파일로 저장

---

## 설치 방법

1. 이 저장소를 클론하거나 ZIP으로 다운로드합니다.
2. Chrome 주소창에 `chrome://extensions` 입력
3. 우측 상단 **개발자 모드** 활성화
4. **압축해제된 확장 프로그램을 로드합니다** 클릭 → 다운로드한 폴더 선택

---

## 사용 방법

### 기본 흐름

1. E-GENE ITSM 폼 페이지로 이동
2. Chrome 툴바에서 확장 아이콘 클릭 → 사이드패널 열기
3. **현재 상태 캡처** 버튼 클릭
4. 라디오 옵션이 있는 경우, 각 옵션을 선택한 후 반복해서 캡처
5. **분석 실행** 버튼 클릭
6. 생성된 테스트케이스 확인 후 **JSON 복사** 또는 **CSV** 버튼으로 내보내기

### 다중 캡처 (라디오 옵션별)

라디오 버튼으로 폼 레이아웃이 달라지는 화면의 경우, 각 옵션을 선택한 상태에서 캡처를 반복합니다. 분석 실행 시 여러 소스를 병합하여 전체 필드를 분석합니다.

```
옵션 A 선택 → 캡처 → 옵션 B 선택 → 캡처 → 분석 실행
```

---

## 생성되는 테스트케이스 유형

| 유형 | 설명 |
|---|---|
| 자동 표시 필드 | readonly/자동입력 필드의 표시 여부 확인 |
| 동적 필드 — 라디오 | 라디오 옵션 선택 시 동적 필드/릴레이션 표시 확인 |
| 동적 필드 — 기타 | 조건 기반 표시/숨김 필드 검증 |
| 에디터 | CKEditor 입력, 서식, 저장 검증 |
| 날짜 | 달력 팝업, 형식 유효성 검증 |
| 직원검색 | 검색 팝업 동작 및 선택 반영 확인 |
| 체크박스 | 체크/해제 상태 저장 확인 |
| 필수 검증 | 필수 필드 미입력 시 오류 메시지 확인 |
| 릴레이션 | 행 추가/삭제, 필수 컬럼 검증, 옵션 전체 검증 |
| 버튼 | 폼 내 기능 버튼 동작 검증 |
| E2E | 전체 필수 필드 입력 후 정상 저장 (Happy Path) |

TC는 화면에서 필드가 표시되는 순서대로 나열됩니다.

---

## 파일 구조

```
form-analyzer-ext/
├── manifest.json        # Chrome Extension MV3 설정
├── background.js        # 서비스 워커 (사이드패널 열기)
├── content.js           # 콘텐츠 스크립트 (페이지 HTML 캡처)
├── sidepanel.html       # 사이드패널 UI
├── sidepanel.js         # 사이드패널 UI 로직
├── analyzer.js          # 폼 분석 핵심 로직 (파싱 + TC 생성)
└── icons/               # 확장 아이콘 (16/48/128px)
```

### 모듈 역할

- **`content.js`** — 활성 탭 페이지에서 실행. `CAPTURE_REQUEST` 메시지를 받으면 현재 선택된 라디오 레이블과 `document.documentElement.outerHTML`을 반환
- **`analyzer.js`** — 캡처된 HTML을 DOMParser로 파싱하여 필드, 릴레이션, 버튼, 유효성 검증 규칙, 화면명을 추출하고 TC를 생성
- **`sidepanel.js`** — 소스 목록 관리, 분석 실행, TC 렌더링, JSON/CSV 내보내기

---

## 지원 필드 유형 감지

| E-GENE 구조 | 감지 방법 |
|---|---|
| 일반 텍스트 / textarea | `input[type=text]`, `textarea` |
| 날짜 | `input.edt_date`, `.daterangepicker` 등 |
| 직원검색 | `.text-group input[type=hidden]` + 검색 버튼 |
| 라디오 | `input[type=radio]` 그룹 |
| 체크박스 | `input[type=checkbox]` |
| 드롭다운 | `select` |
| CKEditor | `.ck-content[contenteditable=true]` |
| 트리 선택 (readonly) | `[id^="trdiv_"]` |
| 릴레이션 그리드 | `.uiitem.relation`, `[atom="Relation"]` |
| 자동표시(readonly) | `input.field_ro[disabled]` + 검색 버튼 hidden 여부 |

---

## 주의사항

- E-GENE ITSM 전용으로 설계되었습니다. 다른 시스템의 폼에서는 정상 동작하지 않을 수 있습니다.
- Chrome Manifest V3 기반이므로 Chrome 88 이상에서 동작합니다.
- 캡처는 현재 렌더링된 DOM 기준이므로, AJAX로 로드되는 옵션 데이터는 해당 옵션 선택 후 캡처해야 정확하게 분석됩니다.
