# UCONVERT

문서, 전자책, 이미지, 오디오, 영상, 데이터, 압축 파일을 **브라우저 안에서** 바꾸는 웹앱입니다.
파일은 서버로 올라가지 않고, 서버 비용도 들지 않습니다.

## 지원 변환

| 분류 | 읽기 | 저장 |
|---|---|---|
| 문서 | pdf, docx, odt, rtf, txt, md, html | pdf, docx, odt, rtf, txt, md, html, epub (pdf → png·jpg도 가능) |
| 전자책 | epub, mobi, azw3, fb2, cbz | pdf, epub, docx, html, md, txt 등 문서 형식 전부 |
| 프레젠테이션 | pptx, odp | pdf, docx, html, md, txt (글자만) |
| 이미지 | jpg, png, webp, avif, heic, gif, bmp, tiff, svg, ico | jpg, png, webp, avif, gif, bmp, tiff, ico, svg, pdf |
| 오디오 | mp3, wav, flac, m4a, aac, ogg, opus, wma | mp3, wav, flac, m4a, aac, ogg, opus |
| 영상 | mp4, webm, mov, mkv, avi (gif도 입력 가능) | mp4, webm, mov, mkv, avi, gif + 오디오 추출 |
| 데이터 | xlsx, xls, ods, csv, tsv, json, xml, yaml | xlsx, ods, csv, tsv, json, xml, yaml |
| 압축 | zip, 7z, tar, tar.gz, rar | zip, 7z, tar, tar.gz |

### 알아둘 점
- **DRM**이 걸린 전자책(아마존·리디 등에서 산 책)은 변환할 수 없습니다.
- 암호가 걸린 압축 파일은 암호를 넣으면 풀 수 있습니다. "모든 압축 파일에 같은 암호 적용"을 켜면 목록의 다른 압축 파일과 나중에 추가하는 압축 파일에도 같은 암호를 씁니다. "결과물에도 같은 암호 걸기"를 켜면 ZIP(AES-256)·7Z(파일 목록까지 암호화) 결과물에 같은 암호가 걸립니다. TAR·GZ는 암호를 지원하지 않습니다. 암호는 브라우저 메모리에만 있고 어디에도 저장되지 않습니다.
- MOBI 중 HUFF/CDIC 압축 파일, HWP·DOC(구형 워드)는 아직 지원하지 않습니다.
- PDF → 문서 변환은 **글자만** 가져옵니다(스캔한 PDF는 불가). PPTX → PDF도 글자만 옮깁니다.
- 영상·오디오는 브라우저 내장 인코더(WebCodecs)로 조금씩 읽고 써서 큰 파일도 처리합니다. Chrome·Edge가 가장 빠릅니다.
  AVI·GIF 출력과 일부 코덱은 ffmpeg.wasm을 씁니다(처음 한 번 약 31MB를 CDN에서 받습니다).

## Cloudflare Pages에 올리기

Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → 이 저장소 선택 후:

| 항목 | 값 |
|---|---|
| Production branch | `main` |
| Framework preset | `Vite` (고르면 아래 두 칸이 자동으로 채워짐) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 비워 둠 |
| Environment variables | `NODE_VERSION` = `22` |

그다음 **Save and Deploy**. 이후 `main`에 올릴 때마다 자동으로 다시 배포됩니다.

## 직접 실행

```bash
npm install
npm run dev
```

## 구조

```
src/
  main.js              화면 동작
  formats.js           형식 목록과 변환 가능한 조합
  convert/
    index.js           변환 진입점
    doc/               문서: 읽기(readers) → 공통 HTML → 쓰기(writers, pdf 조판)
    ebook/             EPUB·MOBI/AZW3·FB2 읽기
    image.js           이미지
    media.js           오디오·영상 (Mediabunny, ffmpeg.wasm)
    data.js            표·데이터 (SheetJS 등)
    archive.js         압축 (7-Zip WebAssembly)
public/fonts/          PDF용 나눔 글꼴 (SIL OFL)
```
