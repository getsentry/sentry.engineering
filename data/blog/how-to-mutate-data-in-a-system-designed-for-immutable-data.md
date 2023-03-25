---
title: "How to Mutate Data in a System Designed for Immutable Data"
date: '2019-10-25'
tags: ['clickhouse','databases','building sentry']
draft: false
summary: "Sentry’s growth led to increased write and read load on our databases, and, even after countless rounds of query and index optimizations, we felt that our databases were always a hair’s breadth from the next performance tipping point or query planner meltdown. Increased write load also led to increased storage requirements (if you’re doing more writes, you’re going to need more places to put them), and we were running what felt like an inordinate number of servers with a lot of disks for the data they were responsible for storing. Here’s a look at how we attempted to understand which database system was right for us and how we adapted our approach when we encountered some unexpected challenges."
images: [/images/how-to-mutate-data-in-a-system-designed-for-immutable-data/hero.gif]
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2019/10/25/how-to-mutate-data-in-a-system-designed-for-immutable-data/
authors: ['filippopacifici','jamescunningham','tedkaemming']
---

*Welcome to our series of blog posts about things Sentry does that perhaps we shouldn’t do. Don’t get us wrong — we don’t regret our decisions. We’re sharing our notes in case you also choose the path less traveled. In this post, we look at how decisions made around prioritizing — or, as in our case, deprioritizing — mutability and consistency (in an [ACID](https://en.wikipedia.org/wiki/ACID) sense) affect database performance and how we deal with the fact that our data is mostly — but not totally — immutable.*

In [another post published here earlier this year](/blog/introducing-snuba-sentrys-new-search-infrastructure), we described some of the decision making that went into the design and architecture of Snuba, the primary storage and query service for Sentry’s event data. This project started out of necessity; months earlier, we discovered that the time and effort required to continuously scale our existing PostgreSQL-based solution for indexing event data was becoming an unsustainable burden.

Sentry’s growth led to increased write and read load on our databases, and, even after countless rounds of query and index optimizations, we felt that our databases were always a hair’s breadth from the next performance tipping point or query planner meltdown. Increased write load also led to increased storage requirements (if you’re doing more writes, you’re going to need more places to put them), and we were running what felt like an inordinate number of servers with a lot of disks for the data they were responsible for storing. We knew that something had to change.

Here’s a look at how we attempted to understand which database system was right for us and how we adapted our approach when we encountered some unexpected challenges.

## Outgrowing PostgreSQL
We knew that PostgreSQL wasn’t the right tool for this job, and many of the features that it provides — such as ACID transactions, MVCC semantics, and even row-based mutations — were ultimately unnecessary for the kinds of data that we were storing in it, as well as the types of queries we were running. In fact, not only were they unnecessary, but they caused performance issues at best, and [had played a major role in our worst outage to date](https://blog.sentry.io/2015/07/23/transaction-id-wraparound-in-postgres/) at worse. We can’t say that PostgreSQL was the problem — it served us well for years, and we still happily use it in many different parts of our application and infrastructure today without any intention of removing it — it just wasn’t the right solution for the problems we were facing any longer.

We realized that we needed a system oriented around fast aggregations over a large number of rows, and one optimized for bulk insertion of large amounts of data, rather than piecemeal insertion and mutation of individual rows.

## ClickHouse: faster queries + predictable performance
Ultimately, after evaluating several options, we settled on [ClickHouse](https://clickhouse.yandex/), which is the database that currently underpins Snuba, our service for storing and searching event data. ClickHouse and PostgreSQL have very different architectures (some of which we’ll dive into more detail about a bit later), and these differences cause ClickHouse to perform extremely well for many of our needs: queries are fast, performance is predictable, and we’re able to filter and aggregate on more event attributes than we were able to before. Even more amazingly, we can do it with fewer machines and smaller disks due to the shockingly good compression that can be achieved with columnar data layouts.

### Immutable data
ClickHouse can make many of these performance improvements because data that has been written is largely considered to be [immutable](https://en.wikipedia.org/wiki/Immutable_object), or not subject to change (or even deleted). Immutability plays a large role in database design, especially with large volumes of data — if you’re able to posit that data is immutable, DML statements like `UPDATE` and `DELETE` are no longer necessary.

If you’re just inserting data that never changes, the necessity for transactions is reduced (or removed completely), and a whole class of problems in database architecture goes away. This strategy works well for us — in general, we consider events that are sent to Sentry immutable once they have been processed. This decision is mostly a practical one: for example, the browser version that a user was using when they encountered an error is effectively “frozen in time” when that event occurs. If that user later upgrades their browser version, the event that we recorded earlier doesn’t need to be rewritten to account for whatever version they’re using now.

### And not-so-immutable data
But wait — while we do treat the event data that is sent to Sentry as immutable, the issues those events belong to can be deleted in Sentry, and those deletions should cause the events associated with those issues to be deleted as well. Similarly, while you can’t update the attributes of an event, you can modify its association with an issue through merging and unmerging. While these operations are infrequent, they are possible, and we needed to find a way to perform them in a database that wasn’t designed to support them.

Unfortunately, all of the massive improvements for the common cases were also drawbacks for several of the uncommon cases that exist in Sentry — but uncommon doesn’t also mean unsupported. In the remainder of this field guide, we’ll explore how mutability affects database design and performance and how we deal with mutating data in a database architecture that was primarily designed for storing immutable data: in this case, specifically ClickHouse.

## Mutating data v1: ClickHouse’s `ALTER TABLE`
One of our first attempts leveraged ClickHouse’s [ALTER TABLE mutations](https://clickhouse.yandex/docs/en/query_language/alter/#alter-mutations), which are documented as “intended for heavy operations that change a lot of rows in a table.” On paper, this looked exactly like what we were looking for. However, we used the feature when it was initially released, which came with a non-trivial amount of bugs.

Our favorite being [a bug](https://github.com/ClickHouse/ClickHouse/pull/2694) where the entire database was rewritten to alter a single row. Once the regression was fixed, we sought out to use `ALTER UPDATE` again, but to our dismay, we could only apply a single mutation at a time. Sentry users love to merge issues, and applying mutations one at a time meant constantly rewriting millions of rows to mutate thousands of rows. Even when mutations ran as fast as they could, they could not keep up with the request rate, and we would ultimately hit the high watermark for queued mutations.

Without the ability to delete data directly — ClickHouse has no `DELETE` statement — we had to think about the problem from a different angle. If we can’t delete the data, could we at least overwrite its content and prevent it from being returned in future result sets? And, how could we do this all without ClickHouse having an `UPDATE` statement?

### A quick aside: ClickHouse data storage
First, it’s important to know a bit about how ClickHouse stores data on disk so that we can identify what kind of options we have at our disposal. ClickHouse provides a variety of table storage engines that can be used depending on the specific needs of the table they are backing. Of the different table engines provided by ClickHouse (and there are a lot), our favorites are members of [the MergeTree family](https://clickhouse.yandex/docs/en/operations/table_engines/mergetree/). `MergeTree` implementations are superficially similar to the [log-structured merge-tree](https://en.wikipedia.org/wiki/Log-structured_merge-tree) data structure (or LSM tree) used by a wide variety of data stores, such as the SSTable used by Cassandra.

Like the LSM tree, data is stored in sorted order by primary key, making for efficient lookups by primary key and efficient range scans for ranges that share primary key components. When using the different variants of the `MergeTree` table engine family, each table has a defined `ORDER BY` clause, which also roughly equates to a primary key definition. One member of the `MergeTree` family is the `ReplacingMergeTree`, which supports a “row version” that is backed by an unsigned integer, date, or datetime column used to determine which version of a row should be preserved in the event of a primary key conflict.

## Mutating data v2: deleting by replacing
For the table that stores Sentry events, we’ve chosen to use the `ReplacingMergeTree` engine. The example schema below has the same key structure as our data model for Sentry events, but elides many of the data fields for brevity:

```sql
CREATE TABLE events
(
    event_id FixedString(32), 
    project_id UInt64, 
    group_id UInt64, 
    timestamp DateTime, 
    deleted UInt8 DEFAULT 0, 
    primary_hash Nullable(FixedString(32)), 
    data Nullable(String)
)
ENGINE = ReplacingMergeTree(deleted)
PARTITION BY toMonday(timestamp)
ORDER BY (project_id, toStartOfDay(timestamp), cityHash64(toString(event_id)))

Ok.

0 rows in set. Elapsed: 0.079 sec.
```

```sql
SELECT *
FROM events 

┌─event_id─────────────────────────┬─project_id─┬─group_id─┬───────────timestamp─┬─deleted─┬─primary_hash─────────────────────┬─data─┐
│ 00000000000000000000000000000000 │          1 │        1 │ 2019-10-30 00:00:00 │       0 │ c4ca4238a0b923820dcc509a6f75849b │ data │
└──────────────────────────────────┴────────────┴──────────┴─────────────────────┴─────────┴──────────────────────────────────┴──────┘

1 rows in set. Elapsed: 0.012 sec.
```

Our table includes a deleted `UInt8 DEFAULT 0 column` that is used as the row version. When an event is deleted, we insert a new record with the same primary key as the existing row and the value of the `deleted` column set to `1` — essentially overwriting the original record with a [tombstone](https://en.wikipedia.org/wiki/Tombstone_(data_store)).

```sql
INSERT INTO events (event_id, project_id, group_id, timestamp, primary_hash, data, deleted) VALUES ('00000000000000000000000000000000', 1, 1, '2019-10-30 00:00:00', 'c4ca4238a0b923820dcc509a6f75849b', '', 1);

Ok.

1 rows in set. Elapsed: 0.027 sec.
``` 

In Snuba, we refer to these rows as “replacements,” since they cause the old row to be replaced by the new row. To ensure that these replacement markers are not included in result sets for future queries, we automatically append the `deleted = 0` expression to the `WHERE` clause of all queries executed against this table. At this point, we should expect to have only one row (our deletion tombstone) in the table:

```sql
SELECT *
FROM events 

┌─event_id─────────────────────────┬─project_id─┬─group_id─┬───────────timestamp─┬─deleted─┬─primary_hash─────────────────────┬─data─┐
│ 00000000000000000000000000000000 │          1 │        1 │ 2019-10-30 00:00:00 │       0 │ c4ca4238a0b923820dcc509a6f75849b │ data │
└──────────────────────────────────┴────────────┴──────────┴─────────────────────┴─────────┴──────────────────────────────────┴──────┘
┌─event_id─────────────────────────┬─project_id─┬─group_id─┬───────────timestamp─┬─deleted─┬─primary_hash─────────────────────┬─data─┐
│ 00000000000000000000000000000000 │          1 │        1 │ 2019-10-30 00:00:00 │       1 │ c4ca4238a0b923820dcc509a6f75849b │      │
└──────────────────────────────────┴────────────┴──────────┴─────────────────────┴─────────┴──────────────────────────────────┴──────┘

2 rows in set. Elapsed: 0.011 sec.
```

Well… that’s not what we were looking for. Instead of the deleted event replacing the original event, now we have two events with the same primary key — one that isn’t deleted, and one that is. What’s going on?

### How `MergeTree` works
To know what is happening here, we have to dig in a little bit deeper into how the `MergeTree` works. The `MergeTree` design differs from the LSM tree in that a table is split into “partitions” that are defined in the schema definition, rather than levels based on the order that writes occurred.

For example, a table containing time series data might be partitioned by hour, day, or week depending on the amount of data the table contains. Each of these partitions contains one or more data files on disk, which are called “data parts.” Each `INSERT` to a table creates a new data part with its contents for the partitions affected — ClickHouse favors large writes for this reason — and these data parts are later merged together with other parts within that partition during a process referred to as optimization. Optimization combines several smaller parts within a partition by unioning their contents together, sorting the combined contents by primary key, and replacing these smaller parts with the new, larger part.

The different flavors of `MergeTree` differ primarily around how primary key conflicts are handled when they are encountered during optimization. Wait… primary key conflicts? In many database architectures, this our deletion query would have failed to execute due to the failure to maintain a unique constraint on the primary key, since we’re inserting new rows with the same primary key as rows that already exist. **In ClickHouse, there are no unique constraints, and `MergeTree`-backed tables can have duplicate primary keys**. `ReplacingMergeTree` does not replace rows on insertion, it replaces rows during optimization, and it makes no attempt to reconcile the state of all returned rows by default to ensure that they are in the latest state.

Knowing how the storage model works highlights an issue with the naive replacements approach: for a period of time, **both the original and (potentially multiple) replacement rows may be visible** since two (or more) rows with the same primary key exist in different data parts. Only during optimization are the rows with duplicate primary keys merged, leaving only the replacements behind.

### `FINAL`ly reducing potential inconsistencies
One option to reduce this potential for inconsistency is to force the table to be optimized by explicitly issuing the [OPTIMIZE FINAL statement](https://clickhouse.yandex/docs/en/query_language/misc/#misc_operations-optimize). Optimization is a resource-intensive process that merges all physical parts in a logical partition into a singular part, reading and rewriting every single row in a partition — the nuclear option, basically. As an alternative to running a table optimization, ClickHouse provides the `FINAL` keyword, which can be added to the `FROM` clause to collapse all duplicates during query processing, giving you the same result that you would have otherwise received when running a query immediately following an `OPTIMIZE`. Running our previous query with the `FINAL` keyword gives us our expected result:

```sql
SELECT *
FROM events
FINAL 

┌─event_id─────────────────────────┬─project_id─┬─group_id─┬───────────timestamp─┬─deleted─┬─primary_hash─────────────────────┬─data─┐
│ 00000000000000000000000000000000 │          1 │        1 │ 2019-10-30 00:00:00 │       1 │ c4ca4238a0b923820dcc509a6f75849b │      │
└──────────────────────────────────┴────────────┴──────────┴─────────────────────┴─────────┴──────────────────────────────────┴──────┘

1 rows in set. Elapsed: 0.009 sec.
```

The drawback to using `FINAL` is that queries are executed slower than they would be otherwise — sometimes by a significant margin. To quote the [ClickHouse documentation](https://clickhouse.yandex/docs/en/query_language/select/#select-from), “when using `FINAL`, the query is processed more slowly. In most cases, you should avoid using `FINAL`.” To avoid using `FINAL`, we keep track of a set (in Redis) of recently deleted issues for each project. Whenever we execute a query for that project, the set of recently deleted issues is added to the `WHERE` clause, automatically excluding the data from consideration without the need for `FINAL`.

We also limit the overall size of this exclusion set so that projects that would require filtering a large amount of recently deleted issues are instead switched to a query path that utilizes FINAL rather than maintaining an extremely large exclusion set. In addition, we run scheduled optimizations to keep up with row turnover, which allows us to set an upper time bound on how long an issue is maintained in the exclusion set after the deletion was initiated.

### From `1` to `NULL`: bulk operations
It’s not a common case in Sentry to delete individual events — in fact, there isn’t an API endpoint that will delete a single event independently. There is, however, an endpoint that provides the ability to delete an entire issue at once. This operation would be straightforward for PostgreSQL: you’d just issue a `DELETE FROM events WHERE group_id = %s` query. What about in ClickHouse, where `DELETE` isn’t a defined SQL statement? If a user requests that we delete all of the events in an issue, how can we do that without deleting each event individually?

Luckily, ClickHouse allows us to insert the result of a SELECT query with [INSERT INTO … SELECT](https://clickhouse.yandex/docs/en/query_language/insert_into/#insert_query_insert-select) statements. By crafting a query that selects all of the rows that are to be deleted and returning a result set containing each row’s primary key, the `deleted` column set to `1`, and all other column values set to either `NULL` or their default value, we can delete large numbers of rows in a single statement.

```sql
INSERT INTO events (event_id, project_id, group_id, timestamp, primary_hash, data, deleted) SELECT 
    event_id, 
    project_id, 
    group_id, 
    timestamp, 
    NULL, 
    NULL, 
    1
FROM events 
WHERE (project_id = 1) AND (group_id = 2)

Ok.

0 rows in set. Elapsed: 0.018 sec.
```

The same strategy applies beyond deletions to other types of updates, such as merging two issues together. When merging two issues together, we can construct a query that rewrites events from an issue (or set of issues) into the new target issue:

```sql
INSERT INTO events 
(event_id, project_id, group_id, timestamp, primary_hash, data)
SELECT event_id, project_id, 1, timestamp, primary_hash, data
FROM events
WHERE project_id = 1 and group_id = 2;
```

We can also use the exclusion set strategy on subsequent `SELECT` queries, in this case, to avoid being required to add `FINAL` to each query for the affected project since the issues that had their events moved to another issue are essentially deleted during the merge.

## Lesson learned: don’t take database features for granted
Looking back, not having in-place mutations wasn’t something that we thoroughly considered when moving our event storage to a totally different architecture. `UPDATE` and `DELETE` queries are so commonly available in many database systems that it’s easy to take them — and all of the other features and niceties of more fully-featured database — for granted.

Often, though, the most effective way to improve the performance of a system is to strip away anything that isn’t essential to it’s functioning, and sometimes not having all of the batteries included from the start forces you to be a little more creative to make up for those shortcomings. As it turns out, the more you know about how something (like a database) works, the more you can trick it into doing what you want.

It might feel like we’re taking the rental car off-road some days… but hey, if you want to write a Field Guide, you first have to get through the field.