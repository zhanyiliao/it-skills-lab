# 本機執行

## 啟動與停止

在專案根目錄執行 start-local.cmd。出現 RUNNING 後開啟 http://127.0.0.1:8080/ 。

- 終端保持開啟，Ctrl+C 等待 STOPPED 後即可結束。
- 關閉終端會由 Windows Job Object 結束 Node.js 與 MariaDB 子程序。
- 任一服務意外退出時，會停止另一個服務。
- 已有服務或連接埠占用時拒絕重複啟動，不會停止其他服務。
- 再次啟動保留既有資料；資料結構定義於 database/schema.sql，首次建立題庫時匯入 questions-seed.sql 的 400 題 AI 種子題目。

本機示範帳號：localadmin / LocalDemo2026!（管理者）。學生可由註冊頁建立帳號。

## 執行環境

- Node.js 24 LTS 免安裝版：.local-runtime/node/。
- npm 套件：根目錄 node_modules/，依 package-lock.json 安裝固定版本。
- MariaDB 11.4.10 與資料：.local-runtime/；資料庫 php2020，本機開發帳密 root / password。
- 網站監聽 127.0.0.1:8080；資料庫監聽 127.0.0.1:3307。
- 首次使用會從官方來源下載並校驗 Node.js／MariaDB，安裝 npm 套件。已安裝且鎖定檔未變更時可離線啟動；成功解壓後會清除下載的安裝壓縮檔。
- 執行環境、資料庫、金鑰、日誌與新上傳頭像不提交 Git。

## 使用 npm

本機附帶的 Node.js 未修改系統 PATH。PowerShell 可先執行：

    $env:Path = "$PWD\.local-runtime\node;$env:Path"

之後在專案根目錄執行：

    npm run check
    npm test

手動啟動網站時，需先自行啟動 MariaDB：

    npm run db:setup
    npm start

開發時也可使用 npm run dev，程式異動會由 Node watch 自動重啟。若已有 start-local.cmd 提供網站服務，請勿再啟動第二個網站。

手動 Node 模式只管理網站，停止它不會結束你另外啟動的資料庫。

## 環境設定

可從根目錄 .env.example 複製為 .env。支援：

- HOST、PORT
- DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_DATABASE
- SESSION_SECRET、NODE_ENV、TRUST_PROXY

標準 Windows 啟動器使用上述本機連接埠；自訂資料庫或連接埠時，請準備對應資料庫並使用手動啟動模式。

開發環境未設定 SESSION_SECRET 時，自動在 .local-runtime/node-session-secret 產生並持續沿用。正式環境須設定隨機 SESSION_SECRET、HTTPS 與有限權限的資料庫帳號。若部署於一層可信反向代理後，可設 TRUST_PROXY=1。

一般登入維持兩小時，保持登入為三十天，活動時延長。變更密碼會使其他舊登入失效；帳號刪除及角色變更於下次請求生效。

測驗依難度星等加權，成績顯示兩位小數。正式測驗合格條件為 60.00 分以上且用時不超過 90 分鐘，不會逾時自動交卷。練習結果在 Session 保留一小時，不覆蓋正式成績。每日一題依台北日期固定抽選。

## 排查問題

- 網站錯誤：.local-runtime/web-error.log。
- 網站啟動輸出：.local-runtime/web.log。
- 資料庫錯誤：.local-runtime/database-error.log。
- 連接埠占用：停止先前服務終端，或檢查其他程式。
- 資料庫實際資料位於 .local-runtime/data；請勿在執行中移動或刪除。

## 測試

先啟動本機服務，另開 PowerShell，設定 PATH 後執行 npm run check 與 npm test。整合測試會建立、使用並刪除獨立的測試資料庫，需要對應權限。

服務生命週期測試需先關閉本機服務，再執行：

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\test-local-lifecycle.ps1

測試涵蓋正常啟停、重複啟動、強制關閉後恢復，以及連接埠衝突清理；結束後服務維持停止。

## AI 出題與測驗

登入後在「開始測驗」（/exams）選擇正式或練習。練習由資料庫題庫抽題，支援八科與 10／25／50 題；正式固定八科 50 題，由 45 題資料庫題與 5 題 AI 新題組成。難度為 1～9 星，以 4 星為中心；作答時隱藏，檢討時顯示。正式考卷準備期間顯示生成與審查進度，完成後才開始計時。

生成失敗不替換現有考卷；若生成期間已登出或其他頁面已開始新測驗，會拒絕套用過期的生成結果。交卷採防重複與交易保護，正式成績永久保留，練習檢討一小時內有效；兩者都只保存題目 ID 與所選答案，完整內容依題目版本讀回。

共通規則為 [prompts/ai-exam.md](prompts/ai-exam.md)，八科方向與難度分別位於 prompts/ 的科目文件；題庫代碼與檔案對應見 src/services/question-banks.js。每次生成重新讀取。專案管理採通用應試方向，自建題目；星等尚未經受試統計校準。JSON 每題以 bank、difficulty 記錄題庫與星等。

先安裝 Codex CLI，於啟動網站的同一個 Windows 帳號執行 codex login；可用 codex login status 確認。網站沿用既有認證與帳號額度，不需另外填 API 金鑰。CODEX_BIN 可指定原生執行檔，否則搜尋 PATH 與 Windows 的 VS Code Codex 擴充套件；CODEX_MODEL 未設定時沿用 CLI 預設模型。CODEX_TIMEOUT_MS 為每批逾時，預設 180000、最高 300000；修改環境設定須重啟網站。

每個網站程序同時只產生一份 AI 考卷，每個 IP 每十分鐘最多十次啟動。CLI 採無使用者設定、暫存會話、唯讀與停用工具；格式檢查不代表題目內容已通過人工審核。串流只回傳階段／題數及開卷位置，不在作答前把正解與解析送到瀏覽器。一般 JSON 請求取得 destination，非 JavaScript 表單則在生成後重新導向。

[OpenAI 官方非互動模式文件](https://learn.chatgpt.com/docs/non-interactive-mode)。
