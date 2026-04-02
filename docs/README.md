# MOSAIC Docs

## docs の役割

この `docs` ディレクトリは、ルート [`README.md`](../README.md) の補助仕様を整理するための場所です。

- ルート README は、プロジェクト全体の概要、遊び方、主要機能の入口を担当します。
- `docs` は、ルール、CPU の考え方、棋譜データ形式などの詳細仕様を担当します。
- 現行 Web 版の実装を基準にしつつ、別実装や将来の AI 開発でも読み替えやすい粒度を意識します。

## 文書一覧

- [`rules.md`](./rules.md)
  - MOSAIC の盤面構造、合法手、自動積み上がり、勝敗条件を整理したルール仕様です。
- [`cpu-easy.md`](./cpu-easy.md)
  - Easy CPU が何を見て何を省略しているかを、入門向けロジックとして解析します。
- [`cpu-normal.md`](./cpu-normal.md)
  - Normal CPU が Easy から何を強め、どこまで危険回避するかを解析します。
- [`cpu-sophia.md`](./cpu-sophia.md)
  - `SOPHIA` が候補手をどう比較し、なぜその手を選ぶかを詳しく解析します。
- [`cpu-kobalab.md`](./cpu-kobalab.md)
  - `kobalab CPU` の探索と全体期待値ベースの考え方を、比較研究向けに解析します。
- [`record-image-format.md`](./record-image-format.md)
  - 棋譜シート PNG の構成、色、表記ルールを整理します。
- [`record-save-format.md`](./record-save-format.md)
  - `.mosaic` ファイルの JSON 構造と import / export 時の考え方を説明します。

## 読み進め方

初めて読む場合は、次の順序を推奨します。

1. まず [`rules.md`](./rules.md) を読み、ゲームの本質的なルールを把握する
2. CPU の意図を知りたい場合は [`cpu-easy.md`](./cpu-easy.md) → [`cpu-normal.md`](./cpu-normal.md) → [`cpu-sophia.md`](./cpu-sophia.md) の順に読む
3. 比較研究や別系統ロジックに関心がある場合は [`cpu-kobalab.md`](./cpu-kobalab.md) を読む
4. 棋譜の共有や再生仕様を知りたい場合は [`record-save-format.md`](./record-save-format.md) を読む
5. 棋譜シート出力の再現や別実装を考える場合は [`record-image-format.md`](./record-image-format.md) を読む

目的別の入口は次のとおりです。

- ルール理解から入りたい: [`rules.md`](./rules.md)
- CPU の考え方を知りたい: [`cpu-easy.md`](./cpu-easy.md), [`cpu-normal.md`](./cpu-normal.md), [`cpu-sophia.md`](./cpu-sophia.md), [`cpu-kobalab.md`](./cpu-kobalab.md)
- 棋譜を理解したい: [`record-save-format.md`](./record-save-format.md), [`record-image-format.md`](./record-image-format.md)

## 補足

- これらの文書は、現状コードとルート README から読み取れる内容を基準にしています。
- UI 固有の見た目は必要最低限にとどめ、できるだけルール、データ、責務の観点で記述しています。
- 未確定の話題や改善候補は、現行仕様と混ぜずに「今後の検討事項」として分離しています。
