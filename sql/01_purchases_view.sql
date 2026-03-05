-- =============================================================
-- Purchases view (from raw events)
-- Raw table: events(event_time, event_type, user_id, user_session, product_id, price, ...)
-- =============================================================

CREATE OR REPLACE VIEW purchases AS
SELECT
  user_session AS order_id,
  user_id,
  MIN(event_time) AS order_time_utc,
  ROUND(SUM(price)::numeric, 2) AS order_value
FROM events
WHERE event_type = 'purchase'
GROUP BY user_id, user_session;
