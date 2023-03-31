---
title: 'Files need Identity'
date: '2023-03-31'
tags: ['source maps', 'stack traces', 'debug files']
draft: false
summary: 'When processing a stack trace in Sentry, we need to link the data that an SDK sends to the debug files that you upload. This post explores ways we do that.'
images: []
layout: PostLayout
canonicalUrl: https://swatinem.de/blog/file-identity/
authors: ['arpadborsos']
---

Multiple initiatives have been running into the question of _How do I find the necessary debug files to processes this event?_
I explored that question [over at my blog](https://swatinem.de/blog/file-identity/), and also formulated a checklist of
how we would like debug files to look like to make event processing more bulletproof.

---

Interestingly, the same theme has come up multiple times recently within Sentry.
I myself recently wrote a [Sentry RFC](https://github.com/getsentry/rfcs/pull/81) about SourceMap `DebugId`s.
And at the same time, I was supporting and advising other teams working on Java Source Context, and Flutter Obfuscation.

All these different initiatives have the following in common: You have multiple build artifacts for a single application
build. These artifacts together form a tight unit.

- A minified JS file and its corresponding SourceMap allow you to resolve the original source location.
- A Java App and its corresponding SourceBundle allow you to apply Source Context.
- A Flutter App and its corresponding Obfuscation Map allow you to de-obfuscate identifiers.

Whereas `SourceBundle`s are a Sentry invention, the other two use-cases are being implemented by external tools.
And they lack a _strong_ association of the different artifacts / assets that form one final build output.

A `SourceMap` is just some JSON, so is the Flutter obfuscation mapping, though a little different which makes it harder
to deal with, more in a minute.

We need the obfuscation mapping to be able to de-obfuscate, so far so good. But with a few different versions of apps
being installed and used by end users, how do we know _which_ obfuscation mapping we need?

That is where file _identity_ comes in. Each group of tightly coupled build artifacts needs to be uniquely identified
_somehow_, so we are able to find the matching file we need, no matter if that is a SourceMap, a SourceBundle, or an
obfuscation mapping.

To achieve that, each artifact needs to have a _unique identifier_. It is also very beneficial if that unique identifier
is embedded in that file, so it becomes _self identifying_.

This is the problem with the Flutter obfuscation mapping. It is a JSON file, but with an array at its root. There is no
way to extend that file with another field at the root that includes this identifier. Well, too bad I guess :-(

Lets say we have not only two tightly coupled build artifacts but more. To stick with the Flutter example, it might be
the case that a Flutter-web build outputs both a minified JS file, a corresponding SourceMap, _and_ an obfuscation mapping.

Two of those files are just JSON. Our proposal for SourceMap `DebugId`s I linked above proposes to add a new field to
the SourceMap with its unique identifier. It is pretty much impossible to extend the obfuscation mapping however.
But lets ignore that problem for now. In the end we have two JSON files. How do we tell them apart then?

Each file needs to have some form of marker in it that tells us _what kind_ of file it is. For JSON files, the JSON Schema
`"$schema"` field naturally presents itself. Authoring a full JSON Schema might not be everyones cup of tea, and that
is not the point here. The point is that this unique `"$schema"` field tells us _what kind_ of file we are looking at.
By having such a field, the file becomes _self describing_.

A SourceMap just happens to be a SourceMap if it has a `"version": 3` field, and a `"mappings"` field. It might be
very unlikely, but any random JSON file could potentially have these fields and then be wrongly interpreted as a SourceMap.

To summarize this section, every file should be _self identifying_, by embedding some kind of unique identifier, and
it should also be _self describing_ by embedding some kind of marker that describes the kind (or format) of the file.

With these two pieces of information, we can upload any file to any dumb storage service and look it up.

---

But how do we know which file to look up? Let us come back to the example from before. Lets assume we have an obfuscated
Flutter app running on some customer device, and it produces an obfuscated stack trace that is uploaded to Sentry or
any other service. How will Sentry know which obfuscation mapping to use?

To be able to do so, the report that has the obfuscated stack trace also has to provide the unique identifier of the
obfuscation mapping. We can then look up the mapping using that unique identifier and correctly deobfuscate the stack trace.

So we need a way to get access to that unique identifier _at runtime_. Surprisingly, this is the most complex part of
our Flutter example, as well as the most controversial thing about our SourceMap proposal. Ideally, the _Platform_
(whatever it is) offers a programmatic API that provides this unique identifier.

It is totally possible to have a different unique identifier for each accompanying artifact, for example a different
identifier for an associated SourceMap, and obfuscation mapping. Though I strongly advise to have one unique identifier
that is shared among these tightly coupled artifacts.

To summarize, we have some _self identifying_ and _self describing_ artifacts that we will just stash away on some dumb
storage service, and we need a way _at runtime_ to query that unique identifier.

# Native Inspiration

The native ecosystem has most of this figured out to various degrees, lets take a look.

To start this off, binary file formats are usually _self describing_ by starting off with a magic-byte sequence that
identifies the file format. Our native platforms each have their own executable formats for example.

On **macOS**, we have Mach-O files which pretty consistently have a unique identifier called `LC_UUID` (for _load command_).
The executables are also commonly split into a main executable, and an associated debug file called `dSYM`. Both share
the same unique identifier. However, both have the Mach-O format.

As this first example shows, the file _format_ on its own is not enough to identify the file _kind_ / _purpose_. However
by looking at the presence of various sections in that file, one can quite confidently say if it is an executable, or
the corresponding debug file.

**Linux** has `ELF` (executable and linker format) files. These files can have a unique identifier called `NT_GNU_BUILD_ID`
(`NT` for _note_), though it is sadly frequently missing. The executables are not split by default as they are produced
by build tools, but developers frequently split them apart manually. Again, the two files have the same file format,
but it is possible to tell their _purpose_ apart by looking at the various sections. When splitting those files apart,
both retain the same unique identifier.

The situation on **Windows** is slightly different. An executable in `PE` (portable executable) format has its own
identifying which is the combination of the `Timestamp` and `SizeOfImage` header values. This can hardly be called
_unique_ though. This file can then reference a `PDB` (program database) file via a `DebugDirectoryEntry` which contains
the unique identifier of the `PDB` file. One thing here that tools frequently get wrong is that one executable can have
multiple `DebugDirectoryEntry` entries, referencing more than one debug files. I wrote about that previously in a post
titled [Format Ossification](@/blog/2022-07-29-format-ossification.md), because most tools got so used to only ever
seeing zero or one `DebugDirectoryEntry`s, the fact that there can be in fact more than one got completely lost.

In summary, the native formats are pretty good at _self identifying_.

## Symbol Lookup

One thing I mentioned before is being able to easily find and download these debug files from any dumb storage service.
The native ecosystem offers mainly two possibilities here.

In the **Linux** ecosystem, we have `debuginfod` which defines a simple [lookup scheme](https://www.mankier.com/8/debuginfod#Webapi).
One can simply download the `/buildid/{BUILDID}/debuginfo` file and get the debuginfo for a uniquely identified executable.
There is public `debuginfod` servers for every major Linux distribution as well.

Then there is the `symstore` Server and accompanying `SSQP` (simple symbol query protocol), which is primarily used for
the **Windows** ecosystem, but does support other ecosystems as well.
The [lookup scheme](https://github.com/dotnet/symstore/blob/main/docs/specs/SSQP_Key_Conventions.md#key-formats) has
support for a ton of formats, including lookup for `ELF` and Mach-O files using their corresponding unique identifiers.

One problem with `symstore` though becomes obvious looking at the scheme for `PE` files: `<filename>/<Timestamp><SizeOfImage>/<filename>`
As I mentioned, the `Timestamp` and `SizeOfImage` combination might not be unique enough. So just combine it with the
filename, problem solved, right? Well this creates new problems all on its own.
For example Electron hosts its own [symbol server](https://www.electronjs.org/docs/latest/development/setting-up-symbol-server/).
But what happens if you ship an electron app and rename the main `electron.exe` file? Well too bad, you can’t find
that symbol anymore. This is indeed a real pain for Sentry customers.

For **macOS**, the situation is pure sadness. Apple does not host any public symbol server, and the licensing around
these things is also unclear. Sentry goes through great pain to maintain its own internal symbol server for Apple symbols,
but it is a frequent source of problems, with a brittle pipeline for scraping the symbols, and frequent problems with
symbols missing.

## Programmatic API

This is another source of sadness. None of the native platforms have builtin platform support to get at these unique
identifiers. Also getting at the list of all the loaded libraries is a huge pain on some platforms.

For each platforms, getting at the unique identifiers involves manually reading the platform native file format headers
and chasing references around, which can be unsafe as it involves a lot of pointer arithmetic.
The problem with these file formats is also that they are extremely badly documented. I wonder how it is possible that
they are so well understood, although the `DebugDirectoryEntry` situation makes me doubtful.

The formats and the structures you have to read are not documented _publicly on the internet_. They are defined in some
platform specific headers that are primarily only available on that platform. For example on Windows, the `PE` definitions
are part of the Windows SDK. For macOS, I believe the Mach-O headers are provided by Xcode.
One critical bit to get the unique identifier of a `PDB` file is also famously missing from the Windows SDK headers.
The `CodeView` record is not defined _anywhere_. All the tools just copy-paste the definition into their own code from
_somewhere_.
The `ELF` format however is reasonably well specified and documented in various man pages, though those are far from
easily usable.

And even if we have a couple of header definitions that we won’t find on the public web, it is C headers. Can someone
tell me again how many bits a C `long` has? No? Thought so.

Well, I’m not going on a ranting spree about how un-portable C is. The point I’m trying to make is that reading the
unique identifiers of files at runtime is a huge pain and involves unsafe code. It would be so much nicer if we had
built-in platform APIs that let us easily enumerate all the loaded libraries, and easily get their unique identifiers.

# In summary

And with that I am at the end of todays post. What I would love to have from a tool developers perspective is:

- _Self identifying_ files with an embedded unique identifier.
- _Self describing_ files that describe their type / purpose.
- _Programmatic API_ to access a files unique identifier at runtime, and also enumerate all the files currently loaded.

The [SourceMap RFC](https://github.com/getsentry/rfcs/pull/81) I mentioned in the beginning tries to solve two of these
problems, and I would love to get feedback on it.

One thing from the RFC that still needs discussion is _how_ to generate these unique identifiers. Our current draft
implementation generates a new random UUID each time, which I argue is a bad idea.

I would like these identifiers, and the files themselves to be bit-for-bit deterministic / reproducible given the same
inputs.
The [Portable PDB](https://github.com/dotnet/runtime/blob/main/docs/design/specs/PE-COFF.md) specification mentions
explicitly how to create the unique identifier:

> the checksum is calculated by hashing the entire content of the PDB file with the PDB ID set to 0 (20 zeroed bytes).

So there is precedent in other ecosystems for reproducible and deterministic unique identifiers.
