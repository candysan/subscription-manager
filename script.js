// ========================================
// サブスク管理アプリ - メインスクリプト
// Supabase 対応版
// ========================================

// ----------------------------------------
// 1. Supabase の設定
// ----------------------------------------
// ▼ ここにご自身の Supabase の情報を入力してください
// Supabase ダッシュボード → Project Settings → API で確認できます

const SUPABASE_URL = "https://kmoezssvgmzjsfprvmwd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imttb2V6c3N2Z216anNmcHJ2bXdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MjM5NjEsImV4cCI6MjA5MTI5OTk2MX0.BQ8wJRLmhARsVz5_g1Cl3GBy4pOvwGDF7bLoviaYy3M";

// Supabase クライアントを初期化する
// window.supabase は CDN で読み込んだライブラリ
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ----------------------------------------
// 2. アプリの状態
// ----------------------------------------
let subscriptions = [];    // サブスクリプション一覧
let currentFilter = "all"; // 絞り込みフィルタ ("all" / "work" / "private")
// ----------------------------------------
// 3. 認証 (ログイン・ログアウト)
// ----------------------------------------

// ログインフォームの送信
document.getElementById("authForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const email    = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value;
  const errorEl  = document.getElementById("authError");
  errorEl.textContent = "";
  errorEl.style.color = "#c0392b";

  const result = await db.auth.signInWithPassword({ email, password });

  if (result.error) {
    errorEl.textContent = translateAuthError(result.error.message);
    return;
  }
  // ログイン成功時は onAuthStateChange が自動的に発火して画面が切り替わる
});

// エラーメッセージを英語から日本語に変換する
function translateAuthError(msg) {
  if (msg.includes("Invalid login credentials")) return "メールアドレスまたはパスワードが正しくありません。";
  if (msg.includes("Email not confirmed"))        return "メールアドレスが確認されていません。確認メールをご確認ください。";
  if (msg.includes("User already registered"))    return "このメールアドレスはすでに登録されています。";
  if (msg.includes("Password should be"))         return "パスワードは6文字以上にしてください。";
  if (msg.includes("Unable to validate"))         return "入力内容を確認してください。";
  return msg; // 上記以外はそのまま表示
}

// ログアウトボタン
document.getElementById("logoutBtn").addEventListener("click", async function () {
  await db.auth.signOut();
  // signOut 後は onAuthStateChange が発火してログイン画面に戻る
});

// 認証状態の変化を監視する
// ページ読み込み時・ログイン時・ログアウト時に自動的に呼ばれる
db.auth.onAuthStateChange(async function (event, session) {
  if (session) {
    // ===== ログイン済み =====
    // ログイン画面を隠してメインコンテンツを表示する
    document.getElementById("loginSection").style.display = "none";
    document.getElementById("appHeader").style.display    = "flex";
    document.getElementById("mainContent").style.display  = "block";

    // ヘッダーにメールアドレスを表示
    document.getElementById("userEmail").textContent = session.user.email;

    // Supabase からデータを読み込んで一覧を表示する
    await loadSubscriptions();
    renderList();
    updateSummary();

  } else {
    // ===== 未ログイン =====
    // メインコンテンツを隠してログイン画面を表示する
    document.getElementById("loginSection").style.display = "block";
    document.getElementById("appHeader").style.display    = "none";
    document.getElementById("mainContent").style.display  = "none";

    // データをクリア
    subscriptions = [];
  }
});

// ----------------------------------------
// 4. データの読み書き (Supabase)
// ----------------------------------------

// DB のカラム名 (snake_case) → JS のプロパティ名 (camelCase) に変換する
// Postgres は snake_case が標準、JavaScript は camelCase が標準なので変換が必要
function dbToJs(row) {
  return {
    id:          row.id,
    serviceName: row.service_name,
    category:    row.category,
    currency:    row.currency,
    monthlyFee:  row.monthly_fee,
    yearlyFee:   row.yearly_fee,
    renewalDate: row.renewal_date,
    status:      row.status,
  };
}

// Supabase からサブスクリプション一覧を読み込む
async function loadSubscriptions() {
  const { data, error } = await db
    .from("subscriptions")   // テーブル名
    .select("*")             // すべてのカラムを取得
    .order("created_at", { ascending: false }); // 新しい順に並べる

  if (error) {
    console.error("データ読み込みエラー:", error.message);
    return;
  }

  // DB形式 → JS形式に変換して保存
  subscriptions = data.map(dbToJs);
}

// ----------------------------------------
// 5. ユーティリティ関数
// ----------------------------------------

// 金額を通貨に合わせてフォーマットする
function formatAmount(amount, currency) {
  if (amount === null || amount === undefined || amount === "") return "-";
  if (currency === "JPY") return "¥" + Number(amount).toLocaleString();
  return "$" + Number(amount).toFixed(2);
}

// ステータスの英語キー → 日本語ラベル
const STATUS_LABEL = {
  active:      "利用中",
  considering: "解約検討中",
  cancelled:   "解約済み",
};

// カテゴリの英語キー → 日本語ラベル
const CATEGORY_LABEL = {
  work:    "仕事",
  private: "プライベート",
  tax:     "税金",
};

// ----------------------------------------
// 6. 合計金額の計算と表示
// ----------------------------------------

// 指定したカテゴリ・通貨・フィールドの合計を計算する
function calcTotal(list, category, currency, field) {
  return list
    .filter(function (s) {
      if (s.status === "cancelled") return false; // 解約済みは除外
      if (category && s.category !== category) return false;
      return s.currency === currency;
    })
    .reduce(function (sum, s) {
      return sum + (Number(s[field]) || 0);
    }, 0);
}

// 合計エリアの表示を更新する
function updateSummary() {
  // 円とドルを "¥1,000 / $9.99" の形式でまとめる
  function formatBoth(jpy, usd) {
    const parts = [];
    if (jpy > 0) parts.push("¥" + jpy.toLocaleString());
    if (usd > 0) parts.push("$" + usd.toFixed(2));
    return parts.length > 0 ? parts.join(" / ") : "¥0";
  }

  document.getElementById("totalMonthly").textContent    = formatBoth(calcTotal(subscriptions, null,      "JPY", "monthlyFee"), calcTotal(subscriptions, null,      "USD", "monthlyFee"));
  document.getElementById("totalYearly").textContent     = formatBoth(calcTotal(subscriptions, null,      "JPY", "yearlyFee"),  calcTotal(subscriptions, null,      "USD", "yearlyFee"));
  document.getElementById("workMonthly").textContent     = formatBoth(calcTotal(subscriptions, "work",    "JPY", "monthlyFee"), calcTotal(subscriptions, "work",    "USD", "monthlyFee"));
  document.getElementById("workYearly").textContent      = formatBoth(calcTotal(subscriptions, "work",    "JPY", "yearlyFee"),  calcTotal(subscriptions, "work",    "USD", "yearlyFee"));
  document.getElementById("privateMonthly").textContent  = formatBoth(calcTotal(subscriptions, "private", "JPY", "monthlyFee"), calcTotal(subscriptions, "private", "USD", "monthlyFee"));
  document.getElementById("privateYearly").textContent   = formatBoth(calcTotal(subscriptions, "private", "JPY", "yearlyFee"),  calcTotal(subscriptions, "private", "USD", "yearlyFee"));
  document.getElementById("taxMonthly").textContent      = formatBoth(calcTotal(subscriptions, "tax",     "JPY", "monthlyFee"), calcTotal(subscriptions, "tax",     "USD", "monthlyFee"));
  document.getElementById("taxYearly").textContent       = formatBoth(calcTotal(subscriptions, "tax",     "JPY", "yearlyFee"),  calcTotal(subscriptions, "tax",     "USD", "yearlyFee"));
}

// ----------------------------------------
// 7. 一覧テーブルの描画
// ----------------------------------------

function renderList() {
  const tbody    = document.getElementById("subscList");
  const emptyMsg = document.getElementById("emptyMessage");

  // 絞り込みフィルタを適用する
  const filtered = subscriptions.filter(function (s) {
    if (currentFilter === "all") return true;
    return s.category === currentFilter;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  tbody.innerHTML = filtered.map(function (s) {
    const categoryBadge =
      `<span class="category-badge category-${s.category}">${CATEGORY_LABEL[s.category]}</span>`;

    const statusBadge =
      `<span class="status-badge status-${s.status}">${STATUS_LABEL[s.status]}</span>`;

    const statusSelect =
      `<select class="action-select" onchange="changeStatus('${s.id}', this.value)">` +
      `<option value="active"      ${s.status === "active"      ? "selected" : ""}>利用中</option>` +
      `<option value="considering" ${s.status === "considering" ? "selected" : ""}>解約検討中</option>` +
      `<option value="cancelled"   ${s.status === "cancelled"   ? "selected" : ""}>解約済み</option>` +
      `</select>`;

    const deleteBtn =
      `<button class="delete-btn" onclick="deleteItem('${s.id}')">削除</button>`;

    return (
      `<tr>` +
      `<td>${categoryBadge}</td>` +
      `<td>${s.serviceName}</td>` +
      `<td>${formatAmount(s.monthlyFee, s.currency)}</td>` +
      `<td>${formatAmount(s.yearlyFee,  s.currency)}</td>` +
      `<td>${s.renewalDate || "-"}</td>` +
      `<td>${statusBadge}</td>` +
      `<td>${statusSelect}${deleteBtn}</td>` +
      `</tr>`
    );
  }).join("");
}

// ----------------------------------------
// 8. データの追加・変更・削除
// ----------------------------------------

// フォームの送信: 新しいサービスを Supabase に追加する
document.getElementById("subscForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const serviceName = document.getElementById("serviceName").value.trim();
  const category    = document.getElementById("category").value;
  const currency    = document.getElementById("currency").value;
  const monthlyFee  = document.getElementById("monthlyFee").value;
  const yearlyFee   = document.getElementById("yearlyFee").value;
  const renewalDate = document.getElementById("renewalDate").value;
  const status      = document.getElementById("status").value;

  // Supabase にデータを挿入する
  // .select() をつけることで挿入後のデータを受け取れる
  const { data, error } = await db
    .from("subscriptions")
    .insert([{
      service_name: serviceName,
      category:     category,
      currency:     currency,
      monthly_fee:  monthlyFee  || null, // 空欄の場合は null を入れる
      yearly_fee:   yearlyFee   || null,
      renewal_date: renewalDate || null,
      status:       status,
    }])
    .select();

  if (error) {
    console.error("追加エラー:", error.message);
    alert("追加に失敗しました。再度お試しください。");
    return;
  }

  // 画面の先頭に追加して再描画
  subscriptions.unshift(dbToJs(data[0]));
  renderList();
  updateSummary();
  e.target.reset(); // フォームをリセット
});

// ステータスを変更する
async function changeStatus(id, newStatus) {
  const { error } = await db
    .from("subscriptions")
    .update({ status: newStatus }) // status カラムを更新
    .eq("id", id);                 // id が一致する行だけ対象にする

  if (error) {
    console.error("更新エラー:", error.message);
    return;
  }

  // ローカルのデータも更新して再描画
  subscriptions = subscriptions.map(function (s) {
    if (s.id === id) return Object.assign({}, s, { status: newStatus });
    return s;
  });
  renderList();
  updateSummary();
}

// サービスを削除する
async function deleteItem(id) {
  if (!confirm("このサービスを削除してもよいですか？")) return;

  const { error } = await db
    .from("subscriptions")
    .delete()      // 削除
    .eq("id", id); // id が一致する行だけ対象にする

  if (error) {
    console.error("削除エラー:", error.message);
    return;
  }

  // ローカルのデータからも除外して再描画
  subscriptions = subscriptions.filter(function (s) { return s.id !== id; });
  renderList();
  updateSummary();
}

// ----------------------------------------
// 9. 絞り込みボタン
// ----------------------------------------

document.querySelectorAll(".filter-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    currentFilter = btn.getAttribute("data-filter");

    document.querySelectorAll(".filter-btn").forEach(function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");

    renderList();
  });
});
