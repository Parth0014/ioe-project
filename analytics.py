"""Recorded counter deltas, never power extrapolated through disconnects."""
from __future__ import annotations
import math
import time

IST_OFFSET = 19800
RANGES = {"24h": (86400, 3600), "7d": (7 * 86400, 86400), "30d": (30 * 86400, 86400)}


def parameters(range_name="24h", mode="LIVE", now=None):
    if range_name not in RANGES or mode not in ("LIVE", "DEMO"):
        raise ValueError("Choose range 24h, 7d or 30d and mode LIVE or DEMO")
    end = float(time.time() if now is None else now)
    duration, bucket = RANGES[range_name]
    return end - duration, end, bucket


def local_analytics(conn, mode, start, end, bucket, rate):
    # A preceding baseline makes the first delta in the window count correctly.
    rows = conn.execute("""WITH selected AS (
        SELECT timestamp,main_w,wh_total,wh_a,wh_b FROM samples
        WHERE data_mode=? AND timestamp<=? AND timestamp>=COALESCE(
          (SELECT MAX(timestamp) FROM samples WHERE data_mode=? AND timestamp<?), ?)
    ), windowed AS (
        SELECT *,LAG(timestamp) OVER(ORDER BY timestamp) AS prev_ts,
        LAG(wh_total) OVER(ORDER BY timestamp) AS prev_wh,
        LAG(wh_a) OVER(ORDER BY timestamp) AS prev_a,
        LAG(wh_b) OVER(ORDER BY timestamp) AS prev_b FROM selected
    ) SELECT CAST((timestamp+?)/? AS INTEGER)*?-? AS bucket,
        COUNT(*) AS samples,MAX(main_w) AS peak_w,SUM(main_w) AS sum_w,
        SUM(CASE WHEN prev_wh IS NOT NULL THEN MAX(0,wh_total-prev_wh) ELSE 0 END) AS energy_wh,
        SUM(CASE WHEN prev_a IS NOT NULL THEN MAX(0,wh_a-prev_a) ELSE 0 END) AS a_wh,
        SUM(CASE WHEN prev_b IS NOT NULL THEN MAX(0,wh_b-prev_b) ELSE 0 END) AS b_wh,
        SUM(CASE WHEN timestamp-prev_ts BETWEEN 0 AND 5 THEN MIN(timestamp-prev_ts,timestamp-?) ELSE 0 END) AS recorded_seconds,
        SUM(CASE WHEN wh_total<prev_wh THEN 1 ELSE 0 END) AS resets
        FROM windowed WHERE timestamp>=? GROUP BY bucket ORDER BY bucket""",
        (mode, end, mode, start, start, IST_OFFSET, bucket, bucket, IST_OFFSET, start, start)).fetchall()
    return [dict(row) for row in rows]


def mongo_analytics(collection, device_id, mode, start, end, bucket):
    scope = {"device_id": device_id, "mode": mode}
    baseline = collection.find_one({**scope, "ts": {"$lt": start}}, {"ts": 1}, sort=[("ts", -1)])

    def delta(current, previous):
        return {"$cond": [{"$ne": ["$" + previous, None]}, {"$max": [0, {"$subtract": ["$" + current, "$" + previous]}]}, 0]}

    elapsed = {"$subtract": ["$ts", "$prev_ts"]}
    pipeline = [
        {"$match": {**scope, "ts": {"$gte": baseline['ts'] if baseline else start, "$lte": end}}},
        {"$setWindowFields": {"sortBy": {"ts": 1}, "output": {
            key: {"$shift": {"output": "$" + field, "by": -1, "default": None}}
            for key, field in (("prev_ts", "ts"), ("prev_wh", "wh_total"), ("prev_a", "wh_a"), ("prev_b", "wh_b"))}}},
        {"$match": {"ts": {"$gte": start}}},
        {"$group": {
            "_id": {"$subtract": [{"$multiply": [{"$floor": {"$divide": [{"$add": ["$ts", IST_OFFSET]}, bucket]}}, bucket]}, IST_OFFSET]},
            "samples": {"$sum": 1}, "peak_w": {"$max": "$main_w"}, "sum_w": {"$sum": "$main_w"},
            "energy_wh": {"$sum": delta("wh_total", "prev_wh")},
            "a_wh": {"$sum": delta("wh_a", "prev_a")}, "b_wh": {"$sum": delta("wh_b", "prev_b")},
            "recorded_seconds": {"$sum": {"$cond": [{"$and": [{"$ne": ["$prev_ts", None]}, {"$gte": [elapsed, 0]}, {"$lte": [elapsed, 5]}]}, {"$min": [elapsed, {"$subtract": ["$ts", start]}]}, 0]}},
            "resets": {"$sum": {"$cond": [{"$and": [{"$ne": ["$prev_wh", None]}, {"$lt": ["$wh_total", "$prev_wh"]}]}, 1, 0]}},
        }}, {"$sort": {"_id": 1}},
    ]
    return [{"bucket": row.pop("_id"), **row} for row in collection.aggregate(pipeline, allowDiskUse=True, maxTimeMS=20000)]


def report(rows, previous, start, end, bucket, rate, **metadata):
    by_time = {r['bucket']: r for r in rows}
    first = math.floor((start + IST_OFFSET) / bucket) * bucket - IST_OFFSET
    buckets = []
    for ts in range(int(first), math.ceil(end), bucket):
        row = by_time.get(ts)
        buckets.append({"timestamp": ts, "energy_wh": row['energy_wh'] if row else None,
                        "a_wh": row['a_wh'] if row else None, "b_wh": row['b_wh'] if row else None,
                        "samples": row['samples'] if row else 0,
                        "recorded_seconds": row['recorded_seconds'] if row else 0})
    count = sum(r['samples'] for r in rows)
    energy = sum(r['energy_wh'] for r in rows)
    prev_energy = sum(r['energy_wh'] for r in previous)
    seconds = sum(r['recorded_seconds'] for r in rows)
    return {**metadata, "start": start, "end": end, "timezone": "Asia/Kolkata", "bucket_seconds": bucket,
            "buckets": buckets, "summary": {
                "energy_wh": energy, "a_wh": sum(r['a_wh'] for r in rows), "b_wh": sum(r['b_wh'] for r in rows),
                "cost_inr": energy / 1000 * rate, "rate_inr_per_kwh": rate,
                "peak_w": max((r['peak_w'] or 0 for r in rows), default=None),
                "average_w": sum(r['sum_w'] or 0 for r in rows) / count if count else None,
                "samples": count, "recorded_seconds": seconds, "coverage_percent": min(100, seconds / (end - start) * 100),
                "counter_resets": sum(r['resets'] for r in rows),
                "previous_energy_wh": prev_energy if previous else None,
                "change_percent": (energy - prev_energy) / prev_energy * 100 if prev_energy > 0 and count else None,
                "previous_coverage_percent": min(100, sum(r['recorded_seconds'] for r in previous) / (end-start) * 100),
            }, "notes": ["Energy and power are estimates at assumed voltage. Zone B is inferred from feeder minus Zone A.",
                         "Missing periods are not estimated. Changes compare recorded totals; different recording coverage can affect comparisons.",
                         "Cost uses the current flat rate and excludes fixed charges, taxes and other bill adjustments."]}
