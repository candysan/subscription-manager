// ========================================
// サブスク管理アプリ - メインスクリプト
// ========================================

// ----------------------------------------
// 1. データの保存と読み込み (localStorage)
// ----------------------------------------
// localStorage はブラウザに小さなデータを保存できる仕組みです。
// ページを再読み込みしてもデータが消えません。

/**
 * localStorageからサブスクリプション一覧を読み込む
 * @returns {Array} サブスクリプションの配列
 */
function loadSubscriptions() {
  const data = localStorage.getItem("subscriptions");
  // データがあればJSONから配列に変換、なければ空の配列を返す
  return data ? JSON.parse(data) : [];
}

/**
 * サブスクリプション一覧をlocalStorageに保存する
 * @param {Array} list - 保存するサブスクリプションの配列
 */
function saveSubscriptions(list) {
  // 配列をJSON文字列に変換して保存する
  localStorage.setItem("subscriptions", JSON.stringify(list));
}

// アプリ起動時にデータを読み込む
let subscriptions = loadSubscriptions();

// 現在の絞り込み状態 ("all" / "work" / "private")
let currentFilter = "all";

// ----------------------------------------
// 2. ユーティリティ関数
// ----------------------------------------

/**
 * 金額を通貨に合わせてフォーマットする
 * @param {number} amount - 金額
 * @param {string} currency - "JPY" または "USD"
 * @returns {string} フォーマットされた文字列 (例: "¥990" / "$9.99")
 */
function formatAmount(amount, currency) {
  if (amount === null || amount === undefined || amount === "") return "-";
  if (currency === "JPY") {
    return "¥" + Number(amount).toLocaleString(); // カンマ区切りで表示
  }
  return "$" + Number(amount).toFixed(2); // ドルは小数点2桁
}

/**
 * ステータスの英語キーを日本語ラベルに変換する
 */
const STATUS_LABEL = {
  active: "利用中",
  considering: "解約検討中",
  cancelled: "解約済み",
};

/**
 * カテゴリの英語キーを日本語ラベルに変換する
 */
const CATEGORY_LABEL = {
  work: "仕事",
  private: "プライベート",
};

// ----------------------------------------
// 3. 合計金額の計算と表示
// ----------------------------------------

/**
 * 指定したカテゴリ・通貨のサブスクを合計する
 * @param {Array} list - 対象のサブスクリプション配列
 * @param {string|null} category - "work" / "private" / null(全体)
 * @param {string} currency - "JPY" / "USD"
 * @param {string} field - "monthlyFee" / "yearlyFee"
 * @returns {number} 合計金額
 */
function calcTotal(list, category, currency, field) {
  return list
    .filter(function (s) {
      // 解約済みは合計から除外
      if (s.status === "cancelled") return false;
      // カテゴリが指定されている場合はフィルタ
      if (category && s.category !== category) return false;
      // 通貨でフィルタ
      return s.currency === currency;
    })
    .reduce(function (sum, s) {
      // 金額が入力されている場合だけ加算
      return sum + (Number(s[field]) || 0);
    }, 0);
}

/**
 * 合計エリアの表示を更新する
 */
function updateSummary() {
  // 円の合計
  const totalMonthlyJPY = calcTotal(subscriptions, null, "JPY", "monthlyFee");
  const totalYearlyJPY  = calcTotal(subscriptions, null, "JPY", "yearlyFee");
  const workMonthlyJPY  = calcTotal(subscriptions, "work", "JPY", "monthlyFee");
  const workYearlyJPY   = calcTotal(subscriptions, "work", "JPY", "yearlyFee");
  const privMonthlyJPY  = calcTotal(subscriptions, "private", "JPY", "monthlyFee");
  const privYearlyJPY   = calcTotal(subscriptions, "private", "JPY", "yearlyFee");

  // ドルの合計
  const totalMonthlyUSD = calcTotal(subscriptions, null, "USD", "monthlyFee");
  const totalYearlyUSD  = calcTotal(subscriptions, null, "USD", "yearlyFee");
  const workMonthlyUSD  = calcTotal(subscriptions, "work", "USD", "monthlyFee");
  const workYearlyUSD   = calcTotal(subscriptions, "work", "USD", "yearlyFee");
  const privMonthlyUSD  = calcTotal(subscriptions, "private", "USD", "monthlyFee");
  const privYearlyUSD   = calcTotal(subscriptions, "private", "USD", "yearlyFee");

  /**
   * 円とドルを両方まとめて表示するための文字列を作る
   * @param {number} jpy - 円の金額
   * @param {number} usd - ドルの金額
   * @returns {string} 表示文字列
   */
  function formatBoth(jpy, usd) {
    const parts = [];
    if (jpy > 0) parts.push("¥" + jpy.toLocaleString());
    if (usd > 0) parts.push("$" + usd.toFixed(2));
    return parts.length > 0 ? parts.join(" / ") : "¥0";
  }

  // HTMLの各スパン要素にテキストをセット
  document.getElementById("totalMonthly").textContent  = formatBoth(totalMonthlyJPY, totalMonthlyUSD);
  document.getElementById("totalYearly").textContent   = formatBoth(totalYearlyJPY, totalYearlyUSD);
  document.getElementById("workMonthly").textContent   = formatBoth(workMonthlyJPY, workMonthlyUSD);
  document.getElementById("workYearly").textContent    = formatBoth(workYearlyJPY, workYearlyUSD);
  document.getElementById("privateMonthly").textContent = formatBoth(privMonthlyJPY, privMonthlyUSD);
  document.getElementById("privateYearly").textContent  = formatBoth(privYearlyJPY, privYearlyUSD);
}

// ----------------------------------------
// 4. 一覧テーブルの描画
// ----------------------------------------

/**
 * テーブルの一覧を再描画する
 */
function renderList() {
  const tbody = document.getElementById("subscList");
  const emptyMsg = document.getElementById("emptyMessage");

  // 絞り込みフィルタを適用する
  const filtered = subscriptions.filter(function (s) {
    if (currentFilter === "all") return true;
    return s.category === currentFilter;
  });

  // データが0件のとき「登録なし」メッセージを表示
  if (filtered.length === 0) {
    tbody.innerHTML = "";
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  // 各サブスクリプションをテーブル行(tr)に変換してHTMLを生成する
  tbody.innerHTML = filtered
    .map(function (s) {
      // カテゴリバッジ
      const categoryBadge =
        `<span class="category-badge category-${s.category}">` +
        CATEGORY_LABEL[s.category] +
        "</span>";

      // ステータスバッジ
      const statusBadge =
        `<span class="status-badge status-${s.status}">` +
        STATUS_LABEL[s.status] +
        "</span>";

      // ステータス変更用のセレクトボックス
      const statusSelect =
        `<select class="action-select" onchange="changeStatus('${s.id}', this.value)">` +
        `<option value="active"    ${s.status === "active"      ? "selected" : ""}>利用中</option>` +
        `<option value="considering" ${s.status === "considering" ? "selected" : ""}>解約検討中</option>` +
        `<option value="cancelled" ${s.status === "cancelled"   ? "selected" : ""}>解約済み</option>` +
        `</select>`;

      // 削除ボタン
      const deleteBtn =
        `<button class="delete-btn" onclick="deleteItem('${s.id}')">削除</button>`;

      // 1行分のHTMLを返す
      return (
        `<tr>` +
        `<td>${categoryBadge}</td>` +
        `<td>${s.serviceName}</td>` +
        `<td>${formatAmount(s.monthlyFee, s.currency)}</td>` +
        `<td>${formatAmount(s.yearlyFee, s.currency)}</td>` +
        `<td>${s.renewalDate || "-"}</td>` +
        `<td>${statusBadge}</td>` +
        `<td>${statusSelect}${deleteBtn}</td>` +
        `</tr>`
      );
    })
    .join(""); // 配列を結合して1つのHTML文字列にする
}

// ----------------------------------------
// 5. データの追加・変更・削除
// ----------------------------------------

/**
 * フォームの送信イベント: 新しいサービスを追加する
 */
document.getElementById("subscForm").addEventListener("submit", function (e) {
  // フォームのデフォルト動作 (ページ再読み込み) を止める
  e.preventDefault();

  // フォームの各入力値を取得する
  const serviceName = document.getElementById("serviceName").value.trim();
  const category    = document.getElementById("category").value;
  const currency    = document.getElementById("currency").value;
  const monthlyFee  = document.getElementById("monthlyFee").value;
  const yearlyFee   = document.getElementById("yearlyFee").value;
  const renewalDate = document.getElementById("renewalDate").value;
  const status      = document.getElementById("status").value;

  // 新しいサブスクリプションオブジェクトを作成
  const newItem = {
    id: Date.now().toString(), // 一意なIDとして現在時刻(ミリ秒)を使用
    serviceName,
    category,
    currency,
    monthlyFee,
    yearlyFee,
    renewalDate,
    status,
  };

  // 配列の末尾に追加
  subscriptions.push(newItem);

  // localStorageに保存
  saveSubscriptions(subscriptions);

  // 画面を更新
  renderList();
  updateSummary();

  // フォームをリセット (入力内容をクリア)
  e.target.reset();
});

/**
 * ステータスを変更する
 * @param {string} id - 対象のID
 * @param {string} newStatus - 新しいステータス
 */
function changeStatus(id, newStatus) {
  // IDが一致するアイテムを見つけてステータスを更新
  subscriptions = subscriptions.map(function (s) {
    if (s.id === id) {
      return Object.assign({}, s, { status: newStatus }); // 元のオブジェクトを変更せず新しいオブジェクトを作る
    }
    return s;
  });

  saveSubscriptions(subscriptions);
  renderList();
  updateSummary();
}

/**
 * サービスを削除する
 * @param {string} id - 削除対象のID
 */
function deleteItem(id) {
  // 確認ダイアログを表示
  if (!confirm("このサービスを削除してもよいですか？")) return;

  // IDが一致しないものだけ残す (= 一致するものを除外する)
  subscriptions = subscriptions.filter(function (s) {
    return s.id !== id;
  });

  saveSubscriptions(subscriptions);
  renderList();
  updateSummary();
}

// ----------------------------------------
// 6. 絞り込みボタンの動作
// ----------------------------------------

// すべての絞り込みボタンに対してクリックイベントを設定する
document.querySelectorAll(".filter-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    // クリックされたボタンのdata-filter属性を取得
    currentFilter = btn.getAttribute("data-filter");

    // すべてのボタンから "active" クラスを外し、クリックしたボタンだけに付ける
    document.querySelectorAll(".filter-btn").forEach(function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");

    // 一覧を再描画
    renderList();
  });
});

// ----------------------------------------
// 7. 初期表示
// ----------------------------------------
// ページ読み込み時に一覧と合計を描画する
renderList();
updateSummary();
