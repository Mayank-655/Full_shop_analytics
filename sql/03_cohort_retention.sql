-- =============================================================
-- Cohort retention (weekly) from purchases view
-- Requires: purchases(order_id, user_id, order_time_utc, order_value)
-- =============================================================

WITH user_first AS (
  SELECT
    user_id,
    DATE_TRUNC('week', MIN(order_time_utc::timestamp)) AS cohort_week
  FROM purchases
  GROUP BY user_id
),
user_activity AS (
  SELECT DISTINCT
    user_id,
    DATE_TRUNC('week', order_time_utc::timestamp) AS activity_week
  FROM purchases
),
cohort_activity AS (
  SELECT
    uf.cohort_week,
    ua.activity_week,
    DATE_PART('day', ua.activity_week - uf.cohort_week) / 7 AS week_offset,
    ua.user_id
  FROM user_first uf
  JOIN user_activity ua ON ua.user_id = uf.user_id
  WHERE ua.activity_week >= uf.cohort_week
),
cohort_sizes AS (
  SELECT cohort_week, COUNT(*) AS cohort_size
  FROM user_first
  GROUP BY cohort_week
)
SELECT
  ca.cohort_week,
  ca.week_offset::int AS week_offset,
  COUNT(DISTINCT ca.user_id) AS active_users,
  cs.cohort_size,
  ROUND(100.0 * COUNT(DISTINCT ca.user_id) / cs.cohort_size, 2) AS retention_pct
FROM cohort_activity ca
JOIN cohort_sizes cs ON cs.cohort_week = ca.cohort_week
GROUP BY ca.cohort_week, ca.week_offset, cs.cohort_size
ORDER BY ca.cohort_week, ca.week_offset;
