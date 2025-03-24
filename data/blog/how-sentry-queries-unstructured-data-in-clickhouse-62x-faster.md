---
title: 'How Sentry queries unstructured data in ClickHouse 62x faster'
date: '2025-03-24'
tags: ['clickhouse', 'web', 'optimization']
draft: false
summary: 'We repurposed a hashtable to make ClickHouse significantly faster for analytical queries'
images: [/images/how-sentry-queries-unstructured-data-in-clickhouse-62x-faster/hero.png]
layout: PostLayout
canonicalUrl:
authors: [colinchartier]
---

Sentry’s users send us many billions of ‘spans’ to measure the performance of their products - these are essentially a measurement of how long a particular operation took.

![Screenshot of Sentry Tracing displaying several spans](/images/how-sentry-queries-unstructured-data-in-clickhouse-62x-faster/hero.png)


Since our users are so varied, we can’t assume anything about the structure of the spans they send. They might send one which corresponds to how long a webpage took to load, and one which measures how long a phone call took.

We need to handle completely *unstructured* data.

```jsx
// Example: A user sends a span corresponding to a webpage navigation
{
  "start_time": "5:01 on Monday",
  "end_time": "5:02 on Monday",
  "name": "React webpage navigation",
  "attributes": {
    "browser": "chrome",
    "reactVersion": "21.3.0"
  }
}

// Example: A user sends a span corresponding to a phone call
{
  "start_time": "5:01 on Tuesday",
  "end_time": "5:10 on Tuesday",
  "name": "Inbound phone call",
  "attributes": {
    "destinationNumber": "+1 800‑555‑0115",
    "callResolved": true
  }
}

// These two examples share no attributes! They are *unstructured*
```

## How spans work at sentry

Sentry has three core use-cases of spans:

1. **Alerting** - “Email me when the average visitor is taking more than a second to load the webpage”
2. **Graphing** - “Give me a graph of how long the webpage took to load for Chrome users over the past week”
3. **Tracing** - “Colin at Sentry emailed me, and said he got an error on our pricing page. Find me all of the spans and errors corresponding to when Colin visited our pricing page.”

All of these use-cases are fulfilled by an OSS database called [ClickHouse](https://clickhouse.com/) via a service we run called [Snuba](https://getsentry.github.io/snuba/).

They are all relatively hard to implement, but the second is particularly hard - making millions of graphs with billions of data points is inherently a very expensive thing.

![System architecture](/images/how-sentry-queries-unstructured-data-in-clickhouse-62x-faster/system-architecture.svg)

## The problem with unstructured data

ClickHouse was originally made to store structured data - in particular, it was originally designed to be the database for an analytics tool. In that original use-case, the data had a very rigid schema:

```sql
CREATE TABLE clicks(pos_x UInt(16), pos_y UInt(16), user_id UInt(64), left_click Boolean, ...) 
```

Having a schema lets ClickHouse optimize how it stores the data - in particular, it creates a file for each column `pos_x.dat`, `pos_y.dat`, … - and only reads the few files corresponding to any particular query.

However, for our use-case, the `attributes` field contains arbitrary user-provided keys - things like `callResolved` and `browser` which are on some spans but not others. This means that there would be thousands and thousands of files if we did things the naive ClickHouse way - `callResolved.dat`, `browser.dat`, `destinationNumber.dat`, …

```sql
CREATE TABLE spans_v1(id UInt(64), browser String, mobile_device String, duration_ms Float(64), (1000+ other columns))
```

We tried this - and it immediately failed. ClickHouse allocates memory for every existing column for every row you insert. If you have 1000 columns, it will allocate hundreds of gigabytes for every insertion! Not to mention, if a user sends a new column that we’ve never seen before, we still can’t store it in one of these columns.

## The `Map`  type in ClickHouse

Luckily for us, ClickHouse comes with a special type called `Map` . We could use it for our spans table to avoid adding thousands of columns!

```sql
CREATE TABLE spans_v2(id UInt(64), attributes_string Map(String, String), attributes_float Map(String, Float(64)))
```

With this schema, we could write queries which reference unstructured data: `SELECT sum(attributes_float['duration_ms']) WHERE attributes_string['os']='chrome'`

Here, we only have three columns instead of the thousands+ in `spans_v1` from earlier.

### Bad performance 😟

There’s a problem with this structure too - we’re only using 3 files! If you try to read `attributes_float['duration_ms']`, you are opening a single massive file which contains every single numeric attribute, and then looping over all of its bytes.

|              | spans_v1 | spans_v2 |
|--------------|----------|----------|
| # of columns | 1000+    | 3        |

That means that if your span has 30 attributes, we have to load the data from all 30 of those attributes to just aggregate a single one - this is essentially defeating the whole point of ClickHouse, and makes things feel much slower!

## A digression to hash tables

There’s a common data structure in computer science that’s over 70 years old - the *Hash Table.*

The (simplified) idea for a hash table is to have a fixed set of buckets, where each bucket has a few elements. A function called the *hash* converts the key to a number, and then we use that number to decide which bucket the element goes into.

Consider the following python pseudocode:

```python
class HashTable:
  def __init__(self, num_buckets=30):
    self.buckets = [[] for _ in range(num_buckets)]
  
  def insert(item_key: str, item_val: Any):
    hash_val = hash(item_key)
    self.buckets[hash_val % len(self.buckets)].append((item_key, item_val))
  
  def get(item_key: str):
    hash_val = hash(item_key)
    bucket_item_might_be_in = self.buckets[hash_val % len(self.buckets)]
    for k, v in bucket_item_might_be_in:
      if k == item_key:
        return v
    
```

If you have ~30 buckets and ~30 unique keys, then on average each column will have a single key in it.

## A hash table in ClickHouse

This idea leads us to a third version of the schema:

```sql
CREATE TABLE spans_v3(
	id UInt(64), 
	attributes_string_0 Map(String, String),
	attributes_string_1 Map(String, String),
	...
	attributes_string_49 Map(String, String),
	attributes_float_0 Map(String, Float(64)),
	attributes_float_1 Map(String, Float(64)),
	...
	attributes_float_49 Map(String, Float(64)),	
)
```

You might already see the parallels with the hash table above - we’ve split the keys in the second approach into 100 buckets using a hash function, and now each column has ~1/100th of the total data.

We can then write [a query processor](https://github.com/getsentry/snuba/blob/2525fb711585104f8b9d88fd1b9ae96726b29e4e/snuba/clickhouse/translators/snuba/mappers.py#L231-L264) in Snuba which takes an incoming request, and transforms it to refer to specific buckets, instead of a single big column:

```python
# fnv_1a is a fast hash function often used in hash tables  
bucket_idx = fnv_1a(key.value.encode("utf-8")) % self.num_attribute_buckets

# consider a request for attributes_string['hello'].
# fnv_1a('hello') is 1335831723
# self.num_attribute_buckets is 50
# so fnv_1a(key.value) % self.num_attribute_buckets is 3
# which means the final request goes to attributes_string_3['hello']
return arrayElement(
  expression.alias,
  ColumnExpr(None, self.to_col_table, f"{self.to_col_name}_{bucket_idx}"),
  key,
)
```

The end result of this schema is that we have a bounded number of columns (~100) where each column has approximately ~1/100th of the total data, making every query scan approximately 1% of the data of our second approach, and making every query approximately ~100x faster!

## Benchmarks

This didn’t all happen in a vacuum - we carefully defined every operation we wanted to optimize with our new schema, and benchmarked throughout the development process. Here is a summarized version of our findings:

|          | Get newest trace that matches span conditions | Get newest trace that matches span conditions | Get spans for trace | OLAP WHERE sentry_tags[x] for a specific project |
|----------|-----------------------------------------------|-----------------------------------------------|---------------------|--------------------------------------------------|
| spans_v2 | 4.076 sec                                     | 0.032 sec.                                    | 0.016 sec           | 2.643 sec.                                       |
| spans_v3 | 2.334 sec.                                    | 0.018 sec.                                    | 0.021 sec           | 0.042 sec.                                       |

The particular operation we were worried about (OLAP - the `sum(attrs['x']) WHERE attrs['y']` query above) was 62x faster with the bucketing schema, which roughly matches the performance gains we expected.

## Conclusion

Hash Tables are a very old concept in Computer Science, and it’s easy to discount such things as purely academic.

By applying them to a domain where they aren’t traditionally used, we were able to dramatically improve our database performance without needing to make large code changes. This schema is now what is powering Sentry’s latest features: Custom dashboards, log storage, tracing, and more!