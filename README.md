# THE ROOMS

広告なしの配置パズル(Queens 型。Meowdoku の自作版)。N×N の盤が N 個の「部屋」に分かれていて、各行・各列・各部屋にひとりずつ、隣り合わないように駒を置く。駒はステロペ(desktop-mate のキャラクター)。

- 遊ぶ: https://yuse0i03nakashima.github.io/the-rooms/
- 面の生成と唯一解の保証: `generator/`(Haskell)
- 画面: `web/`(ES modules、ビルドなし)
- 解説: `docs/`

## 開発

```
cd generator && cabal build && cabal test && cabal run gen   # web/levels/stages.json と web/test/vectors.json を書き出す
node --test web/test/*.test.js
cd web && python -m http.server 8765 --bind 127.0.0.1          # http://127.0.0.1:8765/
powershell -ExecutionPolicy Bypass -File tools/deploy.ps1       # gh-pages へ
```

## 画像について

`web/assets/` の立ち絵・駒・背景・アイコンは `C:\Users\ynaka\desktop-mate` で制作した画像(gpt-image と Aseprite)の写し。ここでは編集しない。
