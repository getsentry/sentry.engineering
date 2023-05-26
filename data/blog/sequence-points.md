---
title: 'A deep dive into Portable PDB Sequence Points'
date: '2022-09-02'
tags: ['debug files', 'portable pdb', 'debugging']
draft: false
summary: 'What are Portable PDB files, and how do you decode their Sequence Points in detail.'
images: []
layout: PostLayout
canonicalUrl: https://swatinem.de/blog/sequence-points/
authors: ['arpadborsos']
---

Over the last year, I started a blog series over on [my personal blog](https://swatinem.de) about various debug formats,
in particular how their _line mappings_ / _line programs_ work.

In this series, we will be looking at:

- [SourceMaps and their `mappings`](https://swatinem.de/blog/sourcemaps/)
- [Portable PDBs and their Sequence Points](https://swatinem.de/blog/sequence-points/), this one right here
- [DWARF and its line programs](https://swatinem.de/blog/dwarf-lines/)

---

# Sequence Points, abstractly

Similar to SourceMaps and other debug formats, the sequence points allow
mapping from IL offsets to source information.

The Portable PDB Format is specified in a
[markdown document here](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PortablePdb-Metadata.md)
and is complementary to the main
[ECMA-335 specification](https://www.ecma-international.org/publications-and-standards/standards/ecma-335/)
that is available in PDF format.

In particular, Portable PDB defines a new `#Pdb` stream, a bunch of new tables
contained in the `#~` stream, as well as new Blob formats that are within the
`#Blob` heap.

Section `II.23.2` of the main `ECMA-335` spec describes a very specific way to
save compressed integers that does not look very familiar, and comes with the
tradeoff of only allowing at most `29` usable bits.

- `0b0xxx_xxxx`: 7 usable bits encoded as 1 byte.
- `0b10xx_xxxx 0bxxxx_xxxx`: 14 usable bits encoded as 2 bytes.
- `0b110x_xxxx 0bxxxx_xxxx 0bxxxx_xxxx 0bxxxx_xxxx`: 29 usable bits encoded as 4 bytes.

The encoding is using big endian byte order, and the signed encoding is using
rotation to move the sign bit into the last position.

One of the additional tables defined in the Portable PDB spec is the
`MethodDebugInformation` which references a blob in `#Blob` heap containing
sequence points. The `MethodDebugInformation` and the sequence points blob can
also reference source files in the `Document` table.

These sequence points have the following information:

- the start IL offset,
- the document,
- the start line / column,
- the end line / column.

There is a bunch of things to note here:

- Only the start IL offset is explicitly given, so similar to SourceMaps, each
  sequence point implicitly extends to the next one.
- There are also "hidden" sequence points, probably to denote gaps in the mappings.
- One specialty here is that the sequence points do not give a _position_ in the
  source code, but rather a _span_.

# State Machine

Similar to the other mapping formats, the sequence points blob also acts as a
state machine.

You have some mutable state, and have instructions and deltas that modify that
state.

In this case, we start out with a document, and the blob can have an instruction
that changes that document. The IL offset, line and column are also given as a delta to
the previous record. And the source span is also delta-encoded.

The encoding is further complicated by the fact that either signed or unsigned
encoding is used based on some condition. For example, the column delta is
unsigned in case the source span does not span multiple lines. It is signed
otherwise. This totally makes sense, as a source span should never go backwards.
But it does add complexity to the decoder / encoder.

# Decoding a mapping

As an exercise, lets try to decode the following blob, and walk through the
bytes one by one.

Our initial state machine starts out at all `0` values.

```text
blob: 00 00 18 2e 09 06 00 12 04 08 06 00 01 02 79

0x00: add 0 to the IL offset
0x00: set source span line delta to 0
0x18: set source span column delta to 24
0x2e: add 46 to the start line, unsigned for the first entry
0x09: add 9 to the start column, unsigned for the first entry
- Sequence Point: { il_offset: 0, source_span: [46:9 - 46:33] }
0x06: add 6 to the IL offset
0x00: set source span line delta to 0
0x12: set source span column delta to 18
0x04: add 2 to the start line, signed
0x08: add 4 to the start column, signed
- Sequence Point: { il_offset: 6, source_span: [48:13 - 48:31] }
0x06: add 6 to the IL offset
0x00: set source span line delta to 0
0x01: set source span column delta to 1
0x02: add 1 to the start line, signed
0x79 (0b0111_1001, 0b1111_1100 rotated): subtract 4 from the start column
- Sequence Point: { il_offset: 12, source_span: [49:9 - 49:10] }
```

Mind you, this was a very simple (but real-life) example. We did not have any
hidden sequence points, document changes or source spans that span multiple lines.
But it did highlight how parsing the sequence points blob work, and also
that we can get along with 5 bytes per sequence point for simple cases. Not bad.

# How to use these mappings

So how do we make use of these mappings?

Assuming we have a "normal" .NET runtime, we can get the IL offset trivially via the
[`StackFrame.GetILOffset`](https://docs.microsoft.com/en-us/dotnet/api/system.diagnostics.stackframe.getiloffset)
method. However, what might not be entirely obvious from our look at the format
so far is that the IL offset is _per method_.

Getting the method index is not particularly obvious or well documented.
Starting from the
[`Method`](https://docs.microsoft.com/en-us/dotnet/api/system.diagnostics.stackframe.getmethod)
of a `StackFrame`, we can access the
[`MetadataToken`](https://docs.microsoft.com/en-us/dotnet/api/system.reflection.memberinfo.metadatatoken).

Section `II.22` of the `ECMA-335` spec says how to interpret this:

> Uncoded metadata tokens are 4-byte unsigned integers, which contain the metadata
> table index in the most significant byte and a 1-based record index in the three least-significant bytes.

The table index for `MethodDef`s is `0x06` which we can assert, and the rest
is the method index that also corresponds to the index inside our `MethodDebugInformation`
table.

And there you have it. With these two pieces of information, we can resolve a
`StackFrame` to its source location, or even source span.

# The elephant in the room

What is missing now is actually finding the Portable PDB file.

The PDB file has a self-describing UUID inside its `#Pdb` stream. And the
corresponding executable file has a special `CodeView` record that is slightly
different from normal `CodeView` records though.
The difference is documented in
[this specification](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PE-COFF.md#codeview-debug-directory-entry-type-2)
though. I have previously written about some
[pitfalls related to CodeView records](https://swatinem.de/blog/format-ossification/) btw.

Either way, getting the `CodeView` record and thus the UUID at runtime is not
trivial. It requires reading that record directly from the PE file via the
[`PEReader`](https://docs.microsoft.com/en-us/dotnet/api/system.reflection.portableexecutable.pereader)
class. Creating a file stream to access that file from disk might not always
be possible. Neither is getting a hold of the memory region where the PE file
might already be mapped at.

This is still an unsolved problem right now unfortunately. Though even ahead-of-time
compiled mobile apps ship the PE files in their app bundles. Most likely for
the embedded runtime metadata. Which makes me hopeful that we can access those
at runtime somehow and close the loop.

# Summary

We took a deep dive into the Portable PDB format, and we learned a bunch of
things about it:

- Portable PDBs extend the `ECMA-335` format. Both are reasonably well documented.
- The PDB has a list of `Document`s and `MethodDebugInformation` with sequence points.
- The sequence points blob forms a state machine that yields sequence points.
- These sequence points have an IL offset, a document and source span.
- You can get the IL offset and the method index at runtime fairly easily.

The Portable PDB does not include the data needed to pretty print function
signatures. That is embedded in the `ECMA-335` metadata of the executable file.

Speaking of which, the executable also has a reference to the Portable PDB via
its UUID. But that is not readily available at runtime.
