# 社員旅行の余興 ― 大人数参加型 謎解きWebアプリ

HTML / CSS / JavaScript だけで動く静的サイトです（サーバー・データベース不要）。GitHub Pages でそのまま公開できます。

## ファイル構成

```text
/
├── index.html      画面の土台（編集不要）
├── style.css       デザイン
├── script.js       アプリ本体（編集不要）
├── config.js       ★問題・ヒント・正解・URLなどの設定（ここを編集）
├── README.md       このファイル
├── lib/qrcode.js   QRコード生成ライブラリ（同梱。MITライセンス）
└── assets/         問題画像を置く（第1問: question1.png）
```

**使用ライブラリ:** `qrcode-generator`（Kazuhiko Arase, MIT License）を `lib/qrcode.js` として同梱。
用途は参加用QRコードの生成のみ。外部サーバーからは読み込まないので GitHub Pages でも確実に動きます。

## GitHub Pages への公開手順

1. GitHub にログインし、右上の「＋」→ **New repository** でリポジトリを作成（Public）。
2. 「uploading an existing file」から、このフォルダの **中身すべて**（`lib` と `assets` フォルダも）をドラッグ＆ドロップして Commit。
   `question1.png` を `assets` に入れるのを忘れずに。
3. リポジトリの **Settings → Pages** を開き、Source を `Deploy from a branch`、Branch を `main` / `/ (root)` にして Save。
4. 1〜2分待つと、画面上部に公開URLが表示されます（例: `https://ユーザー名.github.io/リポジトリ名/`）。
5. `config.js` を開き、`joinUrl: ""` にそのURLを貼り付けて保存（Commit）。
   ```js
   joinUrl: "https://ユーザー名.github.io/リポジトリ名/",
   ```
6. 公開URLを開き、QRコードの下に表示されるURLが正しいか確認。別のスマホで読み取って開けるか試す。
7. スマホとPCの両方で、最初から最後まで一通り動作確認する。

**リポジトリ名やURLを変えたとき:** `config.js` の `joinUrl` を新しいURLに書き換えるだけです。
（空 `""` のままだと「いま開いているURL」を自動で使います。画像などは相対パスなので修正不要です。）

## 設定の編集方法（config.js）

| やりたいこと | 場所 |
|---|---|
| タイトル | `title` |
| 制限時間（分） | `timer.limitMinutes` |
| テーブル・座席番号の上限 | `numberLimits`（既定 テーブル4・座席7）。テーブル番号0を入力すると全問題のヒントが非表示になります（0は画面に表示されません） |
| 第1問の問題文・画像 | `questions.q1.text` / `questions.q1.image` |
| 第1問のヒント | `questions.q1.hint.byRemainder`（0,1,2 は座席番号を3で割った余り） |
| 第2問の証言 | `questions.q2.testimonies`（`common` は全員、`byTable` はテーブル別） |
| 正解の候補 | 各問題の `answers`（書いたものだけが正解。ひらがな・カタカナは自動変換しません） |
| 振り返りの文字と色 | 各問題の `review.tiles`（`color: "yellow" / "red" / "blue"`） |
| 色の定義を増やす | `colors` |
| 最終問題 | `questions.final` |

**例: 第1問の正解を増やす**
```js
answers: ["光", "ひかり", "ヒカリ", "ひかリ"],
```

**例: 第2問の証言を追加（テーブル5用の証言を5番目に）**
```js
byTable: [ {speaker:"B", text:"…"}, {speaker:"C", text:"…"}, {speaker:"D", text:"…"}, {speaker:"E", text:"…"}, {speaker:"B", text:"…"} ],
```
要素数を超えたテーブル番号は先頭に戻って繰り返します。

### クロスワード（questions.q3.crossword）

- `solution` … 完成時の正解盤面（`■`が黒マス）。通常プレイ中は表示されません。
- `markers` … A〜Eの答えマス（行 `r`・列 `c` は0始まり）。
- `clues` … 鍵。`no`（番号、全体で重複不可）、`dir`（`"down"`縦 / `"across"`横）、`r,c`（開始マス）、`answer`、`text`。
  マスの長さは答えの文字数で決まります。
- `assignment` … 参加者ごとの鍵の割り当て。
  - `basedOn`: `"seatTable"` / `"seat"` / `"table"` / `"tableSeat"`
  - `"seatTable"`（既定）: 参加者番号 `(座席番号-1)×perSeat+テーブル番号` と同じ番号の鍵を1つ渡します（`perSeat` 既定4）。鍵の最大番号を超えた場合は1番から繰り返します（26→1, 27→2, 28→3）。
  - `groups`: `"seat"` / `"table"` / `"tableSeat"` のときの鍵番号のグループ。番号が増えると先頭に戻って繰り返します。
  - `common`: 全員に見せる鍵。`overrides`: `"2-3": [1,2,3]` のように特定の席だけ個別指定。
- `autoReveal` … 残り `startWhenRemainingSec` 秒（既定180秒）を切ると、`order` の順に `intervalSec` 秒ごとに答えを公開（入力済みの文字も正しい文字に置き換え、ロックします）。公開状況は端末内に保存され、再読み込みしても戻りません。

起動時に、各鍵の答えと盤面の文字が一致しているか自動検証します。URLの末尾に `?debug=1` を付けると、不一致の警告をタイトル画面に表示します。

## テスト用URLパラメータ

- `?reset=1` … この端末の進行状況を消して最初からやり直す（ゲーム中は「⚙ 設定」メニュー下部の「リセット」ボタンでも同じことができます）
- `?minutes=4` … スタート時の制限時間を4分にする（残り3分の自動公開を試すとき便利）
- `?debug=1` … 設定チェックの結果を表示

## 動作の仕様メモ

- タイマーは「開始時刻」と「現在時刻」の差から計算します。再読み込み・バックグラウンド移動でもリセットされません（端末ごとに独立）。
- 保存先はブラウザの `localStorage`（番号、開始時刻、正解状況、クロスワードの入力、公開済みの鍵）。
- 問題は順番に解きます（前の問題に正解すると次が開きます）。正解済みの問題は振り返り画面で確認できます。
- クロスワードの入力はひらがなで行います。カタカナや小さい文字（ゃ・っ等）は盤面に合わせて自動で整えます。
- 問題データが空の問題には「問題データが未設定です。」と表示され、アプリ全体は止まりません。

## 困ったとき

- 画面が「読み込み中…」のまま → `config.js` のカンマや引用符の書き間違いが多いです。ファイルを確認してください。
- 画像が出ない → `assets/question1.png` のファイル名（大文字小文字も）とアップロードを確認。
- 更新が反映されない → 数分待ってからページを再読み込み（キャッシュ）。
