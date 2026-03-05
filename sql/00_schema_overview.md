# Analytics schema overview

Run these against a database that has the raw **events** table (e.g. from Kaggle: `event_time`, `event_type`, `user_id`, `user_session`, `product_id`, `price`, …).

**Order:** `01` builds the `purchases` view from events; `02`–`05` use it and/or raw events.

| File | Purpose |
|------|--------|
| 01_purchases_view.sql | View: orders from `events` (event_type = 'purchase'), one row per order |
| 02_funnel_daily.sql | View: daily funnel counts (view → cart → purchase) |
| 03_cohort_retention.sql | View: cohort retention by week (first purchase week, retention %) |
| 04_segments.sql | View: customer segments (RFM-style) |
| 05_ab_aggregates.sql | View: A/B-style aggregates (e.g. by cohort month or segment) |

Use BigQuery, DuckDB, or any SQL engine; adjust date functions if needed (e.g. `DATE_DIFF` / `DATE_TRUNC` for your dialect).
