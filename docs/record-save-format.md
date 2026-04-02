# 棋譜保存形式

## この文書の目的

この文書は、現行 Web 版の import / export に使われる `.mosaic` 形式を説明するものです。  
目的は、現状仕様の理解、Playback 用データの再利用、将来の互換性検討の土台づくりです。

## 保存形式の役割

`.mosaic` は、対局途中から再開するための完全セーブではなく、対局結果を Playback するための棋譜保存形式です。

- 手置き
- その手に紐づく自動積み上がり
- 勝者
- 対局モードや CPU 設定などの補助情報

をまとめて保持します。

## JSON ベースであること

現行形式は JSON ベースです。  
ファイルの中身は構造化 JSON であり、拡張子だけでなく内容の `format` と `version` を見て妥当性を判定します。

## ファイル拡張子の位置づけ

- 推奨拡張子は `.mosaic`
- ただし import 時は拡張子固定ではなく、JSON 内容を優先して判定します

これは、環境によって独自拡張子の扱いに差があるためです。

## トップレベル構造の説明

現行 Web 版のトップレベル構造は次のとおりです。

```json
{
  "format": "mosaic-record",
  "version": 1,
  "exportedAt": "2026-04-02T12:34:56.000Z",
  "mode": "cpu",
  "themeId": "miyabi",
  "playerColors": {
    "blue": "miyabi_white",
    "yellow": "miyabi_navy"
  },
  "openingTurn": "blue",
  "moves": [],
  "winner": null,
  "cpuSettings": {
    "matchType": "you_vs_cpu",
    "cpuDifficulty": "hard"
  }
}
```

## 各主要フィールドの意味

- `format`
  - 形式識別子です。現行値は `"mosaic-record"` です。
- `version`
  - スキーマの版です。現行値は `1` です。
- `exportedAt`
  - エクスポート日時の ISO 文字列です。
- `mode`
  - 対局モードです。現行値は `"pvp"`, `"cpu"`, `"online"` のいずれかです。
- `themeId`
  - 出力時点のテーマ識別子です。未設定時は `null` になりえます。
- `playerColors`
  - `blue` / `yellow` に割り当てられた表示色 ID です。
- `openingTurn`
  - 初手プレイヤーです。Playback で先後を再現する基準になります。
- `moves`
  - 棋譜本体です。各手に手置きと自動積み上がりが入ります。
- `winner`
  - 勝者です。未確定や特殊ケースでは `null` を取りえます。
- `cpuSettings`
  - CPU 対戦時の補助情報です。通常対戦では省略されます。
- `onlinePlayers`
  - オンライン対戦時の補助情報です。通常対戦では省略されます。
- `appVersion`
  - 将来や外部出力で付与される余地のある補助情報です。現行型では任意です。

## 棋譜再生に必要な情報

Playback に本質的に必要なのは次の情報です。

- `openingTurn`
- `moves[*].turn`
- `moves[*].player`
- `moves[*].manual`
- `moves[*].autoPlacements`
- `winner`

各 `moves` 要素は、1 手ぶんのまとまりを持ちます。

```json
{
  "turn": 12,
  "player": "yellow",
  "manual": { "level": 1, "row": 2, "col": 3 },
  "autoPlacements": [
    { "level": 2, "row": 2, "col": 3, "color": "yellow", "basedOnLevel": 1 }
  ]
}
```

ここでの 1 手は、手置きだけでなく、その手に伴って発生した自動積み上がりを含む単位です。

## 互換性の考え方

- import は `format` と `version` を見て受理可否を決めます
- 現行パーサは `version: 1` 以外を受け付けません
- 任意フィールドは、存在しなくても棋譜再生に必須でないものとして扱われます

この構造により、再生の核となる情報を保ちつつ、補助情報を追加しやすくしています。

## version を持つ場合の意義

`version` は、将来のフィールド追加や互換性判断の基準です。

- 旧版との互換維持方針を明示できる
- import 時に曖昧な読み込みを避けられる
- 別実装でも、どの版の仕様を読んでいるかを判断しやすい

## import / export 時の注意点

- export は JSON を整形して保存します
- import はファイル拡張子ではなく JSON 中身を優先して確認します
- import 後は対局再開ではなく Playback を開始します
- 現行実装では、読み込んだ棋譜から新しい対局状態を再構築し、初期局面から順に再生します

## 今後の拡張余地

- 局面スナップショットの追加
- アプリバージョンの正式記録
- 共有 URL やメモ情報の追加
- ルールバリアント識別子の追加

ただし、現時点では「Playback 用の軽量な棋譜形式」であることを優先するのが自然です。
