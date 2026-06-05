// ========================================
// サブスク管理アプリ - メインスクリプト
// Supabase 対応版
// ========================================

// ----------------------------------------
// 1. Supabase の設定
// ----------------------------------------

const SUPABASE_URL = "https://kmoezssvgmzjsfprvmwd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imttb2V6c3N2Z216anNmcHJ2bXdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MjM5NjEsImV4cCI6MjA5MTI5OTk2MX0.BQ8wJRLmhARsVz5_g1Cl3GBy4pOvwGDF7bLoviaYy3M";

// 認証のみ Supabase クライアントを使う（データ操作は fetch() を直接使う）
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
  }
});

// REST API のベース URL
const REST_URL = SUPABASE_URL + "/rest/v1";

// 現在のアクセストークン（ログイン時に保存する）
let accessToken = null;

// REST API 用のリクエストヘッダーを生成する
function getHeaders() {
  return {
    "Authorization": "Bearer " + accessToken,
    "apikey":        SUPABASE_KEY,
    "Content-Type":  "application/json",
  };
}

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
  // ログイン成功時は onAuthStateChange が発火して画面が切り替わる
});

// エラーメッセージを日本語に変換する
function translateAuthError(msg) {
  if (msg.includes("Invalid login credentials")) return "メールアドレスまたはパスワードが正しくありません。";
  if (msg.includes("Email not confirmed"))        return "メールアドレスが確認されていません。";
  if (msg.includes("Password should be"))         return "パスワードは6文字以上にしてください。";
  return msg;
}

// ログアウトボタン
document.getElementById("logoutBtn").addEventListener("click", async function () {
  accessToken = null;
  await db.auth.signOut();
});

// ログイン済みのときにメインコンテンツを表示する
async function showApp(session) {
  accessToken = session.access_token; // トークンを保存
  document.getElementById("loginSection").style.display = "none";
  document.getElementById("appHeader").style.display    = "flex";
  document.getElementById("mainContent").style.display  = "block";
  document.getElementById("userEmail").textContent      = session.user.email;
  await loadSubscriptions();
  renderList();
  updateSummary();
}

// ログイン画面に戻す
function showLogin() {
  accessToken    = null;
  subscriptions  = [];
  document.getElementById("loginSection").style.display = "block";
  document.getElementById("appHeader").style.display    = "none";
  document.getElementById("mainContent").style.display  = "none";
}

// ページ読み込み時: localStorage のセッションを確認する
(async function () {
  const { data } = await db.auth.getSession();
  const session  = data?.session;

  if (!session) { showLogin(); return; }

  // トークンの有効期限を確認する
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && now >= session.expires_at) {
    await db.auth.signOut();
    showLogin();
    return;
  }

  await showApp(session);
})();

// ログイン・ログアウト時のイベント監視
db.auth.onAuthStateChange(async function (event, session) {
  if (event === "SIGNED_IN") {
    await showApp(session);
  } else if (event === "SIGNED_OUT") {
    showLogin();
  }
});

// ----------------------------------------
// 4. データの読み書き (fetch で直接 REST API を呼ぶ)
// ----------------------------------------

// DB のカラム名 (snake_case) → JS のプロパティ名 (camelCase) に変換する
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

// サブスクリプション一覧を取得する
async function loadSubscriptions() {
  const res = await fetch(
    REST_URL + "/subscriptions?order=created_at.desc",
    { headers: getHeaders() }
  );

  if (!res.ok) {
    console.error("読み込みエラー:", res.status);
    return;
  }

  const data = await res.json();
  subscriptions = data.map(dbToJs);
}

// ----------------------------------------
// 5. ユーティリティ関数
// ----------------------------------------

function formatAmount(amount, currency) {
  if (amount === null || amount === undefined || amount === "") return "-";
  if (currency === "JPY") return "¥" + Number(amount).toLocaleString();
  return "$" + Number(amount).toFixed(2);
}

const STATUS_LABEL = {
  active:      "利用中",
  considering: "解約検討中",
  cancelled:   "解約済み",
};

const CATEGORY_LABEL = {
  work:    "仕事",
  private: "プライベート",
  tax:     "税金",
};

// ----------------------------------------
// 6. 合計金額の計算と表示
// ----------------------------------------

function calcTotal(list, category, currency, field) {
  return list
    .filter(function (s) {
      if (s.status === "cancelled") return false;
      if (category && s.category !== category) return false;
      return s.currency === currency;
    })
    .reduce(function (sum, s) {
      return sum + (Number(s[field]) || 0);
    }, 0);
}

function updateSummary() {
  function formatBoth(jpy, usd) {
    const parts = [];
    if (jpy > 0) parts.push("¥" + jpy.toLocaleString());
    if (usd > 0) parts.push("$" + usd.toFixed(2));
    return parts.length > 0 ? parts.join(" / ") : "¥0";
  }

  document.getElementById("totalMonthly").textContent    = formatBoth(calcTotal(subscriptions, null,      "JPY", "monthlyFee"), calcTotal(subscriptions, null,      "USD", "monthlyFee"));
  document.getElementById("totalYearly").textContent     = formatBoth(calcTotal(subscriptions, null,      "JPY", "yearlyFee"),  calcTotal(subscriptions, null,      "USD", "yearlyFee"));
  document.getElementById("totalAnnual").textContent     = formatBoth(calcTotal(subscriptions, null,      "JPY", "monthlyFee") * 12 + calcTotal(subscriptions, null,      "JPY", "yearlyFee"), calcTotal(subscriptions, null,      "USD", "monthlyFee") * 12 + calcTotal(subscriptions, null,      "USD", "yearlyFee"));
  document.getElementById("workMonthly").textContent     = formatBoth(calcTotal(subscriptions, "work",    "JPY", "monthlyFee"), calcTotal(subscriptions, "work",    "USD", "monthlyFee"));
  document.getElementById("workYearly").textContent      = formatBoth(calcTotal(subscriptions, "work",    "JPY", "yearlyFee"),  calcTotal(subscriptions, "work",    "USD", "yearlyFee"));
  document.getElementById("workAnnual").textContent      = formatBoth(calcTotal(subscriptions, "work",    "JPY", "monthlyFee") * 12 + calcTotal(subscriptions, "work",    "JPY", "yearlyFee"), calcTotal(subscriptions, "work",    "USD", "monthlyFee") * 12 + calcTotal(subscriptions, "work",    "USD", "yearlyFee"));
  document.getElementById("privateMonthly").textContent  = formatBoth(calcTotal(subscriptions, "private", "JPY", "monthlyFee"), calcTotal(subscriptions, "private", "USD", "monthlyFee"));
  document.getElementById("privateYearly").textContent   = formatBoth(calcTotal(subscriptions, "private", "JPY", "yearlyFee"),  calcTotal(subscriptions, "private", "USD", "yearlyFee"));
  document.getElementById("privateAnnual").textContent   = formatBoth(calcTotal(subscriptions, "private", "JPY", "monthlyFee") * 12 + calcTotal(subscriptions, "private", "JPY", "yearlyFee"), calcTotal(subscriptions, "private", "USD", "monthlyFee") * 12 + calcTotal(subscriptions, "private", "USD", "yearlyFee"));
  document.getElementById("taxMonthly").textContent      = formatBoth(calcTotal(subscriptions, "tax",     "JPY", "monthlyFee"), calcTotal(subscriptions, "tax",     "USD", "monthlyFee"));
  document.getElementById("taxYearly").textContent       = formatBoth(calcTotal(subscriptions, "tax",     "JPY", "yearlyFee"),  calcTotal(subscriptions, "tax",     "USD", "yearlyFee"));
  document.getElementById("taxAnnual").textContent       = formatBoth(calcTotal(subscriptions, "tax",     "JPY", "monthlyFee") * 12 + calcTotal(subscriptions, "tax",     "JPY", "yearlyFee"), calcTotal(subscriptions, "tax",     "USD", "monthlyFee") * 12 + calcTotal(subscriptions, "tax",     "USD", "yearlyFee"));
}

// ----------------------------------------
// 7. 次の更新日を計算する
// ----------------------------------------

function calcNextRenewalDate(renewalDate, monthlyFee, yearlyFee) {
  if (!renewalDate) return { date: null, isAuto: false };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const original = new Date(renewalDate);
  if (original >= today) return { date: renewalDate, isAuto: false };

  const isMonthly = monthlyFee && Number(monthlyFee) > 0;
  let date = new Date(original);

  while (date < today) {
    if (isMonthly) {
      date.setMonth(date.getMonth() + 1);
    } else {
      date.setFullYear(date.getFullYear() + 1);
    }
  }

  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, "0");
  const dd   = String(date.getDate()).padStart(2, "0");
  return { date: yyyy + "-" + mm + "-" + dd, isAuto: true };
}

// ----------------------------------------
// 8. 一覧テーブルの描画
// ----------------------------------------

function renderList() {
  const tbody    = document.getElementById("subscList");
  const emptyMsg = document.getElementById("emptyMessage");

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

    const editBtn =
      `<button class="edit-btn" onclick="startEdit('${s.id}', '${s.serviceName.replace(/'/g, "\\'")}')">編集</button>`;

    const deleteBtn =
      `<button class="delete-btn" onclick="deleteItem('${s.id}')">削除</button>`;

    const renewal = calcNextRenewalDate(s.renewalDate, s.monthlyFee, s.yearlyFee);
    let renewalDisplay = "-";
    if (renewal.date) {
      renewalDisplay = renewal.isAuto
        ? `<span class="renewal-auto">${renewal.date}<br><small>自動更新</small></span>`
        : renewal.date;
    }

    return (
      `<tr id="row-${s.id}">` +
      `<td>${categoryBadge}</td>` +
      `<td id="name-cell-${s.id}">${s.serviceName}</td>` +
      `<td>${formatAmount(s.monthlyFee, s.currency)}</td>` +
      `<td>${formatAmount(s.yearlyFee,  s.currency)}</td>` +
      `<td>${renewalDisplay}</td>` +
      `<td>${statusBadge}</td>` +
      `<td>${statusSelect}${editBtn}${deleteBtn}</td>` +
      `</tr>`
    );
  }).join("");
}

// ----------------------------------------
// 9. サービス名のインライン編集
// ----------------------------------------

function startEdit(id, currentName) {
  const cell = document.getElementById("name-cell-" + id);
  if (!cell) return;

  cell.innerHTML =
    `<input type="text" id="edit-input-${id}" class="edit-input" value="${currentName}" />` +
    `<div class="edit-actions">` +
    `<button class="save-btn" onclick="saveEdit('${id}')">保存</button>` +
    `<button class="cancel-btn" onclick="cancelEdit('${id}', '${currentName.replace(/'/g, "\\'")}')">キャンセル</button>` +
    `</div>`;

  const input = document.getElementById("edit-input-" + id);
  input.focus();
  input.select();

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter")  saveEdit(id);
    if (e.key === "Escape") cancelEdit(id, currentName);
  });
}

async function saveEdit(id) {
  const input = document.getElementById("edit-input-" + id);
  if (!input) return;

  const newName = input.value.trim();
  if (!newName) { alert("サービス名を入力してください。"); return; }

  const res = await fetch(
    REST_URL + "/subscriptions?id=eq." + id,
    {
      method:  "PATCH",
      headers: Object.assign({}, getHeaders(), { "Prefer": "return=representation" }),
      body:    JSON.stringify({ service_name: newName }),
    }
  );

  if (!res.ok) { console.error("編集エラー:", res.status); return; }

  subscriptions = subscriptions.map(function (s) {
    if (s.id === id) return Object.assign({}, s, { serviceName: newName });
    return s;
  });
  renderList();
}

function cancelEdit(id, originalName) {
  const cell = document.getElementById("name-cell-" + id);
  if (cell) cell.innerHTML = originalName;
}

// ----------------------------------------
// 10. データの追加・変更・削除
// ----------------------------------------

// 新しいサービスを追加する
document.getElementById("subscForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const serviceName = document.getElementById("serviceName").value.trim();
  const category    = document.getElementById("category").value;
  const currency    = document.getElementById("currency").value;
  const monthlyFee  = document.getElementById("monthlyFee").value;
  const yearlyFee   = document.getElementById("yearlyFee").value;
  const renewalDate = document.getElementById("renewalDate").value;
  const status      = document.getElementById("status").value;

  const res = await fetch(
    REST_URL + "/subscriptions",
    {
      method:  "POST",
      headers: Object.assign({}, getHeaders(), { "Prefer": "return=representation" }),
      body: JSON.stringify({
        service_name: serviceName,
        category:     category,
        currency:     currency,
        monthly_fee:  monthlyFee  || null,
        yearly_fee:   yearlyFee   || null,
        renewal_date: renewalDate || null,
        status:       status,
      }),
    }
  );

  if (!res.ok) {
    console.error("追加エラー:", res.status);
    alert("追加に失敗しました。再度お試しください。");
    return;
  }

  const data = await res.json();
  subscriptions.unshift(dbToJs(data[0]));
  renderList();
  updateSummary();
  e.target.reset();
});

// ステータスを変更する
async function changeStatus(id, newStatus) {
  const res = await fetch(
    REST_URL + "/subscriptions?id=eq." + id,
    {
      method:  "PATCH",
      headers: getHeaders(),
      body:    JSON.stringify({ status: newStatus }),
    }
  );

  if (!res.ok) { console.error("更新エラー:", res.status); return; }

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

  const res = await fetch(
    REST_URL + "/subscriptions?id=eq." + id,
    { method: "DELETE", headers: getHeaders() }
  );

  if (!res.ok) { console.error("削除エラー:", res.status); return; }

  subscriptions = subscriptions.filter(function (s) { return s.id !== id; });
  renderList();
  updateSummary();
}

// ----------------------------------------
// 11. 絞り込みボタン
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
