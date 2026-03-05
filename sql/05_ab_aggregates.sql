-- =============================================================
-- A/B-style aggregates (e.g. by first-purchase cohort month)
-- Use when you have experiment_id/variant_id; here we use cohort month
-- as a proxy to compare conversion and revenue by "cohort".
-- =============================================================

WITH user_cohort AS (
  SELECT
    user_id,
    DATE_TRUNC('month', MIN(order_time_utc::timestamp))::date AS cohort_month
  FROM purchases
  GROUP BY user_id
),
orders_with_cohort AS (
  SELECT
    p.user_id,
    p.order_id,
    p.order_value,
    uc.cohort_month
  FROM purchases p
  JOIN user_cohort uc ON uc.user_id = p.user_id
)
SELECT
  cohort_month,
  COUNT(DISTINCT user_id) AS users,
  COUNT(DISTINCT order_id) AS orders,
  ROUND(SUM(order_value)::numeric, 2) AS revenue,
  ROUND(SUM(order_value)::numeric / NULLIF(COUNT(DISTINCT user_id), 0), 2) AS revenue_per_user
FROM orders_with_cohort
GROUP BY cohort_month
ORDER BY cohort_month;
