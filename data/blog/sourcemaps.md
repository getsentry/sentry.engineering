---
title: 'A deep dive into SourceMaps'
date: '2022-08-08'
tags: ['debug files', 'source maps', 'debugging']
draft: false
summary: 'What are SourceMaps, and how do you decode their `mappings` in detail.'
images: []
layout: PostLayout
canonicalUrl: https://swatinem.de/blog/sourcemaps/
authors: ['arpadborsos']
---

Over the last year, I started a blog series over on [my personal blog](https://swatinem.de) about various debug formats,
in particular how their _line mappings_ / _line programs_ work.

In this series, we will be looking at:

- [SourceMaps and their `mappings`](https://swatinem.de/blog/sourcemaps/), this one right here
- [Portable PDBs and their Sequence Points](https://swatinem.de/blog/sequence-points/)
- [DWARF and its line programs](https://swatinem.de/blog/dwarf-lines/)

---

# SourceMaps, abstractly

For people not familiar with the matter, SourceMaps are a building block used in
the JavaScript ecosystem. They are used to map from a location in the "final"
(minified, transpiled) JavaScript code back to the original source, which might
not even be JavaScript.

The SourceMap _specification_ lives in a
[Google Doc](https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit#)
which I would argue is a weird format, but adequate to understand how to interpret it.

Here is an example of some minified JS, plus its corresponding SourceMap.

<!-- prettier-ignore -->
```js
function t(){}export default t;
```

```json
{
  "version": 3,
  "names": ["abcd"],
  "sources": ["tests/fixtures/simple/original.js"],
  "sourcesContent": [
    "// ./node_modules/.bin/terser -c -m --module tests/fixtures/simple/original.js --source-map includeSources -o tests/fixtures/simple/minified.js\nfunction abcd() {}\nexport default abcd;\n"
  ],
  "mappings": "AACA,SAASA,oBACMA"
}
```

As you can see, the SourceMap is a human readable JSON file. It has a list of filenames in `sources`, and optionally
their contents in `sourcesContent`. We also have a list of `names`, which is used
to refer to original non obfuscated identifiers.

And then we have the `mappings` we want to look at in more detail. As they are
embedded in a JSON file, we have some restrictions on the type of data we can
put here. We can’t use plain binary data directly. SourceMaps thus use an ASCII
friendly base-64 [Variable-length quantity (VLQ)](https://en.wikipedia.org/wiki/Variable-length_quantity) encoding for this purpose.

# State Machines

The `mappings` do not contain individual entries, but rather operate on a _state machine_.
This means you have to keep some internal state around, which is being incrementally updated
by _instructions_ or _deltas_ from the `mappings`.
Every now and then this state is then flushed out and represents a concrete mapping entry.

One of such entries, called a `Token` in SourceMap terminology, can have the following:

- the "minified" line number,
- the "minified" column number, encoded as delta,
- (optionally), an index into the `sources`, encoded as delta,
- (optionally), the line and column, encoded as delta,
- (optionally), an index into the `names`, encoded as delta.

There are two special "instructions" for the state machine:

- `';'` increases the "minified" line number by 1, and resets the "minified" column back to `0`.
- `','` yields the current state as a token and "resets" the optional fields. The "reset" is not back to `0` but rather to
  `None`, which means the next token yielded will not have a `source` for example.

Otherwise we have a number of _Base 64 VLQ_ entries, either:

- 1, updating the "minified" column number,
- 4, additionally updating and yielding the source index, line and column,
- or 5, which additionally yields updates the name index and yields it.

The resulting tokens are sorted by "minified" line, and "minified" column.

In the end, the most gains from this format come from the delta encoding. The
_Base 64 VLQ_ on itself is not very efficient. A raw byte has `256` unique
values. Base 64 encoding reduces that to `64`. Another "continue" bitflag
reduces that to `32`. Or 5 useful bits per byte.

# Decoding the mappings

Lets look at the concrete `mappings` above in more detail and decode it.
As a reminder, our `mappings` are `AACA,SAASA,oBACMA`.

```text
'A' (b64: 0b0000_0000): add 0 to the minified column number
'A' (b64: 0b0000_0000): add 0 to the sources index
'C' (b64: 0b0000_0010): add 1 to the line number
'A' (b64: 0b0000_0000): add 0 to the column number
',': yield the token: {0, 0, 0, 1, 0, None}
'S' (b64: 0b0001_0010): add 9 to the minified column number
'A' (b64: 0b0000_0000): add 0 to the sources index
'A' (b64: 0b0000_0000): add 0 to the line number
'S' (b64: 0b0001_0010): add 9 to the column number
'A' (b64: 0b0000_0000): add 0 to the name index
',': yield the token: {0, 9, 0, 1, 9, 0}
'o' (b64: 0b0010_1000): continue with next byte, lowest 5 bits are `0b0_1000`
'B' (b64: 0b0000_0001): next 5 bits `0b0_0001` are prepended to the number, resulting in `0b0010_1000`:
                        add 20 to the minified column number
'A' (b64: 0b0000_0000): add 0 to the sources index
'C' (b64: 0b0000_0010): add 1 to the line number
'M' (b64: 0b0000_1100): add 6 to the column number
'A' (b64: 0b0000_0000): add 0 to the name index
end: yield the token: {0, 29, 0, 2, 15, 0}
```

Decoding these `mappings` thus yields the following tokens:

```text
{ minified_line: 0, minified_column: 0, source_index: 0, source_line: 1, source_column: 0, name_index: None }
{ minified_line: 0, minified_column: 9, source_index: 0, source_line: 1, source_column: 9, name_index: 0 }
{ minified_line: 0, minified_column: 29, source_index: 0, source_line: 2, source_column: 15, name_index: 0 }
```

# How to use these `mappings`

We have a pretty simple example with only a single source file in `sources`.
Simple enough so we can look at the minified and the original source side by side:

<!-- prettier-ignore -->
```js
// --- minified ---
function t(){}export default t;
// - line 0, column 0 corresponds to line 0, column 0 in `original.js`
//       ^- line 0, column 9 corresponds to line 1, column 9 in `original.js` and has name `abcd`
//                           ^- line 0, column 29 corresponds to line 2, column 15 in `original.js` and has name `abcd`

// --- original ---
// ./node_modules/.bin/terser -c -m --module tests/fixtures/simple/original.js --source-map includeSources -o tests/fixtures/simple/minified.js
function abcd() {}
//       ^- the second token points here on line 1
export default abcd;
//             ^- the third token points here on line 2
```

One thing to note here is that the SourceMap tokens only represent a single
point in the minified file, not a _range_.
To do a lookup, you can exploit the fact that these tokens are properly sorted
by line and column to do a binary search.
Since we don’t have an _explicit_ range, most implementations assume that a
token has an _implicit_ range up to the next token, or to infinity for the last
token.

For example, if we perform the following lookup:

<!-- prettier-ignore -->
```js
function t(){}export default t;
//                 ^- line 0, column 19
```

That lookup would resolve to:

```text
{ minified_line: 0, minified_column: 9, source_index: 0, source_line: 1, source_column: 9, name_index: 0 }
```

Which is not entirely true, as the token points to the wrong original source line.
The resolution here depends on the tool producing the source map. In most cases
though we are close enough. And the tools are good enough to insert tokens in
all "interesting" places.

# Summary

To summarize the SourceMap format, lets look at a few properties that it has,
what kind of data it encodes, and which lookups we can use it for.

- SourceMaps are JSON, and have a ASCII-encoded `mappings`.
- They have a list of `sources` with optional `sourcesContent` and `names`.
- The `mappings` encodes deltas that operate on a state machine which yields Tokens.
- These tokens can map from `line`/`column` pairs to:
- … the original source location given by an index into `sources`, a `line` and `column`,
- plus optionally an index into `names`.

SourceMaps thus allow us to look up a minified location, mapping it to an
approximate position in the original source.

Most importantly, SourceMaps do not directly encode information about function
scopes and names. Though there are extensions that can do that, but those are
not widely used.

---

There you have it. A deep dive into the SourceMap format, with a focus on its
_Base 64 VLQ_ `mappings`. This was just one example of debug file formats and
the way they encode information compactly. You can look at other formats as well in this blog series.
