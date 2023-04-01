---
title: 'Self Identifying JavaScript Source Maps: The Case for Debug IDs'
date: '2023-04-02'
tags: ['source maps', 'debugging', 'building sentry']
draft: false
summary: 'What is a self identifying file, what are debug IDs and why do we want a fundamental change in the web ecosystem for source maps.'
images: [/images/building-sentry-source-maps-and-their-problems/sourcemaps.gif]
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2019/07/16/building-sentry-source-maps-and-their-problems/
authors: ['arminronacher']
---

At Sentry, we handle a significant number of stack traces, which requires
access to debug information files such as PDBs, DWARF files, or source maps.
Regrettably, the user experience surrounding source maps is subpar, prompting
us to propose a solution to this issue: the implementation of globally unique
Debug IDs.

Imagine working in a widget factory where a new widget is created every 15
seconds. This factory specializes in producing a variety of widget types, and
in some cases minor modifications being made on a weekly basis. To assist with
the operation of these widgets, a dedicated machine produces comprehensive
manuals. Some widgets are exclusive prototypes designed for internal testing
and future product development, but even these come with accompanying manuals
to ensure that the testers understand their functionality.

To ensure that the correct manual accompanies each widget, they could be
packaged together in a box. However, in order to minimize paper usage, it may
be more practical to offer users the option to download the manual from a
website whenever needed. That would also allow for the convenient reprinting
of a manual for a specific widget if required.

But this poses a challenge: given a widget, how do you find the correct manual?

One way would be to print the URL of the manual directly onto the widget. The
person that gets hold of the widget can then go to that website to download the
manual. Another option would be to print a model number onto the widget
instead. That seems like it's a subtle difference but the significance is
important in practice.

Given a minified JavaScript file today, there is often (though, unfortunately,
not always) a URL reference to the source map included. This practice resembles
the example of printing the manual's URL onto the minified file. In contrast, a
compiled executable typically contains a build or debug ID. This approach is
more akin to printing the model number on the widget.

Now let's talk about two very important properties when it comes to widgets
and manuals or build outputs.

## Self-Describing

The first property we care about is the ability to distinguish between widgets
and manuals. That might seem obvious if we only have widgets and manuals,
but let's imagine that there are actually different types of manuals such as
service manuals, end user manuals, and certificate of conformance. Being
self-describing means that by simply looking at the document, one can tell
the type of manual (and confirm that it's not a widget itself). Most things
are _self-describing_ in one form or another, but not all, particularly when
they are boxed up and we need to tell these boxes apart.

Consider a scenario where our documents are placed inside unmarked envelopes.
To determine the contents one would have to open the envelope to see what's
inside. We could sort them into different folder and label the folders which
would certainly help, but if someone throws all the envelopes into a large
container, we would have to open up all envelopes to sort them apart.

This situation is somewhat analogous to what happens with source maps today.
A source map is information contained a "box": a JSON file. We can take an
educated guess that it's a source map because of the presence of keys such as
`version`, `file`, one `mappings`, but it's a guess. There is in fact no
guarantee that we can tell a source map apart from something that merely
appears similar. As a result source maps do not meet the criteria of a
self-describing file.

When placing widgets into unmarked boxes and relying solely on proper sorting,
we face difficulties if someone mixes them all together in a container. In
such cases having labelled boxes becomes crucial, or else we would need to
open up each box to identify it's contents. It gets even more challenging when
the widgets in the boxes are very hard to tell apart reliably. This is exactly
the problem we have with JavaScript files today. They really come in two
varieties: minified and non-minified. We have [heuristics to tell them
apart](https://github.com/mitsuhiko/might-be-minified) but they are often
inaccurate. Alas there are situations where we it comes in very handy to
be able to discern between these.

## Self-Identifying

The second property, which is even more crucial, is the ability to identify an
item without requiring external information.

Imagine if our widget factory were to spit out widgets resembling small black
pills thaty appear identical. How can we distinguish them? We could place
them in labelled boxe, but once removed from the box, identification would be
impossible. A better approach would be to laser engrave the model number
directly onto the widget. This means by just looking at the widget we can tell
determine it's precise nature.

The same concept applies to the manuals. An effective way to manage the
manuals is to print the model number onto them. As long as the page with the
model number stays infact, one can at all times tell what widget the manual
belongs to. This property is essential when dealing with files on a large scale.

A less efficent and error prone approach involes on relying on external
organisation such as labelled folders with dividers. If anyone were to remove
that manual and not put it back properly it would be (almost) impossible to
identify the associated widget.

This property is known as _self-identifying_. We do not need any additional
information to be able to say "this widget is X" or "this manual belongs to
widget X".

Today, neither source maps nor minified JavaScript files are self identifying
today. We rely heavily on the _filename_ of the file. In many operations the
filename is lost and even if it's retained, the filename is not globally
unique. This means if we throw all our source maps and minified files into a
huge folder, we would encounter duplicates.

## Practical Problems

Imagine you are an outsourcing company responsibel for ensuring that the widgets
conform to specification. 1% of all widgets produced are sent to you in
massive containers, and you want to start checking them against their
specifications. Ideally you would simply send the containers of widgets to be
loaded onto a conveyor belt where machines would sort them by model number
after scanning each widget. After the widgets have been sorted by model number,
a human operator puts the model number into a computer, which downloads the
necessary specification document by the model number from the canonical source.
It then displays the information to the person conducting the test. Depending
on weather the widgets pass or fail the test, a sticker is placed on it and
sent back.

This is the desired scenario for source maps. However, the current source map
experience is far more complicated and error prone:

Widgets lack model numbers. Instead, all the widgets that are sent in the
containers are boxed up into large packages marked with a shipment number.
Before unloading the widgets onto the converyor belt, they must be placed in
small baskets labelled with the shipment number. Each widget has a small
sticker in addition containing the name of the manual. While this is taking
place, a parcel containing various folders with documents is sent to
another office for scanning and sorting. Each folder is labelled with a
shipment number. The folders themselves contain the different manuals, all
with a post-it on it identifying the name. The scans of the manuals are then
placed in a computer system identified by shipment number and manual name. In
this scenario the machine can now only process one widget at the time because
it cannot tell widgets apart. When the human operator takes out a widget, they
read the shipment number on the basket and the manual name on the at the basket
it's placed in and looks at the shipment number as well as the sticker on the
widget with the name of the manual. Then again, depending on the test result,
stickers are placed on it.

Many issues can arise in this process. Shipment numbers can be mislabeled on
either the widget or the parcel containing the manual. Sorting must happen
shipment by shipment, as placing everything on a conveyor belt at once would
result in losing the association to the shipment. The names of the manuals
can be incorrectly entered when sorting the manuals or when reading the sticker
on the widget.

When discussing source maps, the minified file represents the widget, the
source map serves as the manual, the version control hash or release name
functions as the shipment number, and the source map reference corresponds to
the manual's name indicated on the widget's sticker.

And mistakes happen. All the time.

## The Proposal

Here is our proposal:

1. Bundlers, transpilers and everything create a globally unique (ideally a
   deterministic) Debug ID (a UUID).
2. All minified JavaScript files get a `//# debugId=DEBUG_ID` comment at the end
   embedding the Debug ID.
3. All source maps get a new `debugId` attribute into the source map that holds
   the Debug ID.
4. Browsers and JavaScript engines gain an API to access the Debug ID for a
   loaded JavaScript file (basically a function that maps a loaded JavaScript URL
   to its Debug ID).

And preferrably source maps get a JSON schema and refer to that schema by
`$schema` so they can be told apart from other JSON files.
