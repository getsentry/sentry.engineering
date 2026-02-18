---
title: "A locking war story"
date: "2023-05-16"
tags: ["processing", "symbolicator", "rust"]
draft: false
summary: "We recently migrated JavaScript/SourceMap processing to Rust where we were hitting a lock contention problem in our processing infrastructure that kept people up for a few days. What happened, why and how did we solve it?"
images: ["../../assets/images/locking-war-story-title.png"]
postLayout: PostLayout
canonicalUrl: https://swatinem.de/blog/locking-war-story/
authors: ["arpadborsos"]
---

We recently migrated the JavaScript and SourceMap processing from Python code over to Rust code, more specifically our
_Symbolicator_ service that is a powerhouse aimed at heavy processing.

However, the first few days of pushing 100% of JavaScript events through this service kept our teams awake for far too
long. Processing some of those events did not go as smoothly as it should have, and we were battling low throughput and
increasing backlogs in our processing infrastructure.

In the end, I tracked the root cause of that problem down to a lock contention issue.

An alternative clickbait title for this could be: “`Read + Seek` considered dangerous”.

This is a very interesting story, and one of the nice side effects of working on open source software is that I can
share all of the details of it publicly, along with a link to the [PR](https://github.com/getsentry/symbolic/pull/787)
that implemented the fix.

# TLDR

As the alternative clickbait title suggests, the core of the problem is that both `Read` and `Seek`, and the combination
of the two need a `&mut` reference to the reader to do any operations. So _read-only_ access still requires an exclusive
reference. (Aside: This might be a good example why people have advocated to call `&mut` _exclusive_ access.)

In my example, I was dealing with a `zip::ZipArchive`, which wraps a `Read + Seek`, and needs `&mut self` access to read
a file from the archive. So sharing this archive across multiple tasks that want to read files from it leads to lock
contention as only a single task can read files from the archive at a time.

# Background

Surprisingly, this story starts with JavaScript. Or more precisely, with processing JavaScript stack traces using SourceMaps.
My team recently migrated all of the SourceMap processing done at Sentry from Python code that is supported by some Rust
binding, to a pure Rust service that is still driven by Python.

JavaScript customers upload those SourceMaps, along with minified JS files and other files as a special `zip` file that
we call a `SourceBundle`. This archive also contains a manifest, which has a bit of metadata for each file. Things like
the reference to the corresponding SourceMap for files that do not have an embedded `sourceMappingURL` reference. And
also most importantly, this metadata includes a `url` for that file, because SourceMap processing sadly still relies on
very brittle URLs. I touched on those problems in my previous post around [file identity](https://swatinem.de/blog/file-identity/),
so I won’t go into more details.

# Being too Smart for our own Good

The primary driver for moving more parts of the processing to Rust was to be able to better reuse repeated computations.
Our SourceMap processing infers function / scope names by parsing the minified source, and it builds a fast lookup
index that is meant to be reused. Although the Python code never did that. The stateful Rust service however has a variety
of in-memory and on-disk caches to avoid expensive computations for each event that needs to be processed.

One of the more expensive computations that I wanted to avoid was opening up the zip archive and parsing the manifest
contained within. We then ended up with a parsed manifest / index, and an open `zip::ZipArchive`, more precisely a
`zip::ZipArchive<std::io::Cursor<&'data [u8]>>`. So we already have a memory-mapped `&[u8]` that gives us trivial
random access. But we need to wrap it in a `Cursor` to make it into a `Read + Seek`. As the `ZipArchive` needs `&mut`
access, we also had to wrap it in a `Mutex`. And this `Mutex` was exactly the thing that was contended in this case.

Trying to avoid repeatedly opening and parsing the manifest by keeping it in-memory and sharing it across computations
combined with that `Mutex` meant that all the events that needed access to a specific zip file were all contending on
that mutex. Feeding more events to a single server even made things worse, and caused trouble for the whole pipeline.

The problem with `Read + Seek` is that it indeed needs to maintain some internal mutable state, namely the
cursor position. If it were not synchronized using a `&mut` and a `Mutex`, it would mean that concurrent readers could
potentially read garbage, or worse. So thank you Rust for the strict guarantees that avoided that :-)

The solution, in the end, was to give each reader it's own (still `Mutex`-locked) copy of the `ZipArchive`. According to
its docs, it is a cheap to clone if its generic reader is, which is the case for `Cursor`. Rolling out this fix indeed
fixed the contention problem for us, and our production systems are now much happier. Although they are still doing way
too much unzipping, but later on that.

# Can we do better?

The mutable state fundamentally comes from the usage of `Read` which implicitly updates a cursor position, and `Seek` which
does so explicitly. And this is a reasonable choice for `ZipArchive`, as I believe it is most frequently used in
combination with a `std::io::BufReader<std::fs::File>`. However, I believe there are a few crates out there that
abstract over the reader as well. For example, both `object::ReadRef` / `object::ReadCache` and `scroll::Pread` work
with shared references, and require an explicit `offset` for each of the read methods, instead of maintaining the offset
internally via `Seek`.

In our case, we have a memory-mapped `&[u8]`, and reading from that is a trivial memory access. I cannot overstate how
much of a productivity and sanity boost `mmap` is. Sure, one might argue that `Read` gives more explicit control, and
it is very obvious and explicit when a syscall and context switch to the kernel happens, whereas with `mmap` that is
done implicitly via page faults. Maybe in some very extreme situations, deep control over this might be beneficial, but
in the general case, again, I cannot overstate how awesome `mmap` is.

# A rant on zip

While the lock contention issue, and the _read-only, but not really_ nature of `ZipArchive` was a pain, but one that
was easily fixable, there is another issue looming here. Why are we using zip archives in the first place? The fact that
lock contention became a problem highlights that we are using these archives a lot. And while we have various caches all
over the place, one thing that is not cached right now is access to the files within that zip archive.

So we are really using the same files from within the same archives all over again. And we are decompressing them over
and over again. I haven’t measured this in production yet, but running this through a local stress test highlights the
fact that our processing is now mainly dominated by decompression.

Zip archives are great and they serve a specific purpose, but their main purpose is long-term _archival_ as the name
suggests, not frequent random access. There might be a possibility to still use zip archives, but using a compression
algorithm that is faster for decompression, but that is a story for a different time. Along with the discussion to
maybe use something else entirely.

All in all, I am fairly happy with the fact that decompression seems to now dominate the performance, as it means that
the rest of the architecture at least is doing a really great job at being high-performance :-)
