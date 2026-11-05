-- | 面データとテストベクタを JSON で書き出す。IO はこのファイルに閉じ込める。
--   使い方:  cabal run gen            (../web に書く)
--            cabal run gen -- <出力先>
module Main (main) where

import System.Environment (getArgs)
import System.IO
import qualified Data.Set as Set
import Rooms.Board
import Rooms.Rules
import Rooms.Solver
import Rooms.Generate
import Rooms.Json

stageCount, variantCount :: Int
stageCount   = 50
variantCount = 3

-- | ステージ 1 面ぶんの結果。
data Stage = Stage
  { stSpec     :: StageSpec
  , stSeed     :: Seed
  , stPuzzle   :: Puzzle
  , stSolution :: [Pos]
  , stLevel    :: Int
  , stSteps    :: Int     -- ^ 推論の手数(難しさの目安)
  }

-- | シードを順に試し、解がちょうど 1 つで難易度が範囲内の面を見つける。
--   後半のステージ(maxLevel ≥ 1)では、やさしすぎる面(level 0)を避ける。
--   ただし 400 シード試して見つからなければ level 0 でも採用する。
findStage :: StageSpec -> Seed -> Stage
findStage spec seed0 = go seed0 (0 :: Int)
  where
    go seed tries
      | isUnique pz && (lv <= specMaxLevel spec || tries > 3000) && (lv >= wantMin || tries > 400) =
          Stage spec seed pz sol lv (length (fst (deduceWith full pz (initial pz))))
      | otherwise = go (nextSeed seed) (tries + 1)
      where
        (pz, sol, _) = makePuzzle seed (specSize spec)
        lv = level pz
    wantMin = if specMaxLevel spec >= 1 && specStage spec > 12 then 1 else 0

stageVariants :: Int -> [Stage]
stageVariants n = [findStage (stageSpec n) (n * 100003 + 7 + k * 104729) | k <- [0 .. variantCount - 1]]

stageJson :: [Stage] -> Json
stageJson sts@(st : _) = jObj
  [ ("stage",  jInt (specStage (stSpec st)))
  , ("size",   jInt (specSize (stSpec st)))
  , ("boards", jList (map boardJson sts))
  ]
stageJson [] = jNull

boardJson :: Stage -> Json
boardJson st = jObj
  [ ("seed",     jInt (stSeed st))
  , ("level",    jInt (stLevel st))
  , ("steps",    jInt (stSteps st))
  , ("rooms",    roomsJson (stPuzzle st))
  , ("solution", jList [jInt c | (_, c) <- stSolution st])   -- 行ごとの列
  ]

roomsJson :: Puzzle -> Json
roomsJson p = jList [jList (map jInt row) | row <- rooms p]

-- | テストベクタ: ランダムな面と途中の配置に対する各関数の結果。
--   面は唯一解とは限らない(solutions の個数も検査対象)。
data Vector = Vector
  { vPuzzle   :: Puzzle
  , vPlaced   :: [Pos]
  , vCorrect  :: [Pos]         -- ^ vPlaced のうち正解の駒(推論の出発点)
  , vAllowed  :: [Bool]        -- ^ 全マス(読み順)に置けるか
  , vConflicts :: Int
  , vSolutions :: Int          -- ^ 3 で打ち切り
  , vLevel    :: Int
  , vHint     :: Maybe Pos
  , vDeduced  :: [Pos]         -- ^ full で推論したあとの候補(読み順)
  }

makeVector :: Seed -> Vector
makeVector seed = Vector pz placed' (take k sol) allowedAll (length (conflicts pz placed')) (countSolutions 3 pz) (level pz) hint deduced
  where
    n  = 5 + seed `mod` 4
    (pz, sol, s2) = makePuzzle seed n
    -- 途中の配置: 正解の駒を 0〜2 個と、別の配置から 0〜1 個(ぶつかることがある)
    k  = below (nextSeed s2) 3
    (other, _) = randomPlacement (seed * 31 + 5) n
    extra = if below (nextSeed (nextSeed s2)) 2 == 0 then [] else take 1 (drop 2 other)
    placed' = take k sol ++ extra
    allowedAll = [allowed pz placed' q | q <- cells pz]
    st0 = foldr (place pz) (initial pz) (take k sol)
    hint = hintCell pz st0
    deduced = Set.toList (cands (snd (deduceWith full pz st0)))

vectorJson :: Vector -> Json
vectorJson v = jObj
  [ ("size",      jInt (size (vPuzzle v)))
  , ("rooms",     roomsJson (vPuzzle v))
  , ("placed",    jList [jList [jInt r, jInt c] | (r, c) <- vPlaced v])
  , ("placedCorrect", jList [jList [jInt r, jInt c] | (r, c) <- vCorrect v])
  , ("allowed",   jList (map jBool (vAllowed v)))
  , ("conflicts", jInt (vConflicts v))
  , ("solutions", jInt (vSolutions v))
  , ("level",     jInt (vLevel v))
  , ("hint",      maybe jNull (\(r, c) -> jList [jInt r, jInt c]) (vHint v))
  , ("deduced",   jList [jList [jInt r, jInt c] | (r, c) <- vDeduced v])
  ]

main :: IO ()
main = do
  args <- getArgs
  let outDir = case args of
        (d : _) -> d
        []      -> "../web"
  hSetEncoding stdout utf8
  hSetBuffering stdout LineBuffering
  let stages = map stageVariants [1 .. stageCount]
  mapM_ (mapM_ report) stages
  writeFile (outDir ++ "/levels/stages.json") (render (jList (map stageJson stages)))
  let vectors = [makeVector (s * 7919 + 1) | s <- [1 .. 40]]
  writeFile (outDir ++ "/test/vectors.json") (render (jList (map vectorJson vectors)))
  putStrLn ("wrote " ++ show (length stages) ++ " stages x " ++ show variantCount ++ " boards, " ++ show (length vectors) ++ " vectors")
  where
    report st = putStrLn $ concat
      [ "stage ", show (specStage (stSpec st))
      , " seed=", show (stSeed st)
      , " size=", show (specSize (stSpec st))
      , " level=", show (stLevel st)
      , " steps=", show (stSteps st)
      ]
