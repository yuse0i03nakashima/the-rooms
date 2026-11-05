-- | ルールの正本。JavaScript の rules.js はこのファイルと同じ関数名・同じ意味で書く。
--
--   駒の置き方:
--     * 各行・各列・各部屋に駒はちょうど 1 つ
--     * 駒どうしは隣接できない(斜めも含む 8 方向)
module Rooms.Rules
  ( attacks
  , conflict
  , allowed
  , conflicts
  , isSolved
  ) where

import Data.List (tails)
import Rooms.Board

-- | 部屋を考えない「取り合い」: 同じ行、同じ列、または 8 方向に隣接。
attacks :: Pos -> Pos -> Bool
attacks (r1, c1) (r2, c2) =
  (r1, c1) /= (r2, c2) && (r1 == r2 || c1 == c2 || (abs (r1 - r2) <= 1 && abs (c1 - c2) <= 1))

-- | 同時に置けない 2 マス: 取り合いか、同じ部屋。
conflict :: Puzzle -> Pos -> Pos -> Bool
conflict p a b = a /= b && (attacks a b || roomAt p a == roomAt p b)

-- | 置いてある駒 ps に対して、q に新しく置けるか。
allowed :: Puzzle -> [Pos] -> Pos -> Bool
allowed p ps q = inside p q && q `notElem` ps && not (any (conflict p q) ps)

-- | 置いてある駒のうち、互いにぶつかっている組(i<j の順)。
conflicts :: Puzzle -> [Pos] -> [(Pos, Pos)]
conflicts p ps = [(a, b) | (a : rest) <- tails ps, b <- rest, conflict p a b]

-- | N 個の駒が盤の中にあり、ぶつかりが無ければ完成。
isSolved :: Puzzle -> [Pos] -> Bool
isSolved p ps = length ps == size p && all (inside p) ps && null (conflicts p ps)
