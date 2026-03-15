# Mosaic (Browser)

ブラウザで遊べるボードゲーム「モザイク」の実装です。  
2D対局画面でプレイし、終局後は中央盤面を 2D / 3D で切り替えながら盤面を確認できます。

- 技術スタック: React + TypeScript + Vite
- 対応: PC / スマホ / タブレット
- 対戦: ローカル2人対戦、vs CPU（Easy / Normal / Hard）

## Demo

https://mosaic-game-bef28.web.app

## 概要

段別ピラミッド構造（`board[level][row][col]`）でルールを実装し、2D UIで操作しやすく表現しています。  
本アプリは単体のローカル専用版ではなく、同一アプリ内に複数の対戦モードを持つ構成です。  
フェーズ2まででスタンドアロン対戦体験（ローカル2人対戦・CPU対戦・Playback・3D表示）を整備し、フェーズ3でオンライン対戦モードを追加予定です。

## 現在できること

- 2D対局画面（段が半マスずつずれる表示）
- ローカル2人対戦
- CPU対戦（2P側をCPUが担当）
- CPU難易度（Easy / Normal / Hard）
- CPU vs CPU 対戦（CPU 1 / CPU 2 の難易度個別設定）
- オンライン対戦（private room: 作成 / 参加 / 同期）
- 開始モーダル設定
  - Game Mode（Local / CPU / Online）
  - CPU Match Type（You vs CPU / CPU vs CPU）
  - テーマ制カラーUI（8テーマ） + Swap
  - Turn Order（モードに応じた先攻/後攻設定）
- Undo
  - 2 Player: 1手戻し
  - vs CPU: 人間手番まで戻す（CPU着手後は2手戻し）
- 終局後の Winner モーダル
- 棋譜の内部記録（手置き + 自動積み上がり）
- 棋譜ファイル export / import（`.mosaic` JSON）
- 2D Playback（終局後に初手から再生）
- 3D View（終局後の中央盤面を3D静止表示）
- 3D Playback（3D View内の `Playback` から開始）
- Playback 手動ステップ操作（最初へ / 1手戻る / 1手進む / 最後へ）
  - 1手は `manual move + その手に紐づく auto placements` をまとめた単位
- 手数表示
  - 通常対局中: TURN / ターン バッジに「次に打つ手順番号」を表示（例: `TURN 24`, `24手目`）
  - Playback中: `現在 / 総手数` を表示（例: `24 / 81`）
- 棋譜シート PNG 出力（人間向け閲覧・共有用）
- サウンド ON/OFF、連鎖音程変化、勝利音
- 駒配置アニメーション / 連鎖の時間差表示
- CHAIN 演出（段階表示）
- 残数表示の段階更新（着地タイミングに同期）
- 最後の一手マーカー強調（リング + 控えめグロー）
- レスポンシブ UI
  - PC: 左右プレイヤーパネル + 上部勢力バー（横）
  - モバイル/タブレット: 情報パネル2モード切替
    - 標準モード（デフォルト）: 上部2分割
    - 向かい合いモード: 上下配置 + 上側180度回転
  - モバイル勢力バー:
    - 標準モード: 上部の横バー
    - 向かい合いモード: 盤面右横の縦バー（盤面高さに合わせる）
      - 相手側（上側）の表示は読みやすい向きに反転
  - モバイル操作: 右下ハンバーガーメニュー
    - Sound（トグル時はメニューを閉じない）
    - Undo / Reset（実行時に閉じる）
  - 情報パネルモードは localStorage で保存
- 軽量 i18n（英語 / 日本語切替）
  - `src/i18n.ts` で辞書管理
  - 言語保存キー: `mosaic.language`
  - 初期言語: localStorage 優先、未保存時は `navigator.language` で判定（`ja*` は日本語）

## 対戦モード

- ローカル2人対戦
  - 同一端末で2人が交互にプレイ
- CPU対戦
  - You vs CPU（2P側をCPUが担当: Easy / Normal / Hard）
  - CPU vs CPU（CPU 1 / CPU 2 の難易度を個別設定）
- オンライン対戦
  - ルーム作成 / 参加による遠隔2人対戦（private room）

## ルール（本実装）

### 持ち駒

- 1P / 2P ともに70個
- 手置き・自動積み上がりの両方で消費
- 残り0で勝利

### 盤面構造

- level 0: 7x7
- level 1: 6x6
- level 2: 5x5
- level 3: 4x4
- level 4: 3x3
- level 5: 2x2
- level 6: 1x1

初期配置: `level 0 (3,3)` に中立コマ1つ。

### 手置き条件

- 置く先が空
- level 0 は空なら可
- level > 0 は下段4マス
  - `(r,c), (r+1,c), (r,c+1), (r+1,c+1)`
  がすべて埋まっている場合のみ可

### 自動積み上がり

同一 level の2x2が埋まると、中央上（level+1）に候補発生。  
4コ中 Blue または Yellow が3つ以上なら、その色を自動配置。

- 中立はどちらの色にも数えない
- 自動配置でも持ち駒を1消費
- 残り0の色は自動配置不可

### 連鎖と解決順

候補がなくなるまで連鎖。複数候補は固定順:

1. level 昇順
2. row 昇順
3. col 昇順

### 勝利判定

1手の処理順:

1. 手置き
2. 自動連鎖解決
3. 勝者判定

同一手で両者0の場合は暫定仕様として着手側勝利（引き分けなし）。

## CPU対戦

評価関数ベースの軽量AIです。

- Easy: ランダム性を残したベース挙動
- Normal: 自動積み上がり/妨害評価を強化し、ランダム性を抑制
- Hard: 連鎖・発火候補（3/4同色）・相手最善返しを重視する専用ロジック（終盤は自コマ消費を強めに評価）

※ 深い多手先探索（本格ミニマックス）は未導入です。

## 操作方法

1. 起動後に `Game Setup` で設定して `Start`
2. 合法手をクリック/タップして着手
3. 必要に応じて Undo / Sound / Reset を使用
4. 終局後は Winner モーダルで
   - 上段（その場で見る / 続ける）:
     - `3D View`（中央盤面を3D終局表示へ切替）
     - `Playback`（2D Playbackを開始）
     - `Restart`（設定モーダルへ）
   - 下段（保存 / 出力）:
     - `Save Record`（`.mosaic`）
     - `Export Score Sheet`（棋譜シート PNG）
5. 3D View中は
   - `Rotate: On/Off`（自動回転の切替）
   - ドラッグ / スワイプ（手動回転、手動操作時は auto-rotate OFF）
   - `Playback`（3D Playbackを開始）
   - `2D View`（終局後の2D result viewへ戻る）
6. Playback中は 2D / 3D 共通で
   - 左端ラベル: `Playback` / `3D Playback`（操作ボタンではなく表示ラベル）
   - 手動ステップ: `最初へ` / `1手戻る` / `1手進む` / `最後へ`
     - 1手は `manual + auto placements` をまとめて進む/戻る
   - 全体制御: `Pause` / `Resume` / `Exit`
   - 手動ステップ操作時は自動再生を停止し、`Resume` で再開
   - 先頭局面では `最初へ / 1手戻る` が disabled、最終局面では `1手進む / 最後へ` が disabled
   - 手数表示:
     - `現在 / 総手数`（反映済み手数 / 棋譜総手数）
   - レスポンシブ配置:
     - PC: 既存UIと干渉しにくい右下エリアに配置
     - スマホ: 下部中央寄せの2段構成（上段: ラベル/手数、下段: 操作ボタン）
7. 棋譜ファイル
   - `Save Record` で `.mosaic` を保存
   - `Load Record` で `.mosaic` を読み込み、Playback として再生
8. 棋譜シート
   - `Export Score Sheet` で棋譜シート PNG を保存

## 演出・UI仕様

- 手置き: 短いポップイン
- 自動積み上がり: 1つずつ時間差表示
- CHAIN演出: 3 CHAIN 以上で段階表示
- サウンド:
  - 手置き音
  - 自動積み上がり音（連鎖で高音化）
  - 勝利音
  - ON/OFF切替
- ターンカード強調:
  - 現在手番カードの枠/ハロー強調（脈動なし）
- Thinking表示:
  - You vs CPU の待機中に中央 `Thinking` + アニメーションドット表示
  - CPU vs CPU ではノイズ低減のため中央 Thinking 表示を抑制
- 残りコマ表示:
  - PC: コイン状可視化（10x7）
  - モバイル/タブレット: 簡略表示（数値 + バー）
  - 着地タイミングで1個ずつ減少
- 勢力バー:
  - PC: 上部横バー
  - モバイル標準: 上部横バー
  - モバイル向かい合い: 盤面右横の縦バー（盤面高）
- 2D / 3D polish:
  - 2D / 3D の盤面配色と質感を調整
  - 3D ボードサイズ最適化（余白縮小）と角丸化
  - 3D View のズーム操作（PC: ホイール / モバイル: ピンチ）を有効化

## 棋譜・Playback・3D

- 棋譜を内部保持（手置き・自動積み上がり・勝者）
- 棋譜ファイル export / import（`.mosaic`）
  - 形式: JSON
  - 識別子: `format: "mosaic-record"`, `version: 1`
  - import は「対局再開」ではなく Playback 用データとして扱う
  - Local / CPU / Online を可能な限り共通形式で扱う
  - import 判定は拡張子/MIME固定ではなく、JSON内容（`format` / `version` など）を基準に実施
  - iPhone / Safari の file picker で独自拡張子が無効扱いになる場合に備え、選択は広めに許可し、中身で妥当性を判定
- 棋譜シート PNG 出力（`.mosaic` とは別用途）
  - 人間向けの閲覧・共有用フォーマット
  - レイアウト: 最下段 7x7 から上に向かって 6x6 ... 1x1 の縦積み
  - 表示ルール:
    - 通常着手セル: 手番番号（例: `23`）
    - ボーナスセル: 括弧付き（例: `(23)`）
    - 先手: 黒 / 後手: 赤
  - 第1版は PNG 出力を優先（PDF は将来拡張）
- 2D Playback: 終局後に初手から再生
- 3D View: 中央盤面を3D表示モードへ切り替え、終局静止状態から開始
- 3D Playback: 3D View内の `Playback` から開始
- Playback操作（2D / 3D共通）
  - 手動ステップ: `最初へ` / `1手戻る` / `1手進む` / `最後へ`
  - 1手単位は `manual move + auto placements` のまとまり
  - 全体制御: `Pause` / `Resume` / `Exit`
  - `Exit` 時は現在の表示モード（2Dまたは3D）の終局静止状態へ戻る
  - 手動ステップを押すと自動再生は停止し、感想戦・検討用の手動確認に切り替え可能
  - 通常対局中の TURN バッジとは手数表示の意味が異なる
    - 通常対局: 次に打つ手順番号
    - Playback: 反映済み手数 / 総手数
- 2D / 3D result view 往復
  - `2D View` で戻っても終局モーダルが再表示され、`3D View / Playback / Restart` 導線を維持

## フェーズ3: オンライン対戦（予定）

### 目的

- 既存の盤面UIとゲームルールを活かし、離れた2人がオンラインで対戦できるようにする

### 基本方針

- 別アプリにはせず、同一アプリ内の新モードとして追加する
- 盤面UI・ルール・演出などの共通部分は再利用する
- モード固有の進行制御（local / cpu / online）は分離して管理する

### 初期スコープ

- ルーム作成
- ルーム参加
- 2人が揃ったら対戦開始
- 着手のリアルタイム同期
- 勝敗結果の同期

### 初期スコープ外

- ランキング
- レーティング
- フレンド機能
- チャット
- 観戦
- オンライン対戦での Undo

### 想定UX

- タイトルまたは開始導線からオンライン対戦を選ぶ
- ルームを作る / 参加する
- 相手待機
- 対戦開始
- 終局表示

### 現状実装（初期オンライン段階）

- 開始導線に「オンライン対戦」を追加
- Game Setup はモード選択専用、Local/CPU は Color Setup を経由
- `menu / create / join / waiting / playing / error` の画面遷移を確認可能（online は Firestore room 状態を優先）
- Online Create Room で host が Player 1 / Player 2 の色を設定し、Join 側はその設定を受け取る
- 着手フローは `local/cpu` と `online request` を分離し、将来の同期反映ポイントを明確化
- Firestore ベースの private room（作成/参加/購読）の最小同期基盤に着手
- 現在は server-side validation 未導入の最小構成（本格運用前）

## フェーズ3: 状態設計（たたき台）

### 設計方針（SSOT）

- 本アプリは共通のゲームコアを持ち、対戦モード `local / cpu / online` を切り替えて運用する
- 盤面ルール・合法手判定・自動積み上がり・勝敗判定・勢力計算は共通ロジックとして維持する
- モードごとの差分は「進行制御」に閉じ込め、既存 `local / cpu` 実装を壊さずに `online` を追加する

### 責務の分離

- 共通ロジック
  - 盤面状態更新、合法手判定、連鎖解決、勝者判定、棋譜生成
- モード固有ロジック
  - `local`: 1台で2人が交互に入力し、着手をローカルで即時確定
  - `cpu`: 1P入力後にCPU応手をローカル計算し、同一端末で進行
  - `online`: ルーム経由で2人が遠隔対戦し、通信同期を前提に着手を確定
- UIの共通部分
  - 盤面描画、合法手ハイライト、演出、Winner表示、Playback/3D導線
- オンライン追加で増える責務
  - ルーム管理（作成/参加）
  - 接続状態管理
  - 同期待ち/再送待ちなどの非同期状態管理
  - 通信エラー時の遷移制御

### モードごとの着手確定フロー

- `local / cpu`
  - 入力した着手をローカルで即時反映し、そのまま連鎖解決と勝敗判定へ進む
- `online`
  - 入力した着手は「送信中/同期待ち」を経て確定し、同期後に盤面へ反映する
  - 見た目の盤面UIは共通だが、着手確定のトリガーは通信同期を前提にする

### 初期実装で持つ状態項目（最小）

- `gameMode`（`local | cpu | online`）
- `onlinePhase`（`menu | create | join | waiting | playing | finished | error`）
- `roomId`
- `playerRole`（`1P | 2P`）
- `isHost`（ホスト/参加者）
- `connectionState`（`idle | connecting | connected | disconnected`）
- `syncState`（`idle | sending | waitingAck | synced`）
- `onlineError`（コード/メッセージ）
- `isGameFinished`
- `winner`

## フェーズ3: 画面遷移（最小構成）

1. タイトル/開始導線で `online` を選択
2. オンライン対戦メニューへ遷移
3. `ルーム作成` または `ルーム参加` を選択
4. ルーム確定後、`相手待機` 状態へ遷移
5. 2人が揃ったら `対戦中` へ遷移
6. 勝敗確定で `終局` へ遷移
7. 失敗時は各状態から `エラー` へ遷移し、再試行またはメニューへ戻る

補足:

- `対戦中` は共通盤面UIを利用し、`onlinePhase=playing` の間のみオンライン進行制御を有効化
- `終局` は既存の Winner 表示導線を再利用し、同期済み勝敗結果を表示する

## フェーズ3: ルームデータモデル（たたき台）

最小構成のルームデータ例:

- `roomId`: ルーム識別子
- `status`: `waiting | playing | finished`
- `players`: 参加者情報（`1P/2P` の割当、接続状態）
- `currentTurn`: 現在手番（`1P | 2P`）
- `boardState`: 共有盤面状態（`board[level][row][col]` を含むゲーム状態）
- `winner`: 勝者情報（未確定時は `null`）
- `createdAt`: 作成日時
- `updatedAt`: 更新日時

拡張余地:

- `moveHistory` は初期必須ではないが、棋譜保存/共有URL/リプレイ拡張に備えて将来追加可能

## フェーズ3: スコープ境界（状態設計観点）

### 初期実装でやること

- private room の作成/参加
- 2人揃った後の対戦開始
- 着手/勝敗のリアルタイム同期
- 基本的な接続エラー遷移（`error` への退避）

### 初期実装でやらないこと

- 公開マッチング
- 観戦
- 戦績
- チャット
- オンライン対戦での Undo
- 切断復帰
- 再戦

## フェーズ3: 実装ステップ案（設計段階）

- Step 1: オンライン用画面モック（メニュー/作成/参加/待機/エラー）
- Step 2: モード状態管理の整理（`gameMode` と `onlinePhase` の導入）
- Step 3: ルーム同期基盤の接続（作成・参加・待機）
- Step 4: 着手同期と勝敗同期を共通ゲームコアに接続
- Step 5: エラー処理・UI仕上げ・既存 `local / cpu` 回帰確認

## 開発・起動方法

事前準備（オンライン対戦を有効化する場合）:

1. `.env.example` をコピーして `.env` を作成
2. Firebase プロジェクトの値を `VITE_FIREBASE_*` に設定

```bash
copy .env.example .env
```

```bash
npm install
npm run dev
```

ビルド確認:

```bash
npm run build
npm run preview
```

LAN確認例:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

CPU解析デバッグ（Hardのみ）:

- URLに `?debug=1` を付けると、Hard CPU 手番で候補手の順位/スコアオーバーレイと解析HUDを表示

## 主要ファイル構成

```text
src/
  App.tsx
    画面本体、モーダル、モバイルメニュー、対局進行、棋譜管理
  style.css
    レイアウト、レスポンシブ、演出、モーダル、勢力バー
  components/
    Board3DViewport.tsx
      中央盤面の3D表示モード（Rotate / Playback / 2D View）
  game/
    types.ts
    logic.ts
    cpu.ts
```

## 暫定仕様・注意事項

- 同時0勝利時は着手側勝利
- CPU Hard は軽い応手評価まで（深い探索は未実装）
- オンライン対戦は Firestore private room の最小構成を実装中（認証・本格運用機能は未対応）
- `.mosaic` import は Playback 用（対局再開は未対応）

## 今後の拡張案

- 棋譜管理の拡張（履歴一覧、タグ付け、ローカル保存連携）
- 棋譜共有URL
- CPUアルゴリズム強化
- ルールバリアント切替
- UIテーマ追加、実機風デザイン強化
- 効果音/アニメーション追加調整
- オンライン対戦の高度化（再戦、切断復帰、戦績）
