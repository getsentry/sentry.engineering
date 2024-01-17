---
title: 'How we improved Performance Score accuracy'
date: '2024-01-17'
tags: ['javascript', 'performance', 'web']
draft: false
summary: "We're making updates to how Performance Scores are calculated in the Web Vitals module, which will bring them closer to what your users experience."
images: ['/images/how-we-improved-performance-score-accuracy/hero.jpg']
layout: PostLayout
canonicalUrl: performance-score-improvements
authors: ['edwardgou']
---

Last year in November, we released the [Web Vitals](https://docs.sentry.io/product/performance/web-vitals/) module for Sentry's Performance product. Aside from helping users monitor and improve their Web Vitals, this new module also introduced [Sentry Performance Scores](https://docs.sentry.io/product/performance/web-vitals/#performance-score) for all web browser applications. As a quick reminder, [Performance Scores](https://docs.sentry.io/product/performance/web-vitals/#performance-score) are used to condense multiple Web Vitals and their respective thresholds into an overall score from 0-100 that rates an app's perceived performance, based on real user data for Web Vitals.

Today, we are making updates to how Performance Scores are calculated. These updates will improve the accuracy of these scores by bringing them closer to what users experience on your web apps. To understand how these changes will impact your Performance Scores, it's useful to understand how they used to be calculated. Here's a brief overview:

1.  Your users visit your webpage which generate pageload transactions. These transactions contain [Web Vitals](https://docs.sentry.io/product/performance/web-vitals/) (LCP, FCP, FID, TTFB, CLS) and get sent to Sentry.
2.  In the Sentry Web Vitals module, each web vital is aggregated to get the p75 value.
3.  The p75 value of each Web Vital is then put through a non-linear function which generates individual Web Vital component scores from 0 to 100. - It's not necessary to know, but for those curious, we use a [Complementary Log-Normal CDF](https://www.desmos.com/calculator/ejhjazajbd) to calculate component scores:

            $$C\left(x\right)=\frac{1}{2}(1-E_{rf}(\frac{\ln x-\mu}{\sqrt{2}\sigma}))$$

4.  Each component score is then statically weighted and summed to produce an overall Performance Score out of 100 for your web app:

        $$S_{total}=S_{lcp} \times 30 + S_{fid} \times 30 + S_{cls} \times 15 + S_{fcp} \times 15 + S_{ttfb} \times 10$$

You can find out more about how these are calculate [in our documentation](https://docs.sentry.io/product/performance/web-vitals/#performance-score).

While the above approach gives some of the signal that we're looking for, there are some drawbacks that affect how accurately our Performance Scores reflect what users experience:

- Performance Scores can be skewed based on outlier pageloads if the Web Vitals are extreme enough.

  1. Consider a scenario where we have three pageload transactions, with the following [LCP](https://docs.sentry.io/product/performance/web-vitals/#largest-contentful-paint-lcp) values and thresholds:
     ```
     300ms  -> Good
     400ms  -> Good
     8000ms -> Bad
     ```
  2. Aggregating the LCP values above would get a p75 of 4200ms.

     $$p75(300ms,400ms,8000ms)=4200ms$$

  3. Which equates to an LCP score of **26** in our Complementary Log-Normal CDF.

     $$C_{lcp}(4200ms)=0.26$$

  4. Although two of the samples in the scenario have very performant LCP values, the one outlier sample overly skews the LCP score negatively.

- Some Web Vitals may be reported less frequently, depending on [browser support](https://docs.sentry.io/product/performance/web-vitals/#browser-support). These Web Vitals end up overrepresented in Performance Scores because we use static weights.
  - Consider a scenario where our web app has a single LCP sample from Chrome and 100 pageload samples without LCP from Safari (because Safari does not support LCP). This causes LCP to be overrepresented in our performance score because LCP makes up a static 30% weight of our overall Performance Score despite having a sample size of one.

Ideally, our Performance Scores should feel true to what users experience on our web app. If our web app is fast and responsive, our Performance Scores should positively reflect that. Additionally, Performance Scores should show a consistent relationship when drilling down from web app, to pages, to pageloads.

Rather than calculating scores on aggregate Web Vitals across your app, a better approach would be to calculate the score on individual pageloads at the point of their collection. The first advantage is if any Web Vitals are missing on a pageload, we can dynamically adjust weights to exclude those missing Web Vitals. The second advantage is that we can now average pageload scores to come up with an overall score across our entire web app without skewing our scores due to outlier pageloads. This is because individual pageload scores are bounded between 0 and 100, which mitigates the impact of any outliers.

To demonstrate, if we use the previous example of three pageload transactions, we get the following approximate LCP score values

```
300ms  -> 99
400ms  -> 99
8000ms -> 7
```

Averaging the scores above gets us a score of **68**. Compared to the previous score of **26**, this new score of **68** lines up much better with what we would expect for 2 fast pageloads and 1 slow pageload. This is how we will be calculating Performance Scores going forward. As a result of improved Performance Score accuracy, we’ll also see more accurate [Opportunity Scores](https://docs.sentry.io/product/performance/web-vitals/#opportunity) as well.

Due to the updates we're deploying to Performance Score calculations, users may see a change in their data the next time they visit the Web Vitals module. For most users, this may mean an increase in their Performance Score due to the correction in outliers no longer skewing scores negatively.
