-- =============================================================
-- Customer segments (RFM-style) from purchases view
-- Requires: purchases(order_id, user_id, order_time_utc, order_value)
-- =============================================================

WITH base AS (
  SELECT
    user_id,
    COUNT(DISTINCT order_id) AS frequency_orders,
    SUM(order_value) AS monetary_total,
    MAX(order_time_utc::timestamp) AS last_purchase_ts
  FROM purchases
  GROUP BY user_id
),
asof AS (
  SELECT MAX(order_time_utc::timestamp) AS as_of_ts FROM purchases
),
rfm AS (
  SELECT
    b.user_id,
    DATE_PART('day', a.as_of_ts - b.last_purchase_ts)::int AS recency_days,
    b.frequency_orders,
    b.monetary_total
  FROM base b
  CROSS JOIN asof a
)
SELECT
  user_id,
  recency_days,
  frequency_orders,
  monetary_total,
  CASE
    WHEN recency_days <= 14 AND frequency_orders >= 3 THEN 'Champions'
    WHEN recency_days <= 30 AND frequency_orders >= 2 THEN 'Loyal'
    WHEN recency_days <= 14 AND frequency_orders <= 2 THEN 'New'
    WHEN recency_days > 60 AND frequency_orders >= 2 THEN 'At risk'
    WHEN recency_days > 90 AND frequency_orders = 1 THEN 'Hibernating'
    ELSE 'Potential'
  END AS segment
FROM rfm
ORDER BY monetary_total DESC;
