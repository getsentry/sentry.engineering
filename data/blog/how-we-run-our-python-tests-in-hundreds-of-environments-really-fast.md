---
title: "How we run our Python tests in hundreds of environments really fast"
date: '2023-03-13'
tags: ['python','sdk','testing']
draft: false
summary: One of Sentries core company values is “for every developer”. We want to support every developer out there with our tools. But not every developer uses the newest or widely adopted tech stack, so we also try to support older versions of libraries and frameworks. To make sure that our SDK works correctly we have around 450 automated tests in our test suite that run for each change we make to the SDK.
images: []
layout: PostLayout
canonicalUrl: https://blog.sentry.io/2022/11/14/how-we-run-our-python-tests-in-hundreds-of-environments-really-fast/
authors: ['antonpirker']
---

Not in a reading mood? You also can watch the talk I gave at DjangoCon 2022.

One of Sentries core company values is “for every developer”. We want to support every developer out there with our tools. But not every developer uses the newest or widely adopted tech stack, so we also try to support older versions of libraries and frameworks.

In our Sentry SDK for the Python programming language this means that we support:

* Around 20 web frameworks
* We still support Python 2.7 (!)
* We support Python 3.5 up to 3.11
* We support older versions of frameworks. (ex: We support Django 1.8 which is eight years old)

To make sure that our SDK works correctly we have around 450 automated tests in our test suite that run for each change we make to the SDK.

Supporting seven Python versions, and around twenty frameworks, and between 2 and 9 versions of each of those frameworks amounts to over 400 environments we run our tests in.

## Our stack for testing
We use [pytest](https://docs.pytest.org/) to run our test suite. Before running the tests we use [Flake8](https://flake8.pycqa.org/) and [black](https://black.readthedocs.io/) to lint and format our source code and [mypy](http://mypy-lang.org/) for type checking. [Tox](https://tox.wiki/) is the tool we use to run our test suite in different environments. We use good old [make](https://linuxhint.com/make-command-linux/) for running our test suite in different environments on our local machines. And finally we use [GitHub Actions](https://github.com/features/actions) as our CI so we can run the whole test suite in all the environments for all pull requests.

## Slow Tests
Our test setup was created years ago and over time lots of tests were added but we never had time to refactor our test setup itself. This led to the fact that it took around **40 minutes** to run our test suite! Having such a slow test suite is soul crushing for everyone that needs to run the test suite once in a while. Releasing new versions of the SDK was a process that could take up to an hour because we run the test suite on each release. Things had to change. So we set aside some time to improve our test suite.

## Making our test suite faster
We collected a couple of ideas on how to run our tests faster without refactoring all the tests.

Read how we:

* Split up our test suite by framework
* Massively reduced the wall clock time it takes to run the tests
* Made our developers happier

The idea was to change the way we ran the tests and not the tests by themselves.

The starting position in terms of our test suite was this: On each pull request we started Tox in one GiHub Actions runner that ran the test suite in all the environments, one by one:

![View of tests running in series](/images/how-we-run-our-python-tests-in-hundreds-of-environments-really-fast/test-series.png)

This is the slowest way you can run tests. It took 38-42 minutes for each complete run.

## Idea 1: Run test suite in parallel in tox
Tox has a command line switch `--parallel auto` that runs the test suite in the number of available CPU cores in parallel:

![View of tests running in parallel](/images/how-we-run-our-python-tests-in-hundreds-of-environments-really-fast/parallel-in-tox.png)

This already improved the time it took to run our tests dramatically. It was now around 25 minutes instead of 40. But this is still not “fast”. The limiting factor was now the number of CPU cores, as GitHub Actions runners only have 2 CPU cores.

## Idea 2: Run test suite in parallel using GitHub Actions
My thought process now was that I can not have more CPUs in our GitHub Actions runners (if we do not buy bigger machines) but I can always start more GitHub Actions runners. So I created a [script](https://github.com/getsentry/sentry-python/blob/master/scripts/split-tox-gh-actions/split-tox-gh-actions.py) to create Github Actions config yaml files for every(!) environment we run our tests in.

The idea was to have something like this:

![View of tests running in parallel via github actions](/images/how-we-run-our-python-tests-in-hundreds-of-environments-really-fast/parallel-in-gh-actions.png)

Turns out we have a limit on concurrent workflows in GitHub actions. We have GitHub Enterprise, which gives us 180 concurrent workflows in GitHub Actions, for the whole Sentry organization, not just me. Starting 400 workflows on each push would not be a nice thing to do. So…

## Idea 3: Best of both worlds
The compromise was to run the test suite in parallel in tox and start for each of the 20 web frameworks one GitHub runner. Like this:

![View of tests running in parallel via tox and github actions](/images/how-we-run-our-python-tests-in-hundreds-of-environments-really-fast/parallel-in-tox-gh-actions.png)

I changed the [script](https://github.com/getsentry/sentry-python/blob/master/scripts/split-tox-gh-actions/split-tox-gh-actions.py) that parses the `tox.ini` to create one yaml file per framework. Those new/updated yaml files need to be committed to the repository after changes are made to `tox.ini`. To make sure this happens, we call the script during CI to [check if the current tox.ini matches the committed yaml files](https://github.com/getsentry/sentry-python/blob/master/.github/workflows/ci.yml#L35-L47). If they do not match the CI fails and gives a nice error message telling the developer what to do. This makes it hard to do the wrong thing, forcingdevelopers to do the right thing. This is important for making this process work in the long run.

This worked great, and brought the time down considerably. Our test suite run time was now at around 10 minutes.

## Idea 4: Cleanup Yaml files
When creating the script that creates the yaml files from our `tox.ini` (based on our original GitHub Actions yaml file) I noticed some strange things in there. We had `actions/setup-node@v3` in our yaml file that was unused. So I removed it. We also started Redis and Postgres for every test. Turns out we did not use Redis at all, because we now use [fakeredis](https://pypi.org/project/fakeredis/) so the Redis service could be deleted. Postres was also run for all the tests, but only used in the Django tests. So I changed the config to only start Postgres for the Django tests and not the other 19 web frameworks. That again saved about 5 more minutes.

## Outcomes of the changes:

* It now takes 5 minutes instead of 40 to run the test suite.
* We did not change the tests, but only how we are running them.
* Splitting up the test suite per web framework makes it way easier to find failing tests. Before we had around a bazillion lines of log output from our test run and finding the one test that failed was really annoying.
* Happier developers everywhere!

## What’s next?
Some ideas I did not implement yet:

* Use our internal PyPI server to install all the requirements that are installed while running our tests (mostly the ancient versions of all those frameworks)
*  Improve our test-requirements.txt file so we can use `actions/cache@v3` in our yaml files.
* Use a RAM drive in the GitHub runner to create the virtual environments in memory (Yes, GitHub allows this!)
* We are now logging the 5 slowest tests after each test run (with `pytest --durations=5`) and we could improve those tests.

Having our tests suite run in under 2 minutes seems easily possible. Splitting up our test suite by framework showed us that only 4 of the 20 frameworks take around 5 minutes to complete. The majority of the frameworks only take a minute or two.

All the ideas on how to further improve the test suite are collected in the [Better Test Suite](https://github.com/getsentry/sentry-python/milestone/11) milestone. Issues and ideas are very welcome!