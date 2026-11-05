-- | 盤の表し方。
--   N×N のマスが N 個の「部屋」に分かれている。部屋は 0 始まりの番号で、
--   rooms は行ごとのリスト(rooms !! 行 !! 列 = 部屋番号)。
--   (第7章: data と record 構文。第5章: リスト内包表記)
module Rooms.Board
  ( Pos
  , Puzzle(..)
  , cells
  , inside
  , roomAt
  , roomCells
  , units
  , neighbors4
  ) where

-- | マスの位置。(行, 列)。どちらも 0 始まり。
type Pos = (Int, Int)

-- | 面。size が N、rooms が部屋の割り当て。
data Puzzle = Puzzle
  { size  :: Int
  , rooms :: [[Int]]
  } deriving (Show, Eq)

-- | 全マスを読み順に。
cells :: Puzzle -> [Pos]
cells p = [(r, c) | r <- [0 .. n - 1], c <- [0 .. n - 1]]
  where n = size p

inside :: Puzzle -> Pos -> Bool
inside p (r, c) = r >= 0 && c >= 0 && r < size p && c < size p

roomAt :: Puzzle -> Pos -> Int
roomAt p (r, c) = rooms p !! r !! c

-- | 部屋 k のマス。
roomCells :: Puzzle -> Int -> [Pos]
roomCells p k = [q | q <- cells p, roomAt p q == k]

-- | 「ひとつずつ置く」単位の一覧: 行、列、部屋の順。
units :: Puzzle -> [[Pos]]
units p =
     [[(r, c) | c <- [0 .. n - 1]] | r <- [0 .. n - 1]]
  ++ [[(r, c) | r <- [0 .. n - 1]] | c <- [0 .. n - 1]]
  ++ [roomCells p k | k <- [0 .. n - 1]]
  where n = size p

-- | 上下左右の隣(盤の中だけ)。部屋を育てるときに使う。
neighbors4 :: Int -> Pos -> [Pos]
neighbors4 n (r, c) =
  [(r', c') | (r', c') <- [(r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)], r' >= 0, c' >= 0, r' < n, c' < n]
