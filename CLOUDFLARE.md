# Cloudflare Workers への移行(Vercel からの引っ越し)

## 構成
| | Vercel(これまで) | Cloudflare Workers(これから) |
|---|---|---|
| 画面 | `index.html`・`assets/` を配信 | 同じファイルを Workers の静的アセットとして配信 |
| API | `api/state.js`・`api/backups.js`(Vercel Blob に保存) | `worker/index.js`(KV「CLUB_KV」に保存) |
| 設定 | (なし) | `wrangler.jsonc`・`.assetsignore` |

APIの仕様(`/api/state`・`/api/backups` の呼び方と返り値)は同じなので、`index.html` は変更していません。
Vercel用のファイル(`api/`・`package.json`)はそのまま残してあるため、同じリポジトリで両方をデプロイできます。

## いつでも Vercel に戻せるコピー
移行前(2026-10-31)の状態を、次の3か所に残しています。

1. **Git のタグ** `vercel-final-2026-10-31`(GitHub 上)
   - 戻すとき: `git checkout vercel-final-2026-10-31` で移行前のコードを取り出せます。
     そのコードを新しいブランチにして Vercel に向けるか、`main` に反映すれば Vercel の画面・APIが移行前の内容になります。
2. **フォルダの複製** `C:\Users\Haruo\PLAYER-Class desktop_vercel_backup_2026-10-31`
   - 移行前のファイル一式(`.git` を含む)です。
3. **Vercel のプロジェクト自体** は削除していません(https://tournament-player-class.vercel.app)。

> 注意: 2026-10-31 時点で、Vercel 側の `GET /api/state` は「Vercel Blob: Failed to fetch blob: 403 Forbidden」で失敗していました。
> Vercel に戻しても、Blob の設定(アクセス権・トークン)を直さない限り、クラウド同期は動きません。
> バックアップ一覧(`/api/backups`)は取得でき、2件(2026-10-04)が見えていますが、中身の取得も同じ403になる可能性があります。

## Cloudflare 側の設定
1. Cloudflare ダッシュボード → Workers & Pages → `tournament-player-class` → Settings → Build(Git 連携)で、このリポジトリの `main` ブランチを指定します。
   - Build command: (空欄)  /  Deploy command: `npx wrangler deploy`
2. KV(データの保存先)
   - `wrangler.jsonc` の `kv_namespaces` は `id` を省いてあり、デプロイ時に自動で作成されます(Wrangler 4.45 以降)。
   - 自動で作られない場合: ダッシュボード → Storage & Databases → KV で名前空間を作り、その id を `wrangler.jsonc` の `CLUB_KV` に書き足して push します。
3. デプロイ後、`https://tournament-player-class.<アカウントのサブドメイン>.workers.dev/` を開き、画面左下が「☁ クラウドに同期済み」になれば完了です。

手元から直接デプロイする場合: `npx wrangler login` のあと `npx wrangler deploy`。ローカルでの確認は `npx wrangler dev`。

## データの引っ越し
クラウド上のデータは、新しい Workers 側では空から始まります。
アプリは、クラウドが空のとき**その端末に保存されているデータを自動でクラウドへ保存**します。

1. 最新のデータが入っている端末(いつも使っている PC など)で、新しい URL を開きます。
2. 画面左下が「☁ クラウドに同期済み」になれば、その端末のデータが Cloudflare に保存されました。
3. 他の端末は、新しい URL を開くとクラウドの内容を取得します。

> 古いデータの端末を先に開くと、古い内容がクラウドの最初のデータになってしまいます。必ず最新の端末から開いてください。
> 念のため、移行前に「設定 → データ管理」でデータを書き出しておくと安心です。

## 切り替えの注意
- Vercel と Cloudflare は**別々のデータ**を持ちます。切り替えたあとは、使う URL を1つに揃えてください。
- Vercel を残したまま `main` に push すると、Vercel も自動で再デプロイされます(画面は両方とも最新になります)。
