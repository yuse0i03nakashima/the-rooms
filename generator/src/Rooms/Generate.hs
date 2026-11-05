-- | 面の生成。乱数は線形合同法を自分で書く(同じシードから同じ面ができる)。
--
--   手順:
--     1. 駒の正解配置をランダムに作る(行ごとに、置ける列から 1 つ選ぶ。行き詰まったらやり直し)
--     2. 駒のマスを種にして部屋を育てる(ランダムに部屋を選び、隣の空きマスを 1 つ取り込む)
--     3. 解が 2 つ以上あれば、正解でない解の駒のマスを隣の部屋へ移して、その解を壊す(refine)
--        正解の駒は動かさないので、正解はそのまま解であり続ける
--     4. それでも唯一解でなければ Main が次のシードを試す
module Rooms.Generate
  ( Seed
  , nextSeed
  , below
  , shuffle
  , randomPlacement
  , growRooms
  , refine
  , makePuzzle
  , StageSpec(..)
  , stageSpec
  ) where

import qualified Data.Map as Map
import qualified Data.Set as Set
import Data.List (nub)
import Rooms.Board
import Rooms.Rules
import Rooms.Solver (solutions)

type Seed = Int

-- | 線形合同法。2^31 で折り返す古典的なパラメータ。
nextSeed :: Seed -> Seed
nextSeed s = (1103515245 * s + 12345) `mod` 2147483648

-- | シードから 0 以上 n 未満の整数(上位ビットを使うと偏りが小さい)。
below :: Seed -> Int -> Int
below s n = (s `div` 65536) `mod` n

-- | リストをシャッフルする。
shuffle :: Seed -> [a] -> ([a], Seed)
shuffle s [] = ([], s)
shuffle s xs = (x : ys, s'')
  where
    s'        = nextSeed s
    i         = below s' (length xs)
    x         = xs !! i
    rest      = take i xs ++ drop (i + 1) xs
    (ys, s'') = shuffle s' rest

-- | 行ごとに、置ける列から 1 つを乱数で選ぶ。置ける列が無ければ Nothing。
attempt :: Seed -> Int -> (Maybe [Pos], Seed)
attempt s n = go s 0 []
  where
    go sd r ps
      | r == n    = (Just (reverse ps), sd)
      | null ok   = (Nothing, sd)
      | otherwise = go sd' (r + 1) ((r, c) : ps)
      where
        ok  = [col | col <- [0 .. n - 1], not (any (attacks (r, col)) ps)]
        sd' = nextSeed sd
        c   = ok !! below sd' (length ok)

-- | 行き詰まったらシードを進めてやり直す。結果は行の順に並ぶ。
randomPlacement :: Seed -> Int -> ([Pos], Seed)
randomPlacement s n =
  case attempt s n of
    (Just ps, s') -> (ps, s')
    (Nothing, s') -> randomPlacement (nextSeed s') n

-- | 駒の位置を種にして、部屋を育てる。
--   毎回ランダムに部屋を選び、その部屋に隣接する空きマスを 1 つ取り込む。
--   空きマスが残っている限り、どれかの部屋は必ず広げられる。
growRooms :: Seed -> Int -> [Pos] -> ([[Int]], Seed)
growRooms s n seeds = finish (go s (Map.fromList (zip seeds [0 ..])))
  where
    total = n * n
    go sd m
      | Map.size m == total = (m, sd)
      | null frontier       = go sd1 m
      | otherwise           = go sd2 (Map.insert q k m)
      where
        sd1      = nextSeed sd
        k        = below sd1 n
        frontier = [q' | (c, k') <- Map.toList m, k' == k, q' <- neighbors4 n c, Map.notMember q' m]
        sd2      = nextSeed sd1
        q        = frontier !! below sd2 (length frontier)
    finish (m, sd) = ([[m Map.! (r, c) | c <- [0 .. n - 1]] | r <- [0 .. n - 1]], sd)

-- | マス q の部屋を k に変える。
setRoom :: Puzzle -> Pos -> Int -> Puzzle
setRoom p (r, c) k = p { rooms = [ [ if (r', c') == (r, c) then k else x | (c', x) <- zip [0 ..] row ]
                                 | (r', row) <- zip [0 ..] (rooms p) ] }

-- | 部屋のマス集合が上下左右でひとつながりか。
connected :: Int -> [Pos] -> Bool
connected _ []         = False
connected n (q0 : qs)  = Set.size (flood (Set.singleton q0) [q0]) == length (q0 : qs)
  where
    members = Set.fromList (q0 : qs)
    flood seen []       = seen
    flood seen (x : xs) =
      let next = [y | y <- neighbors4 n x, Set.member y members, not (Set.member y seen)]
      in flood (foldr Set.insert seen next) (next ++ xs)

-- | q を部屋 b に移してよいか: q の元の部屋が q を失ってもひとつながりで、b は q に隣接している。
canMove :: Puzzle -> Pos -> Int -> Bool
canMove p q b =
  b /= a && b `elem` [roomAt p x | x <- neighbors4 (size p) q]
  && connected (size p) [x | x <- roomCells p a, x /= q]
  where a = roomAt p q

-- | 解が 2 つ以上あるあいだ、正解でない解を壊す。k 回まで。
--   壊し方: その解にあって正解に無い駒 q を、隣の部屋へ移す。
--   その解は移した先の部屋に駒が 2 つになって成り立たなくなる。
--   正解の駒は 1 つも動かさないので、正解は解のまま。
refine :: Int -> Seed -> Puzzle -> [Pos] -> (Puzzle, Seed)
refine 0 s p _ = (p, s)
refine k s p sol =
  case filter (/= sol) (take 2 (solutions p)) of
    []          -> (p, s)
    (other : _) ->
      let (qs, s1)    = shuffle s [q | q <- other, q `notElem` sol]
          moves       = [(q, b) | q <- qs, b <- nub [roomAt p x | x <- neighbors4 (size p) q], canMove p q b]
          (moves', s2) = shuffle s1 moves
      in case moves' of
           []           -> (p, s2)
           ((q, b) : _) -> refine (k - 1) s2 (setRoom p q b) sol

-- | シードから面と、その元になった正解配置。
makePuzzle :: Seed -> Int -> (Puzzle, [Pos], Seed)
makePuzzle s n = (pz, ps, s3)
  where
    (ps, s1) = randomPlacement s n
    (rs, s2) = growRooms s1 n ps
    (pz, s3) = refine 60 s2 (Puzzle n rs) ps

-- | ステージの設定。
data StageSpec = StageSpec
  { specStage    :: Int   -- ^ ステージ番号(1 始まり)
  , specSize     :: Int   -- ^ N
  , specMaxLevel :: Int   -- ^ 許す難易度の上限(Solver.level)
  } deriving (Show)

-- | ステージ番号 → 設定。5〜10 ステージごとに盤が大きくなる。
stageSpec :: Int -> StageSpec
stageSpec n = StageSpec n sz lv
  where
    sz | n <= 5    = 5
       | n <= 10   = 6
       | n <= 20   = 7
       | n <= 30   = 8
       | n <= 40   = 9
       | otherwise = 10
    lv | n <= 10   = 0
       | otherwise = 1   -- 仮置きが要る面(level 2)は出さない
