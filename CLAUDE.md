# TheRooms — THE ROOMS（Queens 型の配置パズル。Meowdoku の自作版）

Number Match 自作版（`C:\Users\ynaka\NumberMatch`）と同じ構成で作る、広告なしの配置パズル。盤は N×N で N 個の「部屋」に分かれ、各行・各列・各部屋にひとりずつ駒（ステロペ）を置く。駒どうしは斜めを含めて隣接できない。面はすべて唯一解。計画と仕様の正本は `docs/00_全体像.md`。

## 構成と担当

- `generator/` — Haskell（cabal、依存は base・containers のみ）。**ルールの正本**。面の生成・唯一解の保証・推論による難易度付け・テストベクタ出力。
  - `cabal run gen` で `web/levels/stages.json` と `web/test/vectors.json` を書き出す。この 2 ファイルは手で編集しない。
- `web/` — GitHub Pages で配信する静的サイト（ES modules、ビルド工程なし、外部ライブラリなし）。
  - `js/rules.js` と `js/solver.js` は Haskell の `Rules.hs` / `Solver.hs` と同じ関数名・同じ意味。変更は両方に入れ、`node --test web/test/*.test.js` で一致を確認する。
  - 調整値は `js/config.js` に集約する。
  - `web/assets/` の画像（ステロペの立ち絵・96px の駒・書斎の背景・アイコン）は `C:\Users\ynaka\desktop-mate` で制作したものの写し。ここでは編集せず、足りない絵は desktop-mate 側の手順（gpt-image と Aseprite）で作って写す。
- `docs/` — 学習用の解説（Markdown）。
- `tools/deploy.ps1` — `web/` を gh-pages ブランチへ push する。

## 規則

- ファイルは UTF-8。日本語を含む ps1 は BOM 付き。
- 個人情報（家族の名前など）をコード・コミット・公開物に入れない。ステロペの人格・外見の正典（desktop-mate の `AGENTS.md` 2〜4 項）を変えない。所属・階級・経歴などの未確定事項を台詞で補完しない。
- UI の用語は英語（Piece / Room / Board / Chain / Heart / Star / Stage / World / Score / Hint）、説明文は日本語。
- `docs/` などの人が読む日本語文書は explain-before-shorten → yomiyasu で推敲する（コード・設定・HANDOFF は対象外）。
- Haskell のコードは授業（Hutton 本の章順）で既習の道具を優先する。
- コミットは変更ファイルをパス指定で行う（`git add -A` 禁止）。
- 更新のたびに `web/sw.js` の VERSION を上げる。
- 検証: `cabal build && cabal test`（generator）、`node --test web/test/*.test.js`、ブラウザでの実プレイ。
