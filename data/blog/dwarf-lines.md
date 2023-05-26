---
title: 'A deep dive into DWARF line programs'
date: '2023-01-04'
tags: ['debug files', 'dwarf', 'debugging']
draft: false
summary: 'What are DWARF files, and how do you decode their line tables in detail.'
images: []
layout: PostLayout
canonicalUrl: https://swatinem.de/blog/dwarf-lines/
authors: ['arpadborsos']
---

Over the last year, I started a blog series over on [my personal blog](https://swatinem.de) about various debug formats,
in particular how their _line mappings_ / _line programs_ work.

In this series, we will be looking at:

- [SourceMaps and their `mappings`](https://swatinem.de/blog/sourcemaps/)
- [Portable PDBs and their Sequence Points](https://swatinem.de/blog/sequence-points/)
- [DWARF and its line programs](https://swatinem.de/blog/dwarf-lines/), this one right here

---

# DWARF, the specification

The whole DWARF specification is available over at [dwarfstd.org](https://dwarfstd.org/).
It is a gigantic PDF file with >450 pages (including indices, etc). Things are
reasonably well interlinked in there, though its still hard to navigate and
find specific things you are looking for.

DWARF also evolves quite slowly. Version 5, which is only now starting to be used
as the default version output by compilers is dated February 2017. That is almost…
checks date… 6 years.

Some compilers are a bit overeager to use newer features though, and some things
from DWARF v6 are already in use, even though the standard version has not been
_published_ yet. In those cases one can only link to PRs from the compiler
implementation.

The DWARF information itself is scattered throughout different formats and tables.
They are included in different sections of an executable. The line program is
defined in the `.debug_line` section (or `__debug_line` on macOS),
and it can reference data in other sections as well.

As with other sections, and DWARF info in general, the `.debug_line` section
is just a concatenation of all the line programs of all the compilation units.

Either way, on to line programs. These are described in _Chapter 6.2_ (of the V5 doc).
As with the previous formats I have described, the DWARF line program is also
encoded as a state machine. This state machine encodes at least the following information
(literally copied from the standard):

- the source file name
- the source line number
- the source column number

The format is also very extensible, and encodes more information than that.
In the current version, it also encodes information about statements, basic
blocks, which are a sequence of instructions that are branch targets and do not
branch away themselves. As well as a couple of flags to indicate end of prologue,
beginning of epilogue and end of sequence.

For the purpose of this blog post we are only interested in the end of sequences.
Sequences are contiguous runs of instructions. The state machine is
reset after a sequence and they mark the first instruction _after_ the sequence.
I believe sequences more or less correspond to functions.
As the linker is free to reorder functions, and only the starting offset of a
function needs to be updated in that case.

After a header describing the configuration of the state machine, specifically
`opcode_base` and `line_base` which have an effect on the _special opcodes_
that are encoded in only one byte. How to decode and interpret these is explained
in chapter `6.2.5.1` of the DWARF v5 spec.
Other opcodes may take advantage of LEB128 encoded integers, so are variable
length.

# Decoding a sequence

As the whole `.debug_line` section is quite complex, and the header includes a
variable length list of directories and file names, I will simplify this to
only look at the state machine itself.

The header gives us at least the following information, which you can also get
when you dump the `.debug_line` contents via `llvm-dwarfdump --debug-line --verbose`:

- `line_base: -5`
- `line_range: 14`
- `opcode_base: 13`
- `file_names[1]: "main.c"`

The header also defines `min_inst_length: 1` and `max_ops_per_inst: 1`, which
simplifies the calculation of the _operation advance_, or the address increment.
In that case, the state machine does not need to keep track of an internal `op_index`.

The leaves us with the following bytes to decode:

```text
blob: 00 09 02 50 3f 00 00 01 00 00 00 16 05 05 0a e5 59 75 02 06 00 01 01

We start out with { addr: 0x0, file: 1, line: 1, column: 0 }

0x00: this is an extended opcode
0x09: the extended opcode spans 9 bytes
0x02: this is the extended opcode `DW_LNE_set_address`
50 3f 00 00 01 00 00 00: the remaining 8 bytes are little endian for: `0x100003f50`
0x16 (22 in decimal): this is a special opcode:
  - adjusted opcode: 22 - 13 = 9
  - operation advance: 9 / 14 = 0 (truncating division)
  - line increment: -5 + (9 % 14) = 4
  => We emit the following entry: { addr: 0x100003f50, file: 1, line: 5, column 0 }
0x05: this is a standard opcode `DW_LNS_set_column`
0x05: set the column number to `5`
0x0a (10 in decimal): this is a standard opcode `DW_LNS_set_prologue_end`
0xe5 (229 in decimal): this is a special opcode:
  - adjusted opcode: 229 - 13 = 216
  - operation advance: 216 / 14 = 15
  - line increment: -5 + (216 % 14) = 1
  => We emit the following entry: { addr: 0x100003f5f, file: 1, line: 6, column: 5 }
  ... also, this is a prologue end, but we do not care about that
0x59 (89 in decimal):  this is a special opcode:
  - adjusted opcode: 89 - 13 = 76
  - operation advance: 76 / 14 = 5
  - line increment: -5 + (76 % 14) = 1
  => We emit the following entry: { addr: 0x100003f64, file: 1, line: 7, column: 5 }
0x75 (117 in decimal):  this is a special opcode:
  - adjusted opcode: 117 - 13 = 104
  - operation advance: 104 / 14 = 7
  - line increment: -5 + (104 % 14) = 1
  => We emit the following entry: { addr: 0x100003f6b, file: 1, line: 8, column: 5 }
0x02: this is a standard opcode `DW_LNS_advance_pc`
0x06: operation advance: 6
0x00: this is an extended opcode
0x01: the extended opcode spans 1 byte
0x01: this is the extended opcode `DW_LNE_end_sequence`
  => Our sequence ends at: { addr: 0x100003f71 }
```

# How to use these mappings

This was a simplified example, and only uses a single source file and only a limited
number of entries.

Each entry implicitly goes to the next one, ond the `end_sequence` does not really count,
thus we have the following entries:

```text
- 0x100003f50 - 0x100003f5f: file 1 (which is `"main.c"`), line 5, column 0
  (this is the function prologue)
- 0x100003f5f - 0x100003f64: file 1, line 6, column 5
- 0x100003f64 - 0x100003f6b: file 1, line 7, column 5
- 0x100003f6b - 0x100003f71: file 1, line 8, column 5
```

As each sequence is contiguous internally, and is terminated by an `end_sequence`
marker, instead of storing the end explicitly, we could also add a sentinel
value instead, put everything into a sorted list and binary search that quickly.

This is pretty much how the Sentry SymCache format works.

# Summary

We have looked in depth at the DWARF line program binary format and learned a
couple of things about it:

- The DWARF specification a complex but well documented format, though the specification
  can be hard to read and understand at some points.
- The line programs, one per compilation unit, are contained in a `.debug_line`
  section. They can also reference other sections depending on the DWARF version.
- Each line program has a header and a list of instructions.
- These instructions encode the address, file, line, column and a bunch of flags.
- The line program is divided into contiguous sequences.
- The format and opcodes are very extensible, supporting all kinds of instruction
  set architectures, which also makes it very complex.
- The line program itself has no information about functions and their names.
  That information is part of the `.debug_info` section and the debug information
  entries contained within.

---

This concludes the deep dive into DWARF. This leaves me with only one more
format to go in this series: _Windows PDB line programs_.

Those are pretty much completely undocumented, so it will take some time to
digest everything into a hopefully understandable blog post.
