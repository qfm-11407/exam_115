# OneWord 網頁版部署：GitHub Pages ＋ GAS ＋ Drive

不用教師電腦啟動 Node.js，也不用學生連教師電腦 IP。GitHub Pages 提供網頁；GAS 接收交卷、存圖並呼叫 AI；圖片屬於部署 GAS 的教師帳號。

## 更新至 2.12.0

本次需更新 GitHub 網頁及 GAS Code.gs、Student HTML，並將原部署更新為新版本。教師台應顯示「網頁 v2.12.0 · GAS 2.12.0」。詳見 [UPDATE_2.12.0.md](UPDATE_2.12.0.md)。

## 尚未升級至 GAS 2.9.0

請先看 [UPDATE_2.9.0.md](UPDATE_2.9.0.md)。本次新增整場自動測驗、教師題數設定、成語不重複與最終總成績，除了上傳網頁，也必須更新原 GAS 專案的 Code.gs 與 Student HTML，再於原部署選「新版本」。GAS 金鑰、教師登入碼與 Drive 資料夾設定會保留，不需重新初始化。

## 一、上傳 GitHub Pages

解壓 `oneword-github-test.zip`，把裡面的內容上傳到獨立測試儲存庫根目錄。不要只上傳 ZIP 本身。

到 **GitHub 儲存庫 → Settings → Pages → Deploy from a branch**，選發布分支（例如 main），資料夾選 **/(root)**，儲存，等待 GitHub 顯示網站網址。GitHub Free 通常須使用公開儲存庫。

也可以把內容放在目前儲存庫的 `oneword/` 下，再以儲存庫根目錄發布。相對網址支援子資料夾。若使用目前的 `qfm-11407/classboard-807`，預期路徑是 `https://qfm-11407.github.io/classboard-807/oneword/`；這是部署位置範例，不表示已發布。

## 二、建立 GAS 後端

1. 使用要保存圖片的教師 Google 帳號，前往 https://script.google.com/ 建立專案。
2. 貼上 `gas/Code.gs` 全文。
3. 新增 **HTML** 檔，名稱填 `Bridge`，貼上 `gas/Bridge.html` 全文；另新增名為 `Student` 的 HTML，貼上 `gas/Student.html` 全文。
4. 在專案設定顯示 appsscript.json，將 `gas/appsscript.json` 貼入。
5. 在 **專案設定 → 指令碼屬性（Script Properties）** 設定：

| 屬性 | 內容 |
|---|---|
| ALLOWED_ORIGINS | 網站來源，例如 `https://qfm-11407.github.io`，不要加儲存庫路徑；多個來源用逗號分隔 |
| TEACHER_PIN | 至少 8 字元的教師登入碼；不設定則由初始化產生 |
| DRIVE_FOLDER_ID | 選填，未公開分享的私人資料夾 ID；不設定則自動建立 |
| OPENAI_API_KEY | 選填，可稍後在教師網頁設定 |
| OPENAI_MODEL | 選填，預設 `gpt-4.1-mini`，須有帳號使用權限 |

6. 在編輯器選擇並執行 `setup_`，首次依 Google 畫面授權 Drive 與外部 API 存取。
7. 執行紀錄會顯示資料夾與教師登入碼；請勿公開到 GitHub。

不需 Google 試算表。活動房間狀態持久保存在 GAS Script Properties，於開題、收卷、公布、結束及切換時備份至私人 Drive JSON，手寫圖片另存 PNG。請勿公開分享 Drive 資料夾。

## 三、部署與連線

**目前更新包已在 `config.js` 預設本教室的正式 GAS 部署網址，可直接進入教師端或學生端，無須在首頁重新設定。** 下列步驟供首次建立或更換後端時使用。更新既有 GAS 部署的新版本會沿用原網址；不要另建部署後忘記同步設定檔。支援一般 `/macros/s/…/exec` 與校務帳號 `/a/macros/網域/s/…/exec` 網址格式。

1. **部署 → 新增部署作業 → 網頁應用程式**。
2. **執行身分：我**；**誰可以存取：任何人**，讓學生用學號加入，不必授權自己的 Drive。
3. 若校務 Workspace 沒有「任何人」選項，請學校管理員確認可用部署方式；此免登入橋接版不能假設所有網域都允許。
4. 複製正式部署網址 `https://script.google.com/macros/s/部署ID/exec`，不要用 `/dev`。
5. 填入 GitHub 的 `config.js`：

```js
export const config = {
  gasUrl: 'https://script.google.com/macros/s/部署ID/exec',
  pollMs: 3500,
};
```

或在網頁首頁「教室雲端後端 → 檢查或變更雲端連線」貼上並測試。教師分享連結會攜帶公開的後端網址，學生不必各自設定。GAS 網址不是 API 金鑰。

6. 使用預設後端時直接進教師台輸入教師登入碼；需要檢查連線或更換網址時，再展開首頁進階設定按「儲存並測試連線」。
7. 之後修改 GAS，須到 **管理部署作業 → 編輯 → 新版本 → 更新**；只儲存程式不會更新 `/exec`。

## 四、第一場測試

1. 教師建立「流程演練」房間。**演練不辨識筆跡**：加入順序為 3 的倍數者顯示錯，其餘顯示對；所有畫面均標示演練，API 用量為 0。
2. 複製平板作答網址，學生開啟教師分享的 GAS 直連作答網址，輸入允許的學號加入；同房間防重複學號。
3. 教師開啟大螢幕頁 `screen.html?room=房號`，確認隨機成語填空題後開始。
4. 學生在格內寫一個字，截止前按送出。確認 Drive 的本場／本題資料夾出現以學號命名的 PNG。
5. 截止後展示筆跡，判讀完成後統一揭曉 ✓／✗，測試排名與 CSV。
6. 演練成功後設定 AI 金鑰，再建立「AI 正式判讀」新房間；演練成績不混用。

## 五、運作與限制

- 先存圖再確認交卷；存圖失敗保留筆跡，原平板可重試。圖片摘要與身分權杖避免同一題換答案或重複建檔。
- 學生送出後會嘗試啟動自己的背景判讀；教師頁持續處理其他等待答案。最多同時 1～3 份，預設 2 份。
- **教師控制頁保持開啟，大螢幕建議另開視窗。** 瀏覽器可能暫停長時間背景分頁，影響等待佇列的處理速度。
- 約每 3.5～4.3 秒更新狀態；倒數本機顯示，截止以 GAS 時間為準。本版不是即時推播。
- 截止前不提供筆跡、正解、判定及本題得分。截止後經 GAS 取得圖片資料，不使用公開 Drive 圖片連結。
- 不確定字跡自動再判一次。服務失敗或仍無法確認者可在揭曉前重試；揭曉後顯示「無法判定」，不強行判錯。
- 揭曉、重看及重新整理不會重判已成功答案；失敗請求計費以服務商帳單為準。
- GAS 有每位使用者同時執行、單次執行時間及每日配額限制。30 人集中上傳加上判讀與輪詢可能觸及限制；有短鎖、錯開輪詢與交卷重試，但不保證 30 人無延遲，需校內分批擴測。
- GitHub Pages 與 GAS 仍受帳號方案、服務配額約束；Drive 圖片占用容量，AI API 另計費。不需要為本功能升級 Firebase Storage，但不能視為整套永遠免費。
- 金鑰留在 GAS Script Properties；學生學號、暱稱不傳 AI。學號是參賽識別，不是學籍身分驗證。
- 學生換機或清除瀏覽器資料後，請教師在名單按「移除」舊裝置連線，再用同學號加入；成績與已交卷答案保留。
- CSV 用 Excel 匯入時，請把學號欄指定為文字，以保留前置 0。

## 六、排除問題

教師能建立房間、學生卻連線逾時時，需檢查學生是否被導向 Google 登入。本版即使設定檔仍保留 `/a/macros/校務網域/s/部署ID/exec`，實際 iframe 載入也會改用同部署的 `/macros/s/部署ID/exec`；設定檔網址繼續作為本機儲存識別，保留既有登入與作答權杖。這項轉換不會改變 GAS 部署的存取權限，仍須允許未登入者使用。

用無痕視窗直接開啟一般 `/macros/s/部署ID/exec`（不帶 channel）時，出現「Error: 請從 OneWord 網頁進入」是預期結果，表示請求已執行到程式的入口檢查；這不是完整橋接或交卷測試，接著請回學生網頁測試加入房間。

| 現象 | 處理 |
|---|---|
| 尚未設定後端 | 首頁設定，或填入 config.js |
| GAS 連線逾時 | 檢查 /exec 網址、部署存取權限、setup_ 與網路是否允許 Google Apps Script；可在瀏覽器正常開啟部署網址查看 Google 權限提示 |
| 網站未加入 ALLOWED_ORIGINS | 填 `https://帳號.github.io`，不帶 `/儲存庫/oneword/` |
| GAS 修改未生效 | 管理部署作業選新版本並更新 |
| 平板交卷畫面稍慢 | 等待下一次輪詢；不要連點送出 |
| 圖片保存失敗 | 保留原平板筆跡，重試送出 |
| AI 服務失敗 | 確認金鑰、額度、模型權限；揭曉前重試，不能當成答錯 |

## 官方參考

- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/guides/html/communication
- https://developers.google.com/apps-script/guides/services/quotas
- https://developers.google.com/apps-script/reference/drive/folder
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 學生登入白名單

只允許 `1410701–1410715`（15 人）及 `1420716–1420728`（13 人），共 28 個學號。其餘學號一律由 GAS 後端拒絕，不能靠修改網頁繞過；舊版其他學號的裝置權杖也不能恢復登入或交卷。教師仍使用原教師登入碼。更新此限制後，請同時更新 GitHub 網頁與 GAS 的正式部署版本。

## 成語隨機填空

題庫沿用專案內 `Idioms/idioms1150101.html` 的既有成語目錄，共 148 則四字成語，來源範圍見 `Idioms/SOURCE_SCOPE.md`。每次先隨機選一則成語，再獨立隨機選第 1、2、3 或 4 字挖空，共 592 種成語／位置組合。同一場已正式出題的成語不重複，僅挖空位置仍隨機。

例如「金蘭之交」可出成「□蘭之交」、「金□之交」、「金蘭□交」、「金蘭之□」，正解分別是「金、蘭、之、交」。學生仍只手寫一個字。

建立房間會產生私人預覽；教師可按「隨機抽題」重抽，再確認秒數按「開始作答」。揭曉後自動準備下一題預覽。成語與挖空位置由後端保存，開始時依預覽識別碼取得正解，不採用網頁自行傳送的題目或答案。舊預覽識別碼會被拒絕。學生在揭曉前只能取得挖空題目；揭曉後顯示正解與完整成語。

此更新須同步上傳新版網頁，並把 `gas/Code.gs` 更新至 GAS 正式部署的新版本（2.1.0）。已存在而沒有預覽的舊房間，可在題目結束後按「隨機抽題」產生新預覽。
