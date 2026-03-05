"""
Build full shop analytics from Kaggle eCommerce CSV data: funnel, cohorts, segments, A/B-style.
Writes dashboard/data/shop_analytics.json for the HTML dashboard.
Optionally exports CSV to dashboard/data/ for Looker Studio / Tableau.

Usage (from project root):
  python scripts/build_analytics.py
  python scripts/build_analytics.py --export-csv
"""

import csv
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
KAGGLE_DIR = PROJECT_ROOT / "data" / "kaggle_data"
OUT_DIR = PROJECT_ROOT / "dashboard" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def parse_event_time(s: str) -> datetime | None:
    if not s:
        return None
    s = str(s).strip().replace(" UTC", "")
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def load_all_events(csv_dir: Path):
    """Yield dicts: event_time, event_type, user_id, user_session, price."""
    csv_dir = csv_dir.resolve()
    if not csv_dir.is_dir():
        raise FileNotFoundError(f"Data directory not found: {csv_dir}")
    files = sorted(csv_dir.glob("*.csv"))
    if not files:
        raise FileNotFoundError(f"No *.csv in {csv_dir}")
    for path in files:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for row in csv.DictReader(f):
                ts = parse_event_time(row.get("event_time"))
                if not ts:
                    continue
                try:
                    price = float(row.get("price") or 0)
                except ValueError:
                    price = 0.0
                yield {
                    "event_time": ts,
                    "event_type": (row.get("event_type") or "").strip().lower(),
                    "user_id": (row.get("user_id") or "").strip(),
                    "user_session": (row.get("user_session") or "").strip(),
                    "price": price,
                }


def build_purchases(events):
    """From events, build list of purchases: order_id, user_id, order_time_utc, order_value."""
    orders = {}
    for e in events:
        if e["event_type"] != "purchase":
            continue
        sid = e["user_session"]
        uid = e["user_id"]
        if not sid or not uid:
            continue
        if sid not in orders:
            orders[sid] = {"order_id": sid, "user_id": uid, "order_time": e["event_time"], "order_value": 0.0}
        orders[sid]["order_value"] += e["price"]
        if e["event_time"] < orders[sid]["order_time"]:
            orders[sid]["order_time"] = e["event_time"]
    return list(orders.values())


def build_funnel(events):
    """Daily funnel: view -> cart -> purchase (session counts)."""
    session_flags = defaultdict(set)  # (date, user_id, session) -> {view, cart, purchase}
    for e in events:
        if e["event_type"] not in ("view", "cart", "purchase"):
            continue
        key = (e["event_time"].date(), e["user_id"], e["user_session"])
        session_flags[key].add(e["event_type"])
    daily = defaultdict(lambda: {"viewed": set(), "cart": set(), "purchase": set()})
    for (d, uid, sid), types in session_flags.items():
        sk = (uid, sid)
        if "view" in types:
            daily[d]["viewed"].add(sk)
        if "cart" in types:
            daily[d]["cart"].add(sk)
        if "purchase" in types:
            daily[d]["purchase"].add(sk)
    rows = []
    for d in sorted(daily.keys()):
        v = len(daily[d]["viewed"])
        c = len(daily[d]["cart"])
        p = len(daily[d]["purchase"])
        rows.append({
            "event_date": str(d),
            "viewed": v,
            "added_to_cart": c,
            "purchased": p,
            "view_to_cart_pct": round(100.0 * c / v, 2) if v else None,
            "cart_to_purchase_pct": round(100.0 * p / c, 2) if c else None,
        })
    return rows


def week_key(dt):
    y, w, _ = dt.isocalendar()
    return f"{y}-W{int(w):02d}"


def week_index(week):
    if "-W" in week:
        y, w = week.split("-W")
        return int(y), int(w)
    return (9999, 99)


def build_cohort_matrix(purchases):
    """Cohort retention by first purchase week."""
    user_first = {}
    user_weeks = defaultdict(set)
    for p in purchases:
        uid = p["user_id"]
        dt = p["order_time"]
        wk = week_key(dt)
        user_weeks[uid].add(wk)
        if uid not in user_first or dt < user_first[uid][0]:
            user_first[uid] = (dt, wk)
    cohorts = defaultdict(list)
    for uid, (_, wk) in user_first.items():
        cohorts[wk].append(uid)
    all_weeks = sorted({w for s in user_weeks.values() for w in s}, key=week_index)
    week_idx = {w: i for i, w in enumerate(all_weeks)}
    matrix = []
    for cw in sorted(cohorts.keys(), key=week_index):
        users = cohorts[cw]
        size = len(users)
        offset_counts = defaultdict(int)
        for uid in users:
            ci = week_idx.get(cw)
            if ci is None:
                continue
            for w in user_weeks.get(uid, set()):
                if w in week_idx:
                    off = week_idx[w] - ci
                    if off >= 0:
                        offset_counts[off] += 1
        max_off = max(offset_counts.keys()) if offset_counts else 0
        row = {"cohort": cw, "size": size, "retention": []}
        for off in range(0, max_off + 1):
            active = offset_counts.get(off, 0)
            row["retention"].append({"offset": off, "active_users": active, "retention_pct": round(100 * active / size, 2) if size else 0})
        matrix.append(row)
    return {"weeks": all_weeks, "matrix": matrix}


@dataclass
class UserAgg:
    first: datetime | None = None
    last: datetime | None = None
    orders: int = 0
    revenue: float = 0.0


def quantile_vals(values, qs=(0.2, 0.4, 0.6, 0.8)):
    if not values:
        return [0] * 4
    v = sorted(values)
    n = len(v)
    return [v[min(n - 1, max(0, int(q * (n - 1))))] for q in qs]


def score(val, thresholds, higher_better=True):
    if not higher_better:
        val, thresholds = -val, sorted(-t for t in thresholds)
    if val <= thresholds[0]: return 1
    if val <= thresholds[1]: return 2
    if val <= thresholds[2]: return 3
    if val <= thresholds[3]: return 4
    return 5


def segment_name(r, f, m):
    if r >= 4 and f >= 4 and m >= 4: return "Champions"
    if r >= 4 and f >= 3: return "Loyal"
    if r >= 4 and f <= 2: return "New customers"
    if r <= 2 and f >= 3: return "At risk"
    if r == 1 and f == 1: return "Hibernating"
    return "Potential"


def build_rfm(purchases):
    if not purchases:
        return {"as_of": "", "users": 0, "revenue": 0, "segments": []}
    orders_by_user = defaultdict(set)
    users = {}
    for p in purchases:
        uid = p["user_id"]
        users.setdefault(uid, UserAgg())
        u = users[uid]
        u.revenue += p["order_value"]
        orders_by_user[uid].add(p["order_id"])
        if u.first is None or p["order_time"] < u.first:
            u.first = p["order_time"]
        if u.last is None or p["order_time"] > u.last:
            u.last = p["order_time"]
    for uid, u in users.items():
        u.orders = len(orders_by_user.get(uid, set()))
    max_dt = max(p["order_time"] for p in purchases)
    recencies, freqs, monies = [], [], []
    rfm_vals = {}
    for uid, u in users.items():
        rec = (max_dt - u.last).days if u.last else 9999
        recencies.append(float(rec))
        freqs.append(float(u.orders))
        monies.append(float(u.revenue))
        rfm_vals[uid] = (rec, u.orders, u.revenue)
    r_t = quantile_vals(recencies)
    f_t = quantile_vals(freqs)
    m_t = quantile_vals(monies)
    segments = defaultdict(lambda: {"users": 0, "revenue": 0.0})
    for uid, (rec, freq, money) in rfm_vals.items():
        r = score(float(rec), r_t, False)
        f = score(float(freq), f_t, True)
        m = score(float(money), m_t, True)
        seg = segment_name(r, f, m)
        segments[seg]["users"] += 1
        segments[seg]["revenue"] += money
    seg_list = [{"segment": k, "users": v["users"], "revenue": round(v["revenue"], 2)} for k, v in segments.items()]
    seg_list.sort(key=lambda x: (-x["revenue"], -x["users"]))
    total_u = len(users)
    total_r = round(sum(s["revenue"] for s in segments.values()), 2)
    for s in seg_list:
        s["user_share_pct"] = round(100 * s["users"] / total_u, 2) if total_u else 0
        s["revenue_share_pct"] = round(100 * s["revenue"] / total_r, 2) if total_r else 0
    return {"as_of": max_dt.strftime("%Y-%m-%d"), "users": total_u, "revenue": total_r, "segments": seg_list}


def build_ab_aggregates(purchases):
    """By cohort month (first purchase month): users, orders, revenue, revenue_per_user."""
    if not purchases:
        return []
    user_first_date = {}
    for p in purchases:
        uid = p["user_id"]
        ot = p["order_time"]
        d = ot.date() if hasattr(ot, "date") else ot
        if uid not in user_first_date or d < user_first_date[uid]:
            user_first_date[uid] = d
    user_cohort_month = {}
    for uid, first_d in user_first_date.items():
        user_cohort_month[uid] = first_d.replace(day=1)
    by_month = defaultdict(lambda: {"users": set(), "orders": 0, "revenue": 0.0})
    for p in purchases:
        uid = p["user_id"]
        if uid not in user_cohort_month:
            continue
        m = user_cohort_month[uid]
        by_month[m]["users"].add(uid)
        by_month[m]["orders"] += 1
        by_month[m]["revenue"] += p["order_value"]
    out = []
    for m in sorted(by_month.keys()):
        d = by_month[m]
        u = len(d["users"])
        out.append({
            "cohort_month": str(m),
            "users": u,
            "orders": d["orders"],
            "revenue": round(d["revenue"], 2),
            "revenue_per_user": round(d["revenue"] / u, 2) if u else 0,
        })
    return out


def write_minimal_json():
    """Write minimal valid JSON so dashboard loads even with no data."""
    payload = {
        "kpis": {"users": 0, "orders": 0, "revenue": 0, "repeat_purchase_rate_pct": 0, "as_of": ""},
        "funnel": [],
        "cohort": {"weeks": [], "matrix": []},
        "rfm": {"as_of": "", "users": 0, "revenue": 0, "segments": []},
        "ab_by_cohort_month": [],
    }
    out_path = OUT_DIR / "shop_analytics.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"Written minimal {out_path} (no CSV data — add CSVs to data/kaggle_data/ and re-run for real data)")
    return payload


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--export-csv", action="store_true", help="Also write funnel and segments CSV to dashboard/data/")
    args = ap.parse_args()

    if not KAGGLE_DIR.exists():
        KAGGLE_DIR.mkdir(parents=True, exist_ok=True)
    files = list(KAGGLE_DIR.glob("*.csv"))
    if not files:
        print("No CSV files in", KAGGLE_DIR)
        write_minimal_json()
        return

    print("Loading events from", KAGGLE_DIR, "...")
    events = list(load_all_events(KAGGLE_DIR))
    if not events:
        print("No events found in CSVs. Writing minimal JSON.")
        write_minimal_json()
        return
    print(f"  Loaded {len(events):,} events")

    purchases = build_purchases(events)
    print(f"  Purchases: {len(purchases):,} orders")
    funnel = build_funnel(events)
    cohort = build_cohort_matrix(purchases)
    rfm = build_rfm(purchases)
    ab = build_ab_aggregates(purchases)

    orders_by_u = defaultdict(set)
    for p in purchases:
        orders_by_u[p["user_id"]].add(p["order_id"])
    repeat_buyers = sum(1 for o in orders_by_u.values() if len(o) >= 2)
    repeat_rate = round(100 * repeat_buyers / len(orders_by_u), 2) if orders_by_u else 0

    payload = {
        "kpis": {
            "users": rfm["users"],
            "orders": len(purchases),
            "revenue": rfm["revenue"],
            "repeat_purchase_rate_pct": repeat_rate,
            "as_of": rfm["as_of"],
        },
        "funnel": funnel,
        "cohort": cohort,
        "rfm": rfm,
        "ab_by_cohort_month": ab,
    }

    out_path = OUT_DIR / "shop_analytics.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"Written {out_path}")

    if args.export_csv:
        with open(OUT_DIR / "funnel_daily.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["event_date", "viewed", "added_to_cart", "purchased", "view_to_cart_pct", "cart_to_purchase_pct"])
            w.writeheader()
            w.writerows(funnel)
        with open(OUT_DIR / "segments.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["segment", "users", "revenue", "user_share_pct", "revenue_share_pct"])
            w.writeheader()
            w.writerows(rfm["segments"])
        print("Exported funnel_daily.csv and segments.csv to dashboard/data/")


if __name__ == "__main__":
    main()
