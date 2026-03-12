import { defineCollection, reference } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string(),
        date: z.coerce.date().optional(),
        lastmod: z.coerce.date().optional(),
        draft: z.boolean().optional(),
        summary: z.string().optional(),
        images: z.array(image()).optional(),
        authors: z.array(reference("authors")).optional(),
        tags: z.array(z.string()).optional(),
        postLayout: z.string().optional(),
        canonicalUrl: z.string().nullable().optional(),
      })
      .passthrough(),
});

const authors = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/authors" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string(),
        avatar: z.union([image(), z.url()]).optional(),
        occupation: z.string().optional(),
        company: z.string().optional(),
        email: z.email().optional(),
        twitter: z.url().optional(),
        linkedin: z.url().optional(),
        github: z.url().optional(),
        stackoverflow: z.url().optional(),
        url: z.url().optional(),
      })
      .passthrough(),
});

export const collections = {
  blog,
  authors,
};
