# KOSPI/KOSDAQ Market Visualizer

코스피와 코스닥 전 종목의 현재가, 전일비, 등락률, 거래대금, 매출액, 영업이익,
매출액 증가율, 영업이익 증가율, 외국인비율, PER, 시가총액을 수집하고 정적
대시보드에서 시각화합니다.

## 실행

```powershell
node scripts/update-data.mjs
node scripts/update-data.mjs --charts --chart-days=260
node scripts/serve.mjs
```

브라우저에서 `http://localhost:4173`을 엽니다.

## 웹사이트로 배포

```powershell
node scripts/build-static.mjs
```

생성된 `dist` 폴더를 Netlify, Vercel, GitHub Pages 같은 정적 웹 호스팅에
업로드하면 어느 기기에서나 접속할 수 있습니다.

## 자동 최신화

GitHub Pages 기준 자동 최신화 워크플로가 포함되어 있습니다.

- 설정 파일: `.github/workflows/update-and-deploy.yml`
- 안내 문서: `자동최신화_배포_안내.md`
- 기본 실행 시간: 평일 17:10 KST

GitHub 저장소의 `Settings > Pages`에서 `Source`를 `GitHub Actions`로 설정하면,
예약 시간마다 데이터 수집 후 웹사이트가 자동 배포됩니다.

## 참고

- 목록 데이터: Naver Finance 시장 합산 페이지
- 차트 데이터: Naver Finance 종목별 일봉 API
- `--charts`는 전 종목 일봉을 순차 수집하므로 시간이 걸립니다. 먼저 목록만 수집한 뒤,
  관심 종목 차트가 필요할 때 실행하는 방식을 권장합니다.
