-- | ルール・ソルバ・生成の検査。外部ライブラリなしの手書きテスト。
--   失敗が 1 つでもあれば終了コード 1 で終わる(cabal test が赤くなる)。
module Main (main) where

import Control.Monad (unless)
import System.Exit (exitFailure)
import System.IO (hSetEncoding, stdout, utf8)
import qualified Data.Set as Set
import Rooms.Board
import Rooms.Rules
import Rooms.Solver
import Rooms.Generate

tests :: [(String, Bool)]
tests =
  [ ("同じ行は取り合い",              attacks (0, 0) (0, 4))
  , ("同じ列は取り合い",              attacks (1, 2) (4, 2))
  , ("斜めの隣は取り合い",            attacks (1, 1) (2, 2))
  , ("離れた斜めは取り合いでない",    not (attacks (0, 0) (2, 2)))
  , ("同じマスは取り合いでない",      not (attacks (1, 1) (1, 1)))
  , ("同じ部屋はぶつかる",            conflict sample (0, 1) (2, 0))
  , ("allowed: 空の盤ならどこでも",   all (allowed sample []) (cells sample))
  , ("allowed: 置いた駒の行は不可",   not (allowed sample [(0, 0)] (0, 3)))
  , ("allowed: 置いた駒の部屋は不可", not (allowed sample [(0, 1)] (2, 0)))
  , ("isSolved: 正解は完成",          isSolved sample sampleSol)
  , ("isSolved: 1 つ欠けると未完成",  not (isSolved sample (tail sampleSol)))
  , ("solutions: sample は唯一解",    solutions sample == [sampleSol])
  , ("生成した面の正解は本当に解",    all (\(pz, sol) -> isSolved pz sol && sol `elem` solutions pz) generated)
  , ("部屋は N 個で全マスを覆う",     all roomsOk (map fst generated))
  , ("推論は正しい事実しか導かない",  all deductionSound [(pz, sol) | (pz, sol) <- generated, isUnique pz])
  , ("唯一解の面が実際に見つかる",    length [() | (pz, _) <- generated, isUnique pz] >= 20)
  , ("level は 0〜2",                 all (\(pz, _) -> level pz `elem` [0, 1, 2]) generated)
  , ("shuffle は並べ替え",            Set.fromList (fst (shuffle 7 [1 .. 10 :: Int])) == Set.fromList [1 .. 10])
  ]
  where
    -- 5×5 の面(手で作った唯一解)。部屋:
    --   0 0 1 1 1
    --   0 2 2 1 1
    --   0 2 3 3 1
    --   4 4 3 3 1
    --   4 4 4 4 4
    sample = Puzzle 5
      [ [0, 0, 1, 1, 1]
      , [0, 2, 2, 1, 1]
      , [0, 2, 3, 3, 1]
      , [4, 4, 3, 3, 1]
      , [4, 4, 4, 4, 4] ]
    sampleSol = head (solutions sample)

    generated = [(pz, sol) | s <- [1 .. 40], let n = 5 + s `mod` 3, let (pz, sol, _) = makePuzzle s n]
    roomsOk pz = Set.fromList (concat (rooms pz)) == Set.fromList [0 .. size pz - 1]
                 && all (\k -> not (null (roomCells pz k))) [0 .. size pz - 1]
    -- 推論で消した候補は正解に含まれず、置いた駒は正解に含まれる
    deductionSound (pz, sol) =
      let (_, st) = deduceWith full pz (initial pz)
      in all (`elem` sol) (placed st) && all (`Set.member` cands st) [q | q <- sol, q `notElem` placed st]

main :: IO ()
main = do
  hSetEncoding stdout utf8
  let failed = [name | (name, ok) <- tests, not ok]
  mapM_ (\(name, ok) -> putStrLn ((if ok then "  ok   " else "  FAIL ") ++ name)) tests
  putStrLn (show (length tests - length failed) ++ " / " ++ show (length tests) ++ " passed")
  unless (null failed) exitFailure
