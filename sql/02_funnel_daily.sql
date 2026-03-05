-- =============================================================
-- Daily funnel: view → cart → purchase (sessions per day)
-- Uses: events(event_time, event_type, user_id, user_session)
-- =============================================================

WITH daily_sessions AS (
  SELECT
    DATE(event_time) AS event_date,
    user_id,
    user_session,
    MAX(CASE WHEN event_type = 'view'    THEN 1 ELSE 0 END) AS had_view,
    MAX(CASE WHEN event_type = 'cart'    THEN 1 ELSE 0 END) AS had_cart,
    MAX(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS had_purchase
  FROM events
  WHERE event_type IN ('view', 'cart', 'purchase')
  GROUP BY DATE(event_time), user_id, user_session
)
SELECT
  event_date,
  COUNT(DISTINCT CASE WHEN had_view    = 1 THEN user_session END) AS viewed,
  COUNT(DISTINCT CASE WHEN had_cart   = 1 THEN user_session END) AS added_to_cart,
  COUNT(DISTINCT CASE WHEN had_purchase = 1 THEN user_session END) AS purchased,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN had_cart   = 1 THEN user_session END) / NULLIF(COUNT(DISTINCT CASE WHEN had_view = 1 THEN user_session END), 0), 2) AS view_to_cart_pct,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN had_purchase = 1 THEN user_session END) / NULLIF(COUNT(DISTINCT CASE WHEN had_cart = 1 THEN user_session END), 0), 2) AS cart_to_purchase_pct
FROM daily_sessions
GROUP BY event_date
ORDER BY event_date;
