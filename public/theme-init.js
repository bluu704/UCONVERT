// 저장된 테마를 화면이 그려지기 전에 적용 (CSP 때문에 인라인 대신 파일로 둠)
try { var t = localStorage.getItem('uc-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* 저장소 없음 */ }
