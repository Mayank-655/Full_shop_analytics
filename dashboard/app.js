(function () {
  const DATA_URL = "data/shop_analytics.json";

  function el(id) { return document.getElementById(id); }
  function formatNum(n) { return new Intl.NumberFormat().format(n); }
  function formatMoney(n) { return "$" + new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n); }

  function heatColor(pct) {
    const t = Math.max(0, Math.min(1, pct / 100));
    return `rgba(13, 148, 136, ${0.2 + 0.6 * t})`;
  }

  function renderFunnelViz(funnel) {
    const wrap = el("funnel-viz");
    const kpiWrap = el("funnel-kpis");
    if (!wrap || !funnel || !funnel.length) return;
    const total = funnel.reduce((a, r) => ({
      viewed: a.viewed + (r.viewed || 0),
      cart: a.cart + (r.added_to_cart || 0),
      purchased: a.purchased + (r.purchased || 0),
    }), { viewed: 0, cart: 0, purchased: 0 });
    const max = Math.max(total.viewed, 1);
    const v2c = total.viewed ? Math.round(100 * total.cart / total.viewed) : 0;
    const c2p = total.cart ? Math.round(100 * total.purchased / total.cart) : 0;
    wrap.innerHTML = `
      <div class="step">
        <div class="bar" style="height: 100%"></div>
        <div class="label">View</div>
        <div class="count">${formatNum(total.viewed)}</div>
        <div class="pct">100%</div>
      </div>
      <div class="step">
        <div class="bar" style="height: ${(100 * total.cart / max)}%"></div>
        <div class="label">Add to cart</div>
        <div class="count">${formatNum(total.cart)}</div>
        <div class="pct">${v2c}% of view</div>
      </div>
      <div class="step">
        <div class="bar" style="height: ${(100 * total.purchased / max)}%"></div>
        <div class="label">Purchase</div>
        <div class="count">${formatNum(total.purchased)}</div>
        <div class="pct">${c2p}% of cart</div>
      </div>
    `;
    if (kpiWrap) {
      kpiWrap.innerHTML = `
        <div class="fk">View → Cart conversion: <span>${v2c}%</span></div>
        <div class="fk">Cart → Purchase conversion: <span>${c2p}%</span></div>
        <div class="fk">End-to-end (view → purchase): <span>${total.viewed ? Math.round(100 * total.purchased / total.viewed) : 0}%</span></div>
      `;
    }
  }

  function renderKpis(kpis) {
    const wrap = el("kpis");
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="kpi"><div class="label">Users</div><div class="value">${formatNum(kpis.users || 0)}</div></div>
      <div class="kpi"><div class="label">Orders</div><div class="value">${formatNum(kpis.orders || 0)}</div></div>
      <div class="kpi"><div class="label">Revenue</div><div class="value accent">${formatMoney(kpis.revenue || 0)}</div></div>
      <div class="kpi"><div class="label">Repeat purchase rate</div><div class="value">${(kpis.repeat_purchase_rate_pct || 0)}%</div></div>
    `;
    const meta = el("meta");
    if (meta) meta.textContent = kpis.as_of ? "As of: " + kpis.as_of : "";
  }

  function renderFunnel(funnel) {
    const tbody = el("funnel-tbody");
    if (!tbody || !funnel || !funnel.length) return;
    tbody.innerHTML = funnel.map(r => `
      <tr>
        <td>${r.event_date}</td>
        <td class="num">${formatNum(r.viewed)}</td>
        <td class="num">${formatNum(r.added_to_cart)}</td>
        <td class="num">${formatNum(r.purchased)}</td>
        <td class="num">${r.view_to_cart_pct != null ? r.view_to_cart_pct + "%" : "—"}</td>
        <td class="num">${r.cart_to_purchase_pct != null ? r.cart_to_purchase_pct + "%" : "—"}</td>
      </tr>
    `).join("");
  }

  function renderHeatmap(cohort) {
    const table = el("heatmap");
    if (!table || !cohort || !cohort.matrix) return;
    const rows = cohort.matrix;
    let maxOffset = 0;
    rows.forEach(r => { (r.retention || []).forEach(c => { if (c.offset > maxOffset) maxOffset = c.offset; }); });
    const head = ["Cohort", "Size"];
    for (let i = 0; i <= maxOffset; i++) head.push("W+" + i);
    const thead = "<thead><tr>" + head.map(h => "<th>" + h + "</th>").join("") + "</tr></thead>";
    const tbodyRows = rows.map(r => {
      const byOff = {};
      (r.retention || []).forEach(c => { byOff[c.offset] = c; });
      const cells = ["<td class=\"label\">" + r.cohort + "</td>", "<td class=\"num\">" + formatNum(r.size) + "</td>"];
      for (let off = 0; off <= maxOffset; off++) {
        const c = byOff[off];
        const pct = c ? c.retention_pct : 0;
        cells.push("<td class=\"cell\" style=\"background:" + heatColor(pct) + "\">" + (pct ? pct.toFixed(0) : 0) + "%</td>");
      }
      return "<tr>" + cells.join("") + "</tr>";
    }).join("");
    table.innerHTML = thead + "<tbody>" + tbodyRows + "</tbody>";
  }

  function renderSegmentsTable(segments) {
    const tbody = el("seg-tbody");
    if (!tbody || !segments) return;
    tbody.innerHTML = (segments || []).map(s => `
      <tr>
        <td>${s.segment}</td>
        <td class="num">${formatNum(s.users)}</td>
        <td class="num">${s.user_share_pct}%</td>
        <td class="num">${formatMoney(s.revenue)}</td>
        <td class="num">${s.revenue_share_pct}%</td>
      </tr>
    `).join("");
  }

  function renderAb(ab) {
    const tbody = el("ab-tbody");
    if (!tbody || !ab || !ab.length) return;
    tbody.innerHTML = ab.map(r => `
      <tr>
        <td>${r.cohort_month}</td>
        <td class="num">${formatNum(r.users)}</td>
        <td class="num">${formatNum(r.orders)}</td>
        <td class="num">${formatMoney(r.revenue)}</td>
        <td class="num">${formatMoney(r.revenue_per_user)}</td>
      </tr>
    `).join("");
  }

  function drawBarChart(canvas, labels, values, color) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height;
    const pad = { top: 18, right: 12, bottom: 34, left: 44 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const maxV = Math.max(...values, 1);
    const n = values.length;
    const barW = Math.max(18, (chartW / n) * 0.65);
    const gap = (chartW - barW * n) / (n + 1);
    ctx.clearRect(0, 0, w, h);
    ctx.font = "11px DM Sans, sans-serif";
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText("0", pad.left - 18, pad.top + chartH + 4);
    labels.forEach((lab, i) => {
      const v = values[i];
      const bh = (v / maxV) * chartH;
      const x = pad.left + gap + i * (barW + gap);
      const y = pad.top + chartH - bh;
      ctx.fillStyle = color(i);
      ctx.fillRect(x, y, barW, bh);
      ctx.fillStyle = "#e4e4e7";
      ctx.textAlign = "center";
      ctx.fillText(lab, x + barW / 2, h - 14);
    });
    ctx.textAlign = "left";
  }

  function renderAbTestSection(abData) {
    const tbody = el("variant-tbody");
    const grid = el("stats-grid");
    const badge = el("significance-badge");
    const rec = el("recommendation-text");
    const note = el("ab-note");
    if (!abData || !abData.variants || !abData.variants.length) {
      if (tbody) tbody.innerHTML = "<tr><td colspan=\"4\">No A/B data loaded.</td></tr>";
      if (grid) grid.innerHTML = "";
      if (badge) { badge.textContent = ""; badge.className = "significance-badge"; }
      if (rec) rec.textContent = "";
      if (note) note.textContent = "To show A/B test results: run the A/B project's run_analysis.py, then copy dashboard/data/results.json to this folder as ab_results.json.";
      return;
    }
    if (note) note.textContent = "";
    if (tbody) {
      tbody.innerHTML = abData.variants.map(v => `
        <tr><td>${v.variant}</td><td class="num">${formatNum(v.users)}</td><td class="num">${formatNum(v.conversions)}</td><td class="num">${v.conversion_rate_pct}%</td></tr>
      `).join("");
    }
    const s = abData.summary || {};
    if (grid) {
      grid.innerHTML = `
        <div class="stat-card"><div class="label">Absolute lift</div><div class="value">${s.absolute_lift_pct != null ? s.absolute_lift_pct + "%" : "—"}</div></div>
        <div class="stat-card"><div class="label">Relative lift</div><div class="value">${s.relative_lift_pct != null ? s.relative_lift_pct + "%" : "—"}</div></div>
        <div class="stat-card"><div class="label">Z statistic</div><div class="value">${s.z_statistic != null ? s.z_statistic : "—"}</div></div>
        <div class="stat-card"><div class="label">p-value</div><div class="value highlight">${s.p_value != null ? s.p_value : "—"}</div></div>
        <div class="stat-card"><div class="label">95% CI (lift)</div><div class="value">${s.ci_95_low_pct != null ? s.ci_95_low_pct + "%" : "—"} to ${s.ci_95_high_pct != null ? s.ci_95_high_pct + "%" : "—"}</div></div>
      `;
    }
    if (badge) {
      badge.textContent = s.significant_at_05 ? "Statistically significant (α = 0.05)" : "Not significant (α = 0.05)";
      badge.className = "significance-badge " + (s.significant_at_05 ? "significant" : "not-significant");
    }
    if (rec) rec.textContent = s.recommendation || "";
  }

  function renderSummarySection(shopData, abData) {
    const wrap = el("summary-cards");
    if (!wrap) return;
    const funnel = shopData.funnel || [];
    const total = funnel.reduce((a, r) => ({
      viewed: a.viewed + (r.viewed || 0),
      cart: a.cart + (r.added_to_cart || 0),
      purchased: a.purchased + (r.purchased || 0),
    }), { viewed: 0, cart: 0, purchased: 0 });
    const endToEnd = total.viewed ? Math.round(100 * total.purchased / total.viewed) : 0;
    const segments = (shopData.rfm && shopData.rfm.segments) ? shopData.rfm.segments : [];
    const topSegment = segments.length ? segments[0] : null;
    const abRec = abData && abData.summary && abData.summary.recommendation ? abData.summary.recommendation : null;
    wrap.innerHTML = `
      <div class="sum-card">
        <h3>Funnel</h3>
        <p>End-to-end conversion (view → purchase): <strong>${endToEnd}%</strong>. Focus on improving view→cart and cart→purchase to lift overall conversion.</p>
      </div>
      <div class="sum-card">
        <h3>Segments</h3>
        <p>${topSegment ? "Top segment by revenue: <strong>" + topSegment.segment + "</strong> (" + topSegment.revenue_share_pct + "% of revenue). Use for loyalty and targeting." : "No segment data."}</p>
      </div>
      <div class="sum-card">
        <h3>A/B test</h3>
        <p>${abRec ? abRec : "No A/B test results loaded. Add ab_results.json to see experiment recommendation here."}</p>
      </div>
    `;
  }

  function run(data) {
    renderFunnelViz(data.funnel || []);
    renderKpis(data.kpis || {});
    renderFunnel(data.funnel || []);
    renderHeatmap(data.cohort || {});
    const segments = (data.rfm && data.rfm.segments) ? data.rfm.segments : [];
    renderSegmentsTable(segments);
    renderAb(data.ab_by_cohort_month || []);

    const labels = segments.map(s => s.segment);
    const users = segments.map(s => s.users);
    const revShare = segments.map(s => s.revenue_share_pct);
    const colors = ["#0d9488", "#0f766e", "#f59e0b", "#22c55e", "#ef4444", "#94a3b8"];
    const color = (i) => colors[i % colors.length];
    drawBarChart(el("seg-size"), labels, users, color);
    drawBarChart(el("seg-rev"), labels, revShare, color);

    renderSummarySection(data, null);
    fetch("data/ab_results.json")
      .then(r => r.ok ? r.json() : null)
      .then(abData => {
        renderAbTestSection(abData);
        renderSummarySection(data, abData);
      })
      .catch(() => {
        renderAbTestSection(null);
      });
  }

  function runWithFallback(data) {
    if (!data || (!data.kpis && !data.funnel)) {
      data = {
        kpis: { users: 0, orders: 0, revenue: 0, repeat_purchase_rate_pct: 0, as_of: "" },
        funnel: [],
        cohort: { weeks: [], matrix: [] },
        rfm: { as_of: "", users: 0, revenue: 0, segments: [] },
        ab_by_cohort_month: [],
      };
      const meta = el("meta");
      if (meta) meta.textContent = "No data loaded. Put Kaggle CSVs in data/kaggle_data/, then run: python scripts/build_analytics.py";
    }
    run(data);
  }

  fetch(DATA_URL)
    .then(r => {
      if (!r.ok) throw new Error("Missing data");
      return r.json();
    })
    .then(runWithFallback)
    .catch(() => {
      runWithFallback(null);
    });
})();
