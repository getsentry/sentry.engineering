---
title: 'Lost in the Haystack: Optimizing a Tough ClickHouse Query'
date: '2023-09-18'
tags: ['clickhouse', 'replay', 'database']
summary: 'Finding a needle in a haystack is really difficult. Why make it harder than it needs to be?'
images: ['/images/lost-in-the-haystack/SnubaIntro.gif']
layout: PostLayout
canonicalUrl: lost-in-the-haystack
authors: ['coltonallen']
---

Imagine I asked you to find a needle in a haystack. That'd be pretty difficult, right? Now imagine I asked you to hold the haystack while you searched and even if you found the needle you had to keep holding the haystack until you looked at every piece of hay. That would just be mean. Well, that's how I treated ClickHouse and its probably why he stopped returning my calls.

Jokes aside this is an accurate representation of what ClickHouse had to do to support the Session Replay product and it had real-world implications. Searching through Sentry's replays used to take more than 10 seconds. For our largest customers, searching was impossible. We didn't have enough memory to answer those sorts of queries.

Today these heavy queries are more than 10x faster and our memory usage is 100x lower (and, more importantly, bounded). Our largest customers no longer see errors when searching for replays and we can now support customers of arbitrary size without running out of memory. This is how we did it.

### Overview of the Replays Query

A replay is not a singular event. It's multiple events aggregated together. You can perform that aggregation when you write, when you read, or asynchronously at some undefined time. But you have to aggregate! At Sentry, we chose to aggregate on-demand when a user wants to see their replays. This has benefits but also imposes its own set of constraints.

One of those constraints is cardinality. As it turns out our aggregation key is high-cardinality. We could have millions of unique aggregations in memory at once. This many aggregations means you have to be strategic about the data you aggregate. But our customers don't care about that. They want to see the data they paid to see. This is the central conflict we need to resolve.

### Minimizing Memory Usage

**In the SELECT Clause**

Let's look at an example query.

```sql
SELECT replay_id, groupArray(url)
FROM replay_events
GROUP BY replay_id
LIMIT 1
```

The total memory usage of this query is the sum of every unique replay*id plus \_every* URL stored in the database. We absolutely can not hold this in memory. But we need to return the URLs. So, how do we resolve this?

For every request made by a user to the Replay's service we can make two queries to the database. The first query is a preflight. It returns a set of `replay-ids` after all search and sort conditions are applied. The second query is a data query. It fetches all the data needed to satisfy the user's request using the `replay-ids` returned by the preflight.

Let's transform our example query into this new format:

```sql
-- Preflight Query
SELECT replay_id
FROM replay_events
GROUP BY replay_id
LIMIT 1

-- Data Query
SELECT replay_id, groupArray(url)
FROM replay_events
WHERE replay_id = 'my_replay_id'
GROUP BY replay_id
LIMIT 1
```

The total memory footprint of our preflight query has been reduced by the uncompressed-size of the `url` column. But our data query hasn't increased by that amount. It's only increased by the uncompressed-size of the `url` column _for that replay_id_.

**In the HAVING Clause**

Let's look at another example query:

```sql
SELECT replay_id
FROM replay_events
GROUP BY replay_id
HAVING has(groupArray(url), 'sentry.io')
LIMIT 1
```

We've adopted our changes from the previous step but now, to answer a search condition, we're aggregating the URL column in the HAVING clause. This has identical memory-usage to SELECTing the column directly. So how do you ask the question "is some value contained within the aggregated set" when the aggregated set is too large to fit in memory? You "stream" it!

Instead of aggregating a column and then asking it some question, you can ask the column a question and aggregate its answer before finally asking a question about the aggregated answer! Clear as mud? Let's demonstrate the concept with SQL.

Let's ask the same question again: "does sentry.io exist in the set of aggregated urls". How should we phrase this in SQL? There's the straight-forward approach `has(groupArray(url), 'sentry.io')` and then there's the streaming approach `sum(url = 'sentry.io') > 0`. What we've done here is subtle but has huge implications. Instead of aggregating the url we're aggregating the result of the condition "does this term match this value" which is represented as either a 0 or 1.

The memory usage from aggregating these tiny integers is minimal meaning our largest customers can query their heaviest columns and consume 100x less memory. The query consumes memory proportional to the number of unique aggregation keys. The implication of this change might not be obvious but consuming memory in this manner is predictable and allows us to control the memory usage of the query through code and through ClickHouse configuration!

**In the ORDER BY Clause**

Let's look at a final query example.

```sql
SELECT replay_id
FROM replay_events
GROUP BY replay_id
ORDER BY sum(length(error_ids)) DESC
```

Our dataset has several heavy columns. For example, we keep an array of the errors encountered for each replay event received. We typically like to represent these values as counts for sorting and in their raw state for searching.

When we compute the counts we call `sum(length(column))`. This works but it requires reading those heavy columns. This increases the number of bytes read, decreases the rate of rows scanned, and increases memory usage significantly. Memory usage increases so much that for our largest customers sorting against these arrays is not possible.

Once again we've run up against this memory constraint but now we're out of tricks. We can't solve this problem at read-time. It has to be solved deeper in the stack.

An interesting feature of ClickHouse is its ability to materialize a column. Materalized columns are functions that are evaluated on insert and stored as some output type `T`. For example, a materialized `error_ids` column might look like this:

```sql
`count_errors` UInt8 MATERIALIZED length(error_ids)
```

By materializing the column we reduce a huge array of thousands of bytes into a single 1-byte integer value. The end result is more rows from the materialized column can be loaded into memory at once (better performance) and the total size of those values are thousands of times smaller (better memory usage).

Because this is evaluated on insert, it takes some time to rollout. In the case of Sentry, we have a retention-period and old rows gradually fall off the end. After making this change we just have to wait the duration of the retention-period before every row has this optimization.

In the mean time, we can still target the `count_errors` column and if it does not have any data populated it will compute the value at run-time. Performance gradually improves as time goes on.

**A Sprinkle of Configuration**

Because of our cardinality, memory usage is still too high. There's one final change we need to solve this problem. Because our memory usage is now proportional to the number of unique aggregation keys we need to cap the number of unique aggregation keys. This is really easy and its something you can set and forget.

In our preflight we're going to update our query with two new settings. The first is `max_rows_to_group_by`. A somewhat misnamed setting, it doesn't cap the number of rows in your aggregation result. It caps the number of unique aggregation keys. You can compute the maximum memory usage of our query by multiplying the size of a single row by the maximum number of aggregation keys. The second option is `group_by_overflow_mode`. The default configuration is "throw". We don't want that. Its up to you whether you choose "any" or "break". "break" will perform better and "any" _could_ return more accurate results. It depends on how your data is distributed. We've chosen "any" because at our current scale we don't observe any performance difference.

```sql
SELECT replay_id
FROM replay_events
GROUP BY replay_id
LIMIT 1
SETTINGS max_rows_to_group_by='1000000', group_by_overflow_mode='any'
```

### Success

We've done it! With these simple changes we've successfully conquered our memory usage. We could stop here and be happy. But there is this unspoken problem that we've not considered. We have to scan the full dataset for every query. For our use case, there's not many ways to avoid that but there are a few and in cases where we do have to perform a table scan it would be nice if those scans were faster.

### Making Schema Changes

**Encoding Columns**

ClickHouse offers the ability to alter the representation of a column on disk with special encodings like `LowCardinality`. The `LowCardinality` encoding takes some string value and converts it into an enum representation. We have a few columns that could benefit from this encoding. Maybe we should apply it there.

We're also using `Nullable` an awful lot too but should we? `Nullable` in ClickHouse works differently from other databases. ClickHouse stores null values in a separate file. Its basically a bitmap index of where the nulls are in our column. Your column would then contain the empty state of its datatype in each row position where a null exists. So string would be `""` and an integer would be `0`. By using null you don't save any space, you're just adding an index that needs to be scanned. So maybe we can remove it too.

Out of curiousity, what happens if we take this column:

```sql
`browser_name` Nullable(String)
```

And convert it into this column:

```sql
`browser_name` LowCardinality(String)
```

If you've installed ClickHouse with Docker you should have received `clickhouse-client`. On my machine, I can run `docker exec -it clickhouse /usr/bin/clickhouse-client` to start the client.

With this tool I can insert records into the database, run queries against those records, and evaluate the performance of those queries. I'm doing exactly that here to validate these schema changes. I've created a table called replays_test and I've added the `old` column which uses `Nullable(String)` and the `new` column which uses `LowCardinality(String)`. After that I bulk insert 1,000,000 rows and start playing around.

We can run the following query to see the size of the columns on disk:

```sql
SELECT
    name,
    formatReadableSize(sum(data_compressed_bytes)) AS compressed_size,
    formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed_size,
    round(sum(data_uncompressed_bytes) / sum(data_compressed_bytes), 2) AS ratio
FROM system.columns
WHERE table = 'replays_test'
GROUP BY name
ORDER BY sum(data_compressed_bytes) DESC
```

Which outputs:

```
┌─name───────┬─compressed_size─┬─uncompressed_size─┬──ratio─┐
│ old        │ 1.90 MiB        │ 4.47 MiB          │   2.36 │
│ new        │ 370.76 KiB      │ 978.55 KiB        │   2.64 │
└────────────┴─────────────────┴───────────────────┴────────┘
```

As you can see, our encodings have reduced our byte size by 80%. That's pretty cool and we didn't have to work too hard for it. We can also evaluate how these queries perform when reading these columns by running the following query:

```
SELECT
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage,
    query
FROM system.query_log
ORDER BY event_time DESC
LIMIT 10
```

Which produces this output:

```
┌─query_duration_ms─┬─read_rows─┬─read_bytes─┬─memory_usage─┬─query────────────────┐
│                24 │    245760 │    7047494 │     14303428 │ WHERE old = 'Safari' │
│                14 │    286720 │    4874860 │      8743218 │ WHERE new = 'Safari' │
└───────────────────┴───────────┴────────────┴──────────────┴──────────────────────┘
```

A pre-requisite to running this query is that you've run _other_ queries against your test table. But once you've done that you should see that our new, encoded column has significantly better performance than the old column. We read more rows with less memory usage and it takes us significantly less time to complete the query. Neat!

Be careful running this migration. It can be tough depending on the size of your dataset.

Side bar. Dropping nullability has implications for your query. For example, the `any` function will ignore nulls when computing its result. If you have an empty string value in your dataset that was previously marked as null your query may return that value rather than the non-empty string it previously returned. There's a simple solution to this. ClickHouse functions accept an `If` combinator and this combinator can be used to strip the empty values. Like so: `anyIf(column, notEmpty(column))`. The second argument to the function is any expression which returns a boolean result.

**Applying Indexes**

ClickHouse indexes are a little different from indexes in other databases. They don't point to a row. They point to a granule which is a collection of rows. At least one row will contain the indexed value for a given matched granule.

This is important because an index is no guarantee of a fast query. If your value has a 1/8192 (or greater) chance of being present on a row then indexing it will give you nothing. ClickHouse will scan every row in the database to answer your query.

Indexes should only be used for values which are rare. A UUID is a great candidate for an index. Someone's age in years is not.

I'll leave applying indexes as an exercise for the reader, we have a different problem we need to solve. Session Replay has an aggregated data model. Indexes won't work. We need an alternative.

One possibility is a sub-query. Our `replay_id` column is indexed and is not under any aggregate function. We can make scalar comparisons against it in the WHERE clause. A sub-query would then need to return a set of replay-ids matching some indexed condition. For example:

```sql
WHERE replay_id IN (
    SELECT replay_id
    FROM replay_events
    WHERE error_id = 'my_error_id'
)
```

For reasons outside the scope of this post, we did not end up using this approach. We decided on an alternative. In our preflight query, under certain conditions, we can apply WHERE clauses which reduce the aggregation set but do not alter the outcome of the query. For example, consider the question "show me every replay which contains the error_id `x`".

Instead of querying like this:

```sql
GROUP BY replay_id
HAVING sum(error_id = 'x') > 0
```

We can query like this:

```sql
WHERE error_id = 'x'
GROUP BY replay_id
```

There are limitations to this. For example, you can't filter by multiple error_ids at the same time. But for Sentry this optimization can be applied to nearly all of our queries. It also has the benefit of not consuming any memory which is a great win for a query operating in a memory-constrained environment.

Evaluating the "performance" of a query has many dimmensions. I've mentioned a couple throughout this post but one dimmension in particular is the target of this optimization. Query latency. We know we can find a query's latency by inspecting the system's logs but how scientific is that? Query latency when measured against one or two or ten runs of a query has limited utility. You need a more extensive testing strategy to truly evaluate the latency impact on a query chnage. Fortunately, ClickHouse includes a tool called `clickhouse-benchmark` for testing this. I'm able to access this utility by entering the following command: `docker exec -it clickhouse /usr/bin/clickhouse-benchmark`.

ClickHouse Benchmark accepts a `--query` parameter followed by a string argument. The benchmarking utility will execute that query thousands of times and at the end of this process you'll have a nice percentile breakdown of how a query performed. Here's the output of our before and after.

Before:

```
Queries executed: 1018.

localhost:9000, queries 1018, QPS: 94.159, RPS: 94158531.479, MiB/s: 5118.405, result RPS: 94.159, result MiB/s: 0.001.

0.000%          0.009 sec.
10.000%         0.009 sec.
20.000%         0.009 sec.
30.000%         0.009 sec.
40.000%         0.009 sec.
50.000%         0.009 sec.
60.000%         0.010 sec.
70.000%         0.011 sec.
80.000%         0.013 sec.
90.000%         0.014 sec.
95.000%         0.015 sec.
99.000%         0.015 sec.
99.900%         0.016 sec.
99.990%         0.016 sec.
```

After:

```
Queries executed: 3401.

localhost:9000, queries 3401, QPS: 474.014, RPS: 8706691.199, MiB/s: 406.868, result RPS: 474.014, result MiB/s: 0.004.

0.000%          0.002 sec.
10.000%         0.002 sec.
20.000%         0.002 sec.
30.000%         0.002 sec.
40.000%         0.002 sec.
50.000%         0.002 sec.
60.000%         0.002 sec.
70.000%         0.002 sec.
80.000%         0.002 sec.
90.000%         0.002 sec.
95.000%         0.002 sec.
99.000%         0.003 sec.
99.900%         0.004 sec.
99.990%         0.009 sec.
```

A 5x throughput improvement and our _P99.99 lateny_ matches our _P0 latency_ on the non-indexed query. Its amazing what a well-placed index can do!

### Parting Thoughts

Hopefully you enjoyed this post. ClickHouse is a really interesting piece of technology and well worth your time to learn if you've not looked at it before.
