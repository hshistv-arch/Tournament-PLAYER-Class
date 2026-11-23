// 合言葉のハッシュを作る(Worker のシークレット ADMIN_PASS_HASH に登録する値)。
//   node scripts/make-pass-hash.mjs
// 合言葉は画面に表示されず、ファイルにも保存されません。出力された1行(pbkdf2$…)だけを、次のコマンドで登録します。
//   npx wrangler secret put ADMIN_PASS_HASH
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const ITERATIONS = 100000;   // Workers の PBKDF2 は 100000 回が上限

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";
    stdin.on("data", function onData(ch) {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (c === "\u0003") process.exit(1);   // Ctrl+C
        if (c === "\u007f" || c === "\b") input = input.slice(0, -1);
        else input += c;
      }
    });
  });
}

const a = await askHidden("合言葉を入力: ");
if (a.length < 8) { console.error("合言葉は8文字以上にしてください。"); process.exit(1); }
const b = await askHidden("もう一度入力: ");
if (a !== b) { console.error("2回の入力が一致しません。"); process.exit(1); }

const salt = randomBytes(16);
const hash = pbkdf2Sync(a, salt, ITERATIONS, 32, "sha256");
console.log("\n次の1行が登録する値です:\n");
const line = ["pbkdf2", ITERATIONS, salt.toString("hex"), hash.toString("hex")].join("$");
console.log(line);
if (process.platform === "win32") {   // Windows では、そのままクリップボードにもコピーする(貼り付けるだけで登録できる)
  const r = spawnSync("clip", { input: line });
  if (r.status === 0) console.log("\n(上の1行は、クリップボードにコピー済みです。そのまま貼り付けできます)");
}
