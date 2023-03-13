---
title: "Alias: An approach to .NET Assembly Conflict Resolution"
date: '2023-03-13'
tags: ['.net','sdk']
draft: false
summary: Most plugin based models load all assemblies into a single shared context. This is a common approach because it has better memory usage and startup performance. The history and rules of assembly loading in .NET is convoluted; its current status makes it difficult (and sometimes impossible) to load multiple different versions of the same assembly into a shared context. Instead of trying to struggle with existing options we decided to build a new tool: Alias.
images: []
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2022/02/24/alias-an-approach-to-net-assembly-conflict-resolution/
authors: ['brunogarcia','simoncropp']
---

Many .NET applications and frameworks support a [plugin based model](https://en.wikipedia.org/wiki/Plug-in_(computing)). Also known as “add-in” or “extension” model. A plugin model allows extension or customization of functionality by adding assemblies and config files to a directory that is scanned at application startup. For example:

* [MSBuild tasks](https://docs.microsoft.com/en-us/visualstudio/msbuild/task-writing)
* [Visual Studio extensions](https://docs.microsoft.com/en-us/visualstudio/extensibility/starting-to-develop-visual-studio-extensions)
* [ReSharper](https://www.jetbrains.com/resharper/)/[Rider](https://www.jetbrains.com/rider/) plugins
* [Unity Plugins](https://docs.unity3d.com/Manual/Plugins.html)

## The problem
Most plugin based models load all assemblies into a single shared context. This is a common approach because it has better memory usage and startup performance. The history and rules of assembly loading in .NET is convoluted; its current status makes it difficult (and sometimes impossible) to load multiple different versions of the same assembly into a shared context.

For example, it isn’t possible to load both versions 12.0.2 and 12.0.3 of `Newtonsoft.Json.dll` into the same context. In a plugin environment, the resulting behavior is often based on the load order of plugins. At runtime, the reference used in the first loaded plugin is then used by every subsequent plugin. So if a plugin relies on a later version of a reference than the one initially loaded, that plugin will fail either at load time or at runtime. A similar conflict can occur at compile time if the build tooling had conflict detection in place.

More specifically in the Unity world, [UPM (Unity Package Manager)](https://docs.unity3d.com/Manual/upm-ui.html) packages can include one or more DLLs that can cause such conflicts when used together. With Unity adding support for .NET Standard 2.0, different package developers (including Unity themselves) began bundling some `System` DLLs such as `System.Runtime.CompilerServices.dll`, `System.Memory.dll`, and `System.Buffers.dll`.

Since the release of .NET 5.0, many of these DLLs have become part of the standard library—meaning, now there’s no need to bring them in via NuGet or bundle in a UPM package. The Sentry SDK for .NET is dependency-free when targeting .NET 5 or higher, so no conflict would happen if we could use that instead of .NET Standard 2.0. Unity is [skipping .NET 5 but is working towards supporting .NET 6](https://forum.unity.com/threads/unity-future-net-development-status.1092205/). Unfortunately though, it will take years until all Unity LTS versions are running .NET 6, and we required a solution to unblock a growing number of users hitting issues caused by more than one UPM package bundling the same DLLs, often with different versions.

## Options we considered and ruled out

### [Costura](https://github.com/Fody/Costura)
Costura merges dependencies into a target assembly as resources. We add custom assembly loading logic to the target assembly, so that dependencies are loaded from resources instead of from disk.

The important point here is that the assemblies are not changed. Therefore, those assemblies each still have the same assembly name and, when loaded, will respect the standard assembly loading logic. So in a plugin environment, using Costura will still result in a conflict.

### [ILMerge](https://github.com/dotnet/ILMerge) / [ILRepack](https://github.com/gluck/il-repack)
ILMerge and ILRepack work by copying the IL from dependencies into the target assembly. So the resulting assembly has duplicates of all the types from all the dependencies and no longer references those dependencies. This approach does resolve the conflict—however, both these projects are not currently being actively maintained. For example, both have known bugs related to .NET Core and portable PDBs.

## The solution
With the other existing options exhausted, we decided to build a new tool: Alias.

### [Alias](https://github.com/getsentry/dotnet-assembly-alias/)
Alias performs the following steps:

* Given a directory containing the target assembly and its dependencies.
* Rename all the dependencies with a unique key. The rename applies to both the file name and the assembly name in IL.
* Patch the corresponding references in the target assembly and dependencies.

The result is a group of files that will not conflict with any assemblies loaded in the plugin context.

One point of interest is that the result is not a single file, which is the approach used by ILRepack, ILMerge, and Costura. This is because the reviewed plugin scenarios all supported a plugin that was deployed to its own directory as a group of files. Because of that, having a ‘single assembly’ was not a problem we needed to solve.

This allowed the Sentry UPM package to include “its own version” of the supporting `System` DLLs needed to work in a .NET Standard 2.0 target. IL2CPP’s linker still takes care of dropping any unused code in the final application.

Given Sentry’s commitment to support Unity’s LTS version from 2019.4 onwards, we expect to rely on this solution for a few years—until the lowest-supported Unity version allows us to include only `Sentry.dll` without any transient dependencies.

## How to use
Alias is shipped as a [dotnet CLI tool](https://docs.microsoft.com/en-us/dotnet/core/tools/). So the [Alias tool](https://nuget.org/packages/Alias/) needs to be installed:

```bash
dotnet tool install --global Alias
```

Alias can then be used from the command line:

```bash
assemblyalias --target-directory "C:/Code/TargetDirectory"
              --suffix _Alias
              --assemblies-to-alias "Newtonsoft.Json.dll;Serilog*"
```

The `--suffix` should be a value that is unique enough to prevent conflicts. A good candidate is the name of the plugin or some derivative thereof.

You can use Alias to resolve conflicts in your UPM packages too. Like the [Sentry SDK for Unity](https://github.com/getsentry/sentry-unity), our tools are open source.

## Better MSBuild integration
Currently, Alias is only a dotnet tool (command line). You can use it as part of the bundling/packaging step of the development life-cycle. However, it using as part of the bundling/packaging step can make it difficult to debug if something goes wrong, as unit tests and running a project from the IDE don’t automatically use the aliased assembly.

## Package shading draft
NuGet currently has a draft proposal for [Package shading](https://github.com/dotnet/designs/pull/242).

Producer-side package shading is an experimental feature that allows a NuGet package author to “shade” a dependency: embed a renamed copy of it in their package. This ensures that consumers of the package get the exact same version that the package author intended, regardless of any other direct or indirect references to that dependency. This is a feature [available on Maven](https://maven.apache.org/plugins/maven-shade-plugin/).

This is effectively a combination of the techniques used by Alias and Costura. In theory it should solve the same assembly conflict issues that Alias does. Note that this is a draft for a proposed experiment with no current timeline for delivery.

Even though this won’t resolve the problem with Unity UPM packages that we’re using Alias for, it’s great that .NET is considering a longer term solution. [Alexandre Mutel from Unity mentioned](https://twitter.com/xoofx/status/1496898026765438976) a PR in Unity to improve this too.