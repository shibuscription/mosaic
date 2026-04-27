# Mosaic (Browser)

MOSAIC をブラウザで遊べる Web アプリです。  
2D / 3D 表示、ローカル対戦、CPU 対戦、オンライン対戦、棋譜保存 / 読み込み、Playback を 1 つのアプリ内で扱います。

- Tech stack: `React` + `TypeScript` + `Vite`
- Supported devices: PC / mobile / tablet
- Main modes: `Local Match`, `CPU Match`, `Online Match`, `Playback`

## Demo

https://mosaic-game-bef28.web.app

## Current Support Status

現在のアプリで遊べる盤面サイズとモードは次のとおりです。

| Variant | Board | Pieces per player | Local | CPU | Online | Record / Playback |
| --- | --- | ---: | --- | --- | --- | --- |
| Mini | 5×5 | 27 | Supported | Supported | Supported | Supported |
| Standard | 7×7 | 70 | Supported | Supported | Supported | Supported |
| Pro | 9×9 | 142 | Supported | Supported | Supported | Supported |

- 駒数は現状この値を正として扱っています。
- `quo`、ハンデ系ルール、時計機能、記録専用モードなどは今後の拡張対象です。

## Game Modes

- `Local Match`
  - 同一端末で 2 人対戦
  - `Mini / Standard / Pro` を選択可能
- `CPU Match`
  - `You vs CPU`
  - `CPU vs CPU`
  - `Mini / Standard / Pro` を選択可能
- `Online Match`
  - private room の作成 / 参加
  - room 作成時に host が `boardVariant` を選択
  - join 側は host 側の盤面サイズに従う
- `Playback`
  - 保存棋譜の再生
  - `boardVariant` を保持
  - `boardVariant` が無い古い棋譜は `Standard` 扱い

## Piece Counts

- `Mini (5×5)`: 27
- `Standard (7×7)`: 70
- `Pro (9×9)`: 142

今後、これらの駒数を変更する想定は基本的にありません。

## Tile Pattern Variants

- `Iki` and `Miyabi` each provide 5 PNG variants per side (`*_1` to `*_5`).
- For these themes, each newly placed piece picks one variant independently at placement time.
- Chain / bonus placements also pick variants independently per piece.
- Once a piece is placed, its selected variant stays fixed while that piece remains on the board.
- Record save/load and playback do not preserve exact historical variant assignments.
- In online play, these visuals are client-side effects and may differ between players.
- Variant images are presentation-only and do not affect legal moves, resolution, win/loss, or game logic.

## CPU Status

公開向け CPU 選択肢は次の 3 つです。

- `Easy = Former Normal`
- `Normal = SOPHIA`
- `Hard = Onuma Hard`

補足:

- `Onuma` は `Mini / Standard / Pro` それぞれの重みテーブルを持っています
- 9×9 用の Onuma 初期比重は、現在の共有シート値に合わせて実装済みです
- `kobalab` は `Mini / Standard / Pro` でランタイム上は動作しますが、特に 9×9 の強さ調整はまだ未実施です
- `?debug=1` で対応 CPU の HUD / 解析表示を有効化できます
- `?dev=1` で開発向け / 試作 CPU を表示します
- `?former=1` は `?dev=1` の旧互換エイリアスです
- `?kobalab=1` で `kobalab CPU` を表示します

## Draw Rule Note

引き分け判定は現在 **暫定実装** です。

- 1 手の処理がすべて解決した最終状態で判定します
- 両者の残り駒が `0` なら `draw`
- 片方だけ `0` ならそのプレイヤーの勝ち
- どちらも `0` でなければ続行

正式ルールは今後の確認結果に応じて見直す可能性があります。

## Setup Flow

ゲーム設定は 2 ページ構成です。

- 1 ページ目
  - 対局形式の選択
  - 盤面サイズの選択
- 2 ページ目
  - 先攻 / 後攻
  - 色
  - テーマ
  - オンライン参加時の room code 入力や参加情報

盤面サイズ selector の表示方針:

- `Local Match`: 表示
- `CPU Match`: 表示
- `Online Match`
  - `Create Room`: 表示
  - `Join Room`: 非表示

setup タイトルは現在の選択中サイズに追従して切り替わります。

- `MOSAIC MINI`
- `MOSAIC STANDARD`
- `MOSAIC PRO`

## URL Flags

- `?debug=1`
  - Debug HUD / CPU 解析表示を有効化
- `?dev=1`
  - 開発者向け CPU / 試作 CPU を表示
- `?former=1`
  - `?dev=1` の旧互換
- `?kobalab=1`
  - `kobalab CPU` を表示

## Online Notes

- Firestore は `rooms` コレクションのみを使う前提です
- ルームコードには `1`, `I`, `0`, `O` を使わず、口頭共有しやすくしています
- online resume / rejoin は現在保留で、まずは create / join / sync / completion の安定性を優先しています

### Firestore Rules

本番運用前には rules をデプロイしてください。

```bash
firebase deploy --only firestore:rules
```

現在の rules は test mode 脱却のための最小 hardening です。  
未認証公開書き込みを完全に防ぐものではないため、今後の改善候補としては次を想定しています。

- Firebase Anonymous Auth
- App Check
- Functions 経由の move validation / room mutation

## Development

```bash
npm install
npm run dev
```

LAN 公開が必要な場合:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

build 確認:

```bash
npm run build
```

## Docs

詳しい仕様メモは `docs/` 配下にあります。

- docs index: [`docs/README.md`](./docs/README.md)
- rules: [`docs/rules.md`](./docs/rules.md)
- CPU notes:
  - [`docs/cpu-easy.md`](./docs/cpu-easy.md)
  - [`docs/cpu-normal.md`](./docs/cpu-normal.md)
  - [`docs/cpu-sophia.md`](./docs/cpu-sophia.md)
  - [`docs/cpu-kobalab.md`](./docs/cpu-kobalab.md)
  - [`docs/cpu-onuma.md`](./docs/cpu-onuma.md)
- record formats:
  - [`docs/record-save-format.md`](./docs/record-save-format.md)
  - [`docs/record-image-format.md`](./docs/record-image-format.md)

## Known Gaps / Next Steps

- 9×9 CPU は有効化済みだが、強さ調整はまだ継続中
- 9×9 `kobalab` は動作するが、Pro 専用最適化は未実施
- 9×9 Debug HUD はまず安定動作を優先しており、表示磨きは今後の課題
- 9×9 オンライン対戦は動作段階まで来ているが、実機での長時間 UX 調整余地あり
- draw ルールは暫定実装のため、正式仕様確定後に再整理の可能性あり
- `quo`、ハンデ、時計、記録専用モードなどは今後の拡張対象

## Open Source License Note

- `kobalab CPU` には UpperHand by Satoshi Kobayashi 由来のロジックが含まれ、MIT License の範囲で扱っています
- third-party license text は [`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md) にあります
- アプリ内では `Open Source Licenses` から確認できます
