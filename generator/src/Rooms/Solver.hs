-- | 2 つのソルバ。
--
--   1. 全探索 (solutions): 行ごとに駒を置いていく深さ優先探索。
--      解を「ちょうど 1 つ」持つ面だけを採用するために使う(take 2 で打ち切る)。
--   2. 推論 (deduceWith): 人が解くときの考え方を 3 つの規則にしたもの。
--      どの規則まで要るかで難易度を決め、ヒントにも使う。
--
--   推論の規則(候補 = まだ駒を置けるかもしれないマス):
--     Forced   ある行・列・部屋の候補が 1 つだけなら、そこに置く
--     Squeeze  ある行・列・部屋のすべての候補とぶつかるマスには置けない
--              (例: 部屋の候補が 1 行に収まるなら、その行の他のマスは消える)
--     Pair     2 つの部屋の候補が合わせて 2 つの行(列)に収まるなら、
--              その 2 行(列)の他の部屋のマスは消える
--   規則はどれも「正しい事実しか導かない」ので、適用する順番が違っても
--   最終的に残る候補は同じになる(JavaScript 側と結果を一致させられる理由)。
module Rooms.Solver
  ( solutions
  , countSolutions
  , isUnique
  , State(..)
  , initial
  , place
  , eliminate
  , openUnits
  , Rule(..)
  , basic
  , full
  , stepWith
  , deduceWith
  , solvedState
  , level
  , hintCell
  ) where

import qualified Data.Set as Set
import Data.Set (Set)
import Data.List (tails)
import Rooms.Board
import Rooms.Rules

-- | 全部の解。行 0 から順に、置ける列を試す。
solutions :: Puzzle -> [[Pos]]
solutions p = go 0 []
  where
    n = size p
    go r ps
      | r == n    = [reverse ps]
      | otherwise = concat [go (r + 1) (q : ps) | c <- [0 .. n - 1], let q = (r, c), allowed p ps q]

-- | 解の個数(cap で打ち切る)。
countSolutions :: Int -> Puzzle -> Int
countSolutions cap p = length (take cap (solutions p))

isUnique :: Puzzle -> Bool
isUnique p = countSolutions 2 p == 1

-- | 推論の途中の状態。placed は置いた駒、cands はまだ置けるかもしれないマス。
data State = State
  { placed :: [Pos]
  , cands  :: Set Pos
  } deriving (Show, Eq)

initial :: Puzzle -> State
initial p = State [] (Set.fromList (cells p))

-- | 駒を置く。その駒とぶつかるマスは候補から外す。
place :: Puzzle -> Pos -> State -> State
place p q (State ps cs) = State (q : ps) (Set.filter (\c -> c /= q && not (conflict p q c)) cs)

eliminate :: [Pos] -> State -> State
eliminate xs (State ps cs) = State ps (foldr Set.delete cs xs)

-- | まだ駒の無い単位(行・列・部屋)。
openUnits :: Puzzle -> State -> [[Pos]]
openUnits p st = [u | u <- units p, not (any (`elem` u) (placed st))]

candsIn :: State -> [Pos] -> [Pos]
candsIn st u = filter (`Set.member` cands st) u

data Rule
  = Forced Pos      -- ^ ここに置く
  | Squeeze [Pos]   -- ^ これらは消える
  | Pair [Pos]      -- ^ これらは消える(2 部屋の規則)
  deriving (Show, Eq)

forced :: Puzzle -> State -> Maybe Rule
forced p st =
  case [q | u <- openUnits p st, [q] <- [candsIn st u]] of
    (q : _) -> Just (Forced q)
    []      -> Nothing

squeeze :: Puzzle -> State -> Maybe Rule
squeeze p st
  | null xs   = Nothing
  | otherwise = Just (Squeeze xs)
  where
    cs = Set.toList (cands st)
    xs = Set.toList (Set.fromList
      [ c | u <- openUnits p st, let cu = candsIn st u, not (null cu)
          , c <- cs, c `notElem` u, all (conflict p c) cu ])

pairRule :: Puzzle -> State -> Maybe Rule
pairRule p st
  | null xs   = Nothing
  | otherwise = Just (Pair xs)
  where
    openRooms = [ (k, candsIn st u) | k <- [0 .. size p - 1], let u = roomCells p k
                                    , not (any (`elem` u) (placed st)) ]
    xs = Set.toList (Set.fromList (concat
      [ [c | c <- Set.toList (cands st), proj c `elem` ls, roomAt p c /= k1, roomAt p c /= k2]
      | ((k1, c1) : rest) <- tails openRooms, (k2, c2) <- rest
      , proj <- [fst, snd]
      , let ls = Set.toList (Set.fromList (map proj (c1 ++ c2))), length ls == 2 ]))

-- | 規則の組。basic だけで解ければやさしい面、full が要れば中くらい、
--   それでも解けなければ仮置きが要る面。
basic, full :: [Puzzle -> State -> Maybe Rule]
basic = [forced, squeeze]
full  = basic ++ [pairRule]

-- | 使える規則を順に試し、最初に使えたものを 1 回適用する。
stepWith :: [Puzzle -> State -> Maybe Rule] -> Puzzle -> State -> Maybe (Rule, State)
stepWith rs p st =
  case [r | f <- rs, Just r <- [f p st]] of
    (r : _) -> Just (r, apply r)
    []      -> Nothing
  where
    apply (Forced q)   = place p q st
    apply (Squeeze xs) = eliminate xs st
    apply (Pair xs)    = eliminate xs st

-- | 使える規則が無くなるまで繰り返す。使った規則の列と最終状態を返す。
deduceWith :: [Puzzle -> State -> Maybe Rule] -> Puzzle -> State -> ([Rule], State)
deduceWith rs p st =
  case stepWith rs p st of
    Nothing       -> ([], st)
    Just (r, st') -> let (more, final) = deduceWith rs p st' in (r : more, final)

solvedState :: Puzzle -> State -> Bool
solvedState p st = length (placed st) == size p

-- | 難易度。0: basic で解ける、1: full が要る、2: 仮置きが要る。
level :: Puzzle -> Int
level p
  | solvedState p (snd (deduceWith basic p (initial p))) = 0
  | solvedState p (snd (deduceWith full  p (initial p))) = 1
  | otherwise = 2

-- | いまの状態から推論で最初に確定する駒の位置(ヒント用)。
hintCell :: Puzzle -> State -> Maybe Pos
hintCell p st =
  case [q | Forced q <- fst (deduceWith full p st)] of
    (q : _) -> Just q
    []      -> Nothing
